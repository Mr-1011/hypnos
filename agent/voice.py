#!/usr/bin/env python3
"""voice.py - the Hypnos voice loop: the band hears the person, an agent answers with a soft voice.

One Pipecat pipeline, in its own process so that nothing here can hold up a recording:

    the band's sound (live_band.py, /api/audio, Opus)
      -> Deepgram Flux      speech to text; it also decides when the person has finished
      -> Gemini             the agent (prompt.md)
      -> Deepgram Aura      text to speech
      -> this Mac's sound output (the band has no speaker): the speakers, or AirPods on the Mac

brain.py is its memory: every line of the talk goes into the day's Markdown file, the agent starts
with the notes about the person, and when a talk ends Gemini writes those notes again.

    ./run.sh                 starts it with the three sensor programs

API on 127.0.0.1:5304 (the page reaches it as /api/agent):
    GET  /api/stream   server-sent events: state, text ({who: "you" | "agent", text, final})
    GET  /api/state
    POST /api/talk     {"on": true} | {"on": false}; the answer has ok and, when refused, err

While the loop runs, the band's microphone is on (its light is solid blue): everything it hears goes
over the internet to Deepgram, a company, and what is said goes as text to Google and back to
Deepgram for the voice. Tell the people near the band first. The line printed at the start says so:
keep it, and keep mip_opt_out on both Deepgram services.

The keys come from the environment or from .env in the repo root: DEEPGRAM_API_KEY, GOOGLE_API_KEY.

Tried 2026-11-14 with the pretend band's voice (a fable read aloud): Flux gave the words while they
were spoken and closed the turn at the reader's pause; Aura played on the Mac's speakers. Gemini
was not reached that day: the key's project had no credit (402).
"""
import argparse
import asyncio
import base64
import collections
import json
import math
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "sensors"))                   # live_server.py: the HTTP and event-stream plumbing
sys.path.insert(0, str(ROOT / "vexo-open-kit" / "python"))  # the kit's library: its Opus decoder

import aiohttp  # noqa: E402
from dotenv import dotenv_values  # noqa: E402
from loguru import logger  # noqa: E402
from pipecat.frames.frames import (  # noqa: E402
    BotStartedSpeakingFrame, BotStoppedSpeakingFrame, InputAudioRawFrame, InterimTranscriptionFrame, LLMRunFrame)
from pipecat.pipeline.pipeline import Pipeline  # noqa: E402
from pipecat.pipeline.runner import PipelineRunner  # noqa: E402
from pipecat.pipeline.worker import PipelineWorker  # noqa: E402
from pipecat.processors.aggregators.llm_context import LLMContext  # noqa: E402
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair  # noqa: E402
from pipecat.processors.frame_processor import FrameProcessor  # noqa: E402
from pipecat.services.deepgram.flux.stt import DeepgramFluxSTTService  # noqa: E402
from pipecat.services.deepgram.tts import DeepgramTTSService  # noqa: E402
from pipecat.services.google.llm import GoogleLLMService  # noqa: E402
from pipecat.transports.base_input import BaseInputTransport  # noqa: E402
from pipecat.transports.base_transport import TransportParams  # noqa: E402
from pipecat.transports.local.audio import LocalAudioTransport, LocalAudioTransportParams  # noqa: E402
from vexo_open.audio import PcmDecoder  # noqa: E402

import brain  # noqa: E402
from live_server import LiveServer  # noqa: E402

RATE = 16000                  # the band's microphone: 16 kHz, mono, 20 ms a packet
MODEL = "gemini-4-hydrogen"   # the fast one of the three the key reaches (listed 2026-11-14)
VOICE = "aura-2-pandora-en"   # Deepgram calls it smooth, calm, melodic, breathy
ECHO_S = 0.6                  # the room still holds the agent's voice this long after it stops
KEYS = ("DEEPGRAM_API_KEY", "GOOGLE_API_KEY")
NOTE = ("Note: while the agent runs, everything the band's microphone hears is sent over the internet to "
        "Deepgram (deepgram.com), and what is said goes as text to Google and back to Deepgram for the "
        "voice. Tell the people near the band.")


class BandInput(BaseInputTransport):
    """The band's microphone as a Pipecat input: the Opus packets live_band.py streams, decoded."""

    def __init__(self, url):
        super().__init__(TransportParams(audio_in_enabled=True, audio_in_sample_rate=RATE))
        self.url = url
        self.reader = None
        self.deaf_until = 0.0  # time.time() until which the band hears the agent, not the person

    async def start(self, frame):
        await super().start(frame)
        await self.set_transport_ready(frame)
        self.reader = asyncio.create_task(self.read())

    async def stop(self, frame):
        await super().stop(frame)
        self.reader.cancel()

    async def cancel(self, frame):
        await super().cancel(frame)
        self.reader.cancel()

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        # shortcut: the band hears the Mac's speaker, so the loop is deaf while the agent speaks and
        # the person cannot interrupt it; upgrade to echo cancellation when that is wanted.
        if isinstance(frame, BotStartedSpeakingFrame):
            self.deaf_until = math.inf
        elif isinstance(frame, BotStoppedSpeakingFrame):
            self.deaf_until = time.time() + ECHO_S

    async def read(self):
        decoder = PcmDecoder()
        while True:
            try:
                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=None)) as http, http.get(self.url) as r:
                    async for line in r.content:
                        if not line.startswith(b"data: ") or b'"opus"' not in line:
                            continue  # the stream's ping
                        m = json.loads(line[6:])
                        pcm = decoder.feed(base64.b64decode(m["opus"]), m["seq"])
                        if time.time() < self.deaf_until:
                            pcm = bytes(len(pcm))  # silence keeps Deepgram's clock; no sound would not
                        if pcm:
                            await self.push_audio_frame(InputAudioRawFrame(audio=pcm, sample_rate=RATE, num_channels=1))
            except aiohttp.ClientError:
                pass
            await asyncio.sleep(1)  # the band program is not up, or it restarts: its stream comes back


class Guesses(FrameProcessor):
    """Passes every frame on. The words Deepgram has so far for the running sentence go to the page."""

    def __init__(self, show):
        super().__init__()
        self.show = show

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        if isinstance(frame, InterimTranscriptionFrame):
            self.show(frame.text)
        await self.push_frame(frame, direction)


class Voice(LiveServer):
    name = "Agent"

    def __init__(self, band_url):
        super().__init__()
        self.band_url = band_url
        self.worker = None   # the running pipeline; not None = the agent is on
        self.loop = None     # the task that runs it
        self.err = None      # what went wrong in the loop, in the service's own words
        self.lines = collections.deque(maxlen=50)  # [utc_ms, "you" | "agent", what was said]
        self.day = None      # the date this talk is filed under
        self.heard = False   # the person said something in this talk: there is something to write notes from
        self.google = None   # the key the talk started with, for the notes at its end

    def state(self):
        return {"t": "state", "on": bool(self.worker), "err": self.err, "lines": list(self.lines)}

    def said(self, who, text, final=True):
        ts = int(time.time() * 1000)
        if final:
            if not text:
                return
            self.lines.append([ts, who, text])
            brain.note(self.day, ts, who, text)
            self.heard = self.heard or who == "you"
        self.broadcast({"t": "text", "ts": ts, "who": who, "text": text, "final": int(final)})

    async def talk(self, on):
        """Start or end the loop. A refusal comes back as a sentence for the person at the page."""
        if on == bool(self.worker):
            return None
        if not on:
            await self.worker.cancel()
            await asyncio.wait([self.loop])
            return None
        keys = {**dotenv_values(ROOT / ".env"), **os.environ}  # read again each time: a new key needs no restart
        missing = [k for k in KEYS if not keys.get(k)]
        if missing:
            return f"The agent needs {' and '.join(missing)} in .env (env.example has the form)."
        print(NOTE, flush=True)  # before any sound is sent
        self.day, self.heard, self.google = brain.today(), False, keys["GOOGLE_API_KEY"]
        about = brain.notes()
        system = (HERE / "prompt.md").read_text() + time.strftime("\nToday is %A, %Y-%m-%d.\n") + (
            f"\n# Your notes about this person\n\n{about}" if about else "")
        stt = DeepgramFluxSTTService(api_key=keys["DEEPGRAM_API_KEY"], mip_opt_out=True)
        llm = GoogleLLMService(api_key=keys["GOOGLE_API_KEY"], settings=GoogleLLMService.Settings(
            model=MODEL, system_instruction=system))
        tts = DeepgramTTSService(api_key=keys["DEEPGRAM_API_KEY"], mip_opt_out=True,
                                 settings=DeepgramTTSService.Settings(voice=VOICE))
        # the agent speaks first: this line is its cue, the person never said it
        you, agent = LLMContextAggregatorPair(LLMContext([{"role": "user", "content": "The person has just gone to bed. Begin."}]))

        @you.event_handler("on_user_turn_stopped")
        async def person_finished(aggregator, strategy, message):
            self.said("you", message.content)

        @agent.event_handler("on_assistant_turn_stopped")
        async def agent_finished(aggregator, message):
            self.said("agent", message.content)

        speaker = LocalAudioTransport(LocalAudioTransportParams(audio_out_enabled=True))
        self.worker = PipelineWorker(
            Pipeline([BandInput(self.band_url), stt, Guesses(lambda text: self.said("you", text, final=False)),
                      you, llm, tts, speaker.output(), agent]),
            idle_timeout_secs=None)  # a quiet night is no reason to stop

        @self.worker.event_handler("on_pipeline_error")
        async def failed(worker, frame):  # a refused key, no credit left, no internet: the page says why it is silent
            self.err = str(frame.error)[:300]
            self.push_state()

        await self.worker.queue_frames([LLMRunFrame()])
        self.err = None
        self.loop = asyncio.create_task(self.run_loop())
        self.push_state()
        return None

    async def run_loop(self):
        try:
            runner = PipelineRunner(handle_sigint=False)
            await runner.add_workers(self.worker)
            await runner.run()
        except Exception as e:  # a pipeline that dies must leave the switch off and say why
            self.err = str(e) or type(e).__name__
        self.worker = None
        self.push_state()
        if self.heard:
            try:
                await brain.reflect(self.google, MODEL, self.day)
            except Exception as e:  # no credit, no internet: the talk is in the day's file, the notes stay as they were
                self.err = f"The notes were not written: {str(e)[:200] or type(e).__name__}"
                self.push_state()

    async def route(self, method, path, body):
        try:
            args = json.loads(body) if body else {}
        except ValueError:
            return 400, {"error": "bad json"}
        if method == "GET" and path == "/api/state":
            return 200, self.state()
        if method == "POST" and path == "/api/talk":
            err = await self.talk(bool(args.get("on")))
            return 200, {"ok": not err, "err": err}
        return 404, {"error": "not found"}

    async def shutdown(self):
        await self.talk(False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=5304)
    ap.add_argument("--band", default="http://127.0.0.1:5303", help="where live_band.py answers")
    args = ap.parse_args()
    logger.remove()
    logger.add(sys.stderr, level="INFO")  # Pipecat's default prints every frame
    Voice(args.band + "/api/audio").run(args.port)


if __name__ == "__main__":
    main()
