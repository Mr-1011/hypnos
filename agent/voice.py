#!/usr/bin/env python3
"""voice.py - the Hypnos voice loop: the band hears the person, an agent answers with a soft voice.

One Pipecat pipeline, in its own process so that nothing here can hold up a recording:

    the band's sound (live_band.py, /api/audio, Opus)
      -> Deepgram Flux      speech to text; it also decides when the person has finished
      -> Gemini             the agent (prompt.md): it calls its tools until it knows what to say
      -> Deepgram Aura      text to speech
      -> this Mac's sound output (the band has no speaker): the speakers, or AirPods on the Mac

The agent does not ask the person about their day: it knows it. For as long as this program runs it
reads the three sensor programs' streams (sensors()), also while the loop is off:

    what the band heard   every settled line of the band program's Microphone switch goes into the
                          day's Markdown file (brain.py). The agent starts a talk with the notes
                          about the person and with that day; when a talk ends, Gemini writes the
                          notes again.
    the stage of sleep    every half minute sleep.py scores awake, drowsy, light, deep or rem from
                          the Muse's EEG bands and from wrist and head movement, and counts cycles.

While the loop runs, the sensors also give cues: the agent speaks, with nobody asking, when the
person falls asleep (awake to drowsy), when a sleeper stirs (asleep to awake) and when the body does
not rest (brain.restless). A cue goes to Gemini like a line of the talk, with the body's numbers.

The agent answers what weighs on the person with an earlier time when the same kind of thing went
well. It finds that with its tools (TOOLS: Voice's methods of those names), in a loop that Pipecat
runs: recall searches the earlier days, read gives the calendar or the mail, sense asks Google's
decisions model what the person's words touch, body gives the sensors' numbers, stay_quiet says
nothing. skills/ holds the steps for a situation, one Markdown file each; they go into the
instruction. What a tool looked at goes to the page as the state's sense: the Memory card rings it.

    ./run.sh                 starts it with the three sensor programs

There is no switch for the loop. It starts when the band is linked and ends when the band is
switched off on its card (watch()); POST /api/talk does the same by hand.

API on 127.0.0.1:5304 (the page reaches it as /api/agent):
    GET  /api/stream   server-sent events: state, text ({who: "you" | "agent", text, final}).
                       The state carries the brain as nodes and links (brain.graph), what the
                       agent's tools looked at in this turn (sense) and the stage of sleep.
    GET  /api/state
    POST /api/talk     {"on": true} | {"on": false}; the answer has ok and, when refused, err

While the loop runs, the band's microphone is on (its light is solid blue): everything it hears goes
over the internet to Deepgram, a company, and what is said goes as text to Google and back to
Deepgram for the voice. Tell the people near the band first. The line printed at the start says so:
keep it, and keep mip_opt_out on both Deepgram services.

The keys come from the environment or from .env in the repo root: DEEPGRAM_API_KEY, GOOGLE_API_KEY.

Tried 2026-11-14 with the pretend band's voice (a fable read aloud): Flux gave the words while they
were spoken and closed the turn at the reader's pause; Aura played on the Mac's speakers; Gemini
spoke first into a quiet room and wrote the notes. The reader never waits for an answer, so every
answer was interrupted: a person's sentence and the agent's answer to it were not seen that day.
The tools were tried the same day as text, with no sound and a made-up past: the bedtime cue called
recall and spoke 4.1 s after the start; a sentence in light sleep called sense and body together
and got six words after 3.6 s.
"""
import argparse
import asyncio
import base64
import collections
import datetime
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
from google import genai  # noqa: E402
from loguru import logger  # noqa: E402
from pipecat.frames.frames import (  # noqa: E402
    BotStartedSpeakingFrame, BotStoppedSpeakingFrame, FunctionCallResultProperties, InputAudioRawFrame,
    InterimTranscriptionFrame, LLMMessagesAppendFrame, LLMRunFrame)
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
import sleep  # noqa: E402
from live_server import LiveServer  # noqa: E402

RATE = 16000                  # the band's microphone: 16 kHz, mono, 20 ms a packet
MODEL = "gemini-4-hydrogen"   # the fast one of the three the key reaches (listed 2026-11-14)
VOICE = "aura-2-pandora-en"   # Deepgram calls it smooth, calm, melodic, breathy
ECHO_S = 0.6                  # the room still holds the agent's voice this long after it stops
CALM_GAP_S = 120              # no calm words sooner than this after the agent last spoke; a guess, no night behind it
KEYS = ("DEEPGRAM_API_KEY", "GOOGLE_API_KEY")
TOOLS = ("recall", "read", "sense", "body", "stay_quiet")  # the agent's tools: Voice's methods of these names
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

    def __init__(self, band_url, streams):
        super().__init__()
        self.band_url = band_url
        self.streams_of = streams  # where on the body -> the event stream of the program that measures there
        self.seen = {}        # where on the body -> (its last movement numbers, its last heart rate)
        self.eeg = []         # this epoch's EEG: the Muse's band shares, one entry for each of its stats
        self.night = sleep.Night()
        self.sensed = None    # what the agent looked at in this turn (touch), for the page
        self.spoke = 0.0      # time.time() of the agent's last words
        self.worker = None   # the running pipeline; not None = the agent is on
        self.loop = None     # the task that runs it
        self.err = None      # what went wrong in the loop, in the service's own words
        self.lines = collections.deque(maxlen=50)  # [utc_ms, "you" | "agent", what was said]
        self.day = None      # the date this talk is filed under
        self.google = None   # Google's client for this talk: the decisions model, and the notes at its end

    def state(self):
        return {"t": "state", "on": bool(self.worker), "err": self.err, "lines": list(self.lines), "brain": brain.graph(),
                "sense": self.sensed, "sleep": self.night.now()}

    def said(self, who, text, final=True):
        ts = int(time.time() * 1000)
        if final:
            if not text:
                return
            self.lines.append([ts, who, text])
            brain.note(self.day, ts, who, text)
            if who == "agent":
                self.spoke = time.time()
        self.broadcast({"t": "text", "ts": ts, "who": who, "text": text, "final": int(final)})

    def asleep(self):
        """The stage of sleep in words, for Gemini and for the decisions model."""
        n = self.night.now()
        if n["stage"] is None:
            return "The sensors give no stage of sleep yet."
        if not n["cycle"]:
            return f"By the sensors the person is {n['stage']} and has not slept yet."
        return (f"By the sensors the person is {'awake again' if n['stage'] == 'awake' else 'in ' + n['stage'] + ' sleep'}: "
                f"cycle {n['cycle']}, {n['asleep_min']} minutes after sleep began.")

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
        self.day, self.sensed, self.night = brain.today(), None, sleep.Night()  # the talk begins at bedtime: a new night
        self.google = genai.Client(api_key=keys["GOOGLE_API_KEY"], http_options={"api_version": "v1beta"})  # v1beta: the decisions model
        self.spoke = time.time()
        # shortcut: a long day is cut to its last 12000 characters, about an hour of speech; have Gemini
        # write the notes through the day when days get longer than that.
        system = (HERE / "prompt.md").read_text() + time.strftime("\nToday is %A, %Y-%m-%d. It is %H:%M.\n") + (
            f"\n# Your notes about this person\n\n{brain.notes()}\n# What the band heard today\n\n{brain.day_text(self.day)[-12000:]}"
            f"\n# What `read` can give you\n\n{', '.join(brain.sources())}\n"
            # shortcut: every skill goes into the instruction whole; give the agent a tool that loads
            # one skill when there are more of them than an instruction should carry.
            + "\n# Your skills\n" + "".join(f"\n## {f.stem}\n\n{f.read_text()}" for f in sorted((HERE / "skills").glob("*.md"))))
        stt = DeepgramFluxSTTService(api_key=keys["DEEPGRAM_API_KEY"], mip_opt_out=True)
        # thinking: measured 2026-11-14 with this prompt. Google's default thinks 7 to 10 s before the first
        # word, "low" 2 to 3 s; "minimal" is refused for this model, and a budget of 0 is no faster than low.
        llm = GoogleLLMService(api_key=keys["GOOGLE_API_KEY"], settings=GoogleLLMService.Settings(
            model=MODEL, system_instruction=system, thinking=GoogleLLMService.ThinkingConfig(thinking_level="low")))
        tts = DeepgramTTSService(api_key=keys["DEEPGRAM_API_KEY"], mip_opt_out=True,
                                 settings=DeepgramTTSService.Settings(voice=VOICE))
        # Pipecat tells the model of each tool by its name, its docstring and its arguments, and runs
        # the loop: the model calls tools, gets what they return, and then speaks.
        tools = [getattr(self, name) for name in TOOLS]
        for tool in tools:
            llm.register_direct_function(tool)
        # the agent speaks first: this line is its cue, the person never said it
        you, agent = LLMContextAggregatorPair(
            LLMContext([{"role": "user", "content": "(cue) The person has just gone to bed."}], tools=tools))

        @you.event_handler("on_user_turn_stopped")
        async def person_finished(aggregator, strategy, message):
            self.sensed = None  # a new turn: the Memory card rings what the agent looks at now
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

    def felt(self):
        """The body now, in words: the stage of sleep and every sensor's numbers. For the agent and for the decisions model."""
        body = [self.asleep()]
        for where, (moves, bpm) in self.seen.items():
            got = [m for m in moves if m is not None]
            if got:
                body.append(f"{where} movement in the last {len(got) // 2} s, in mg (under {brain.MOVING_MG} is still): "
                            f"mean {sum(got) / len(got):.0f}, most {max(got):.0f}")
            if bpm:
                body.append(f"heart rate at the {where}: {bpm:.0f} a minute")
        return time.strftime("It is %H:%M. ") + "; ".join(body) + "."

    def touch(self, ids, worried=None):
        """The dots of the brain's graph that the agent looked at in this turn: the Memory card rings them."""
        was = self.sensed or {"about": [], "worried": 0}
        self.sensed = {"about": was["about"] + [i for i in ids if i not in was["about"]],
                       "worried": was["worried"] if worried is None else worried}
        self.push_state()

    # The agent's tools (TOOLS). The docstrings are for the model: they say when to use each one.

    async def recall(self, params, words: str):
        """Search the earlier days, weeks and months for a kind of thing, to find a time when it went well.
        It gives every line that has one of the words in it, with its day and how long ago that was.

        Args:
            words: A few words for the kind of thing, with other words for the same: "presentation pitch talk".
        """
        found = brain.recall(words.split(), self.day)
        self.touch(list(dict.fromkeys(day for day, _ in found)))
        today = datetime.date.fromisoformat(self.day)
        await params.result_callback("\n".join(
            f"{day} ({(today - datetime.date.fromisoformat(day)).days} days ago) {line}" for day, line in found)
            or "The earlier days hold nothing about that.")

    async def read(self, params, what: str):
        """Read the person's calendar or mail: what comes tomorrow, and who waits for them.

        Args:
            what: The name of the source, as your instructions list them: "calendar".
        """
        self.touch([what])
        await params.result_callback(brain.sources().get(what, f"There is no {what}."))

    async def sense(self, params):
        """Ask the decisions model about the person's last words: which of your notes, calendar items and
        mails they touch, and whether the person sounds worried. Use it when the person speaks."""
        talk = [m for m in params.context.messages
                if isinstance(m, dict) and m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str)][-6:]
        got = await brain.sense(self.google, "\n".join(
            f"{'voice' if m['role'] == 'assistant' else 'person'}: {m['content']}" for m in talk), self.felt())
        self.touch(got["about"], got["worried"])
        labels = {n["id"]: n["label"] for n in brain.graph()["nodes"]}
        await params.result_callback(
            (f"Their words touch: {'; '.join(labels[i] for i in got['about'])}. " if got["about"] else "Their words touch nothing you know of. ")
            + ("They sound worried." if got["worried"] > 0.6 else "They do not sound worried."))

    async def body(self, params):
        """How the person's body is now: the stage of sleep and the cycle of the night, how much the wrist
        and the head move, and the heart rate. A cue has these numbers in it already."""
        await params.result_callback(self.felt())

    async def stay_quiet(self, params):
        """Say nothing now. Use it alone, when words would wake the person or a cue needs none."""
        await params.result_callback("You said nothing.", properties=FunctionCallResultProperties(run_llm=False))

    async def cue(self, what):
        """The sensors make the agent speak: one line into the talk, as if it had been said, with the body's numbers."""
        self.spoke = time.time()
        self.sensed = None  # a new turn: the Memory card rings what the agent looks at now
        brain.note(self.day, int(time.time() * 1000), "sensors", what)
        await self.worker.queue_frames([LLMMessagesAppendFrame(
            [{"role": "user", "content": f"(cue) {what} {self.felt()}"}], run_llm=True)])

    async def watch(self, where, url):
        """One sensor program's stream: its movement numbers and heart rate, the Muse's EEG bands, and
        what the band's microphone heard. A body that does not rest gets calm words, unasked."""
        moves = collections.deque(maxlen=brain.WINDOW)
        while True:
            asked = None  # what the band's link last asked of the loop on this stream: on or off
            try:
                # read_bufsize: one event is one line, and the Muse's are long
                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=None), read_bufsize=2 ** 20) as http, \
                        http.get(url) as r:
                    async for line in r.content:
                        if where == "wrist" and line.startswith(b'data: {"t":"state"'):
                            m = json.loads(line[6:])
                            # The page has no switch for the agent (the user's rule, 2026-11-14): the band's
                            # is the one. The loop starts when the band is linked and ends when the band is
                            # switched off on its card, which also forgets it. A link lost for a moment and
                            # a band program that starts again end nothing: a new start is a new night and
                            # a new first sentence.
                            on = True if m["link"] == "streaming" else False if m["link"] == "idle" and not m["remembered"] else None
                            if on is not None and on != asked:
                                asked = on
                                err = await self.talk(on)
                                if err:  # no keys: the page says why the agent is silent
                                    self.err = err
                                    self.push_state()
                        if line.startswith(b'data: {"t":"text"'):
                            m = json.loads(line[6:])
                            if m["final"]:  # the band program's own transcript: its Microphone switch is on
                                brain.note(brain.today(), m["ts"], "heard", m["text"])
                        if not line.startswith(b'data: {"t":"stats"'):
                            continue
                        m = json.loads(line[6:])
                        moves.append(m["move"] if "move" in m else (m.get("motion") or {}).get("move"))  # band | Muse
                        self.seen[where] = (moves, m["bpm"] if "bpm" in m else (m.get("hr") or {}).get("bpm"))  # Polar | Muse
                        if "bands" in m:  # the Muse: the mean over the electrodes that sit well
                            good = [b for b, e in zip(m["bands"], m["eeg"]) if b and e and e["q"] < 3]
                            self.eeg.append([sum(c) / len(good) for c in zip(*good)] if good else None)
                        if self.worker and brain.restless(moves) and time.time() - self.spoke > CALM_GAP_S:
                            moves.clear()
                            await self.cue("The person moves a lot and does not rest.")
            except aiohttp.ClientError:
                pass
            await asyncio.sleep(1)  # that program is not up, or it restarts

    async def epochs(self):
        """Every half minute: the stage of sleep, from that half minute of every sensor."""
        while True:
            await asyncio.sleep(sleep.EPOCH_S)
            eeg, self.eeg = [b for b in self.eeg if b], []
            moves = [m for ms, _ in self.seen.values() for m in list(ms)[-2 * sleep.EPOCH_S:] if m is not None]
            if not eeg and not moves:
                continue  # no sensor is linked: no verdict
            was = self.night.now()["stage"]
            now = self.night.add([sum(c) / len(eeg) for c in zip(*eeg)] if len(eeg) > sleep.EPOCH_S else None,  # EEG for more than half of it
                                 sum(m > brain.MOVING_MG for m in moves) / len(moves) if moves else 0)
            self.push_state()
            if self.worker and time.time() - self.spoke > CALM_GAP_S:
                if (was, now) == ("awake", "drowsy"):
                    await self.cue("The person is falling asleep now.")
                elif was in sleep.SLEEP and now == "awake":  # a sleeper whose brain waves get fast, or who moves
                    await self.cue("The person was asleep and stirs: something disturbs their sleep.")

    async def sensors(self):
        """For as long as the program runs: every sensor program's stream, and the stage of sleep."""
        async with asyncio.TaskGroup() as all_of_them:
            for where, url in self.streams_of.items():
                all_of_them.create_task(self.watch(where, url))
            all_of_them.create_task(self.epochs())

    async def run_loop(self):
        try:
            runner = PipelineRunner(handle_sigint=False)
            await runner.add_workers(self.worker)
            await runner.run()
        except Exception as e:  # a pipeline that dies must leave the switch off and say why
            self.err = str(e) or type(e).__name__
        self.worker = None
        self.push_state()
        if brain.day_text(self.day):
            try:
                await brain.reflect(self.google, MODEL, self.day)
                self.push_state()  # the page draws the new notes
            except Exception as e:  # no credit, no internet: the day is in its file, the notes stay as they were
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
    ap.add_argument("--muse", default="http://127.0.0.1:5301", help="where live_muse.py answers")
    ap.add_argument("--polar", default="http://127.0.0.1:5302", help="where live_polar.py answers")
    args = ap.parse_args()
    logger.remove()
    logger.add(sys.stderr, level="INFO")  # Pipecat's default prints every frame
    voice = Voice(args.band + "/api/audio", {"wrist": args.band + "/api/stream", "head": args.muse + "/api/stream",
                                             "chest": args.polar + "/api/stream"})
    voice.run(args.port, [voice.sensors])


if __name__ == "__main__":
    main()
