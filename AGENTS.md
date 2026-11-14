# AGENTS.md

Guidance for coding agents that work in this repository. `CLAUDE.md` imports this file.

Hypnos is a hackathon prototype (VexoHacks, 2026-11-14): a channel between a person and their agent
while the person falls asleep. So far the repo holds the live dashboard for three Bluetooth sensors,
the live transcript of the band's microphone, and the voice loop (the band hears the person, an
agent answers aloud).
`README.md` covers setup, how to pair each device, and how to record a night.

## Commands

```bash
./run.sh                 # the three sensor programs, the agent and the page: http://localhost:5300
./run.sh --sim           # the kit's pretend band, no hardware (only the band has one)

cd sensors && ../.venv/bin/python -m unittest test_live_band                                    # all tests
cd sensors && ../.venv/bin/python -m unittest test_live_band.Gap.test_lost_samples_become_nan   # one test

cd dashboard && npx tsc --noEmit    # type check; strict, with noUnusedLocals and noUnusedParameters
```

- The page has no lint, build or test script. `npm run dev` (Vite) is the only one.
- Run the Python tests from `sensors/`: the modules import each other by bare name.
- `vexo-open-kit/` must be cloned at the repo root (README, Setup). `live_band.py` puts
  `vexo-open-kit/python` (the library) and `vexo-open-kit/examples/python` (`speech.py`, the
  Deepgram client) on `sys.path`. The folder is a reference clone that git ignores, with its own
  `AGENTS.md`: never edit it and never commit it. Its rules on the band number, the keys and the
  microphone hold here too.
- Python packages go into `.venv` with `uv` (`requirements.txt` pins them). The agent's sound
  output needs `brew install portaudio`.
- macOS only: the recorders start `caffeinate`, and `BleLink.known_device()` uses CoreBluetooth.

## Architecture

Five processes, all started by `run.sh`:

| Process | Port | Page prefix | Writes |
|---|---|---|---|
| `sensors/live_muse.py` (Muse S) | 5301 | `/api/muse` | `data/muse-<label>/` |
| `sensors/live_polar.py` (Polar H10) | 5302 | `/api/polar` | `data/polar-<label>/` |
| `sensors/live_band.py` (Vexo band) | 5303 | `/api/band` | `data/band-<label>/` |
| `agent/voice.py` (the voice loop) | 5304 | `/api/agent` | nothing |
| `dashboard/` (Vite + React) | 5300 | - | nothing |

**The page is only a view.** The sensor programs hold the Bluetooth links and write the recordings.
Closing the tab or stopping Vite must never interrupt a night. Keep device and recording logic out of
`dashboard/`.

### Sensor programs (`sensors/`)

`live_server.py` is the shared base, standard library only:

- `LiveServer`: a hand-written asyncio HTTP server on `127.0.0.1`. `GET /api/stream` is the
  server-sent-events stream (state first, then whatever the program broadcasts, and a
  `{"t":"ping"}` each idle second). A program can offer more streams in `self.streams` (path to
  its own set of clients; `broadcast(obj, clients)` writes to one). Every other request goes to
  `route()`. It refuses a non-loopback
  `Host` and any `POST` that is not JSON: that is the guard against other web pages commanding a
  device, so keep it.
- `BleLink(LiveServer)`: one device kept linked. Scan, connect, reconnect forever with every call
  bounded by a timeout, a watchdog that drops a silent link, and the remembered device
  (`data/.recorder-<prefix>.json`). A subclass supplies `match(name)` and `setup(client)`, and may
  supply `kick()` and `before_disconnect()`. Every notification handler must set `self.last_rx`, or
  the watchdog drops the link after `QUIET_S`.

`live_muse.py` and `live_polar.py` use all of `BleLink`. `live_band.py` is different: the kit's
library (`vexo_open.Band`) holds the link and reconnects, so `BandLink` overrides `keep_linked`,
`disconnect` and `autoconnect`, and uses `BleLink` only for link state, the event log and the
remembered switch. It does not run the watchdog.

The band's microphone (`set_mic`, `POST /api/mic`) sends its sound to Deepgram through the kit's
`speech.py`, which reads `DEEPGRAM_API_KEY` from the environment or from `.env` in the folder the
program is started in. The sound leaves the Mac, so two lines must stay: the one `speech.py` prints
before any sound is sent, and the one the page shows while a switch is on
(`dashboard/src/components/Transcript.tsx`). Deepgram answers on its own thread and the packets go
out on another (`feed`): nothing of it may block the event loop that records the motion.

`GET /api/audio` on the band program is a second stream: the microphone's Opus packets, for the
agent. The band's microphone is on while the switch is on or someone listens there
(`mic_wanted()`), so a listener that goes away, or crashes, switches it off.

Each program's docstring is the reference for its HTTP API, its recording format and the measured
protocol facts. Read it before changing a decoder.

Message types on every stream, told apart by `t`: `state` (link and recording), `data` (samples,
20 Hz batches), `stats` (2 Hz), `event` (a log line), `ping`. The band also sends `text` (what the
microphone heard: guesses with `final` 0, then the settled line). The agent sends only `state`,
`text` (with `who`: `you` or `agent`) and `ping`.

Recording rules that span files:

- A lost sample or packet becomes NaN, so every trace keeps its sample clock.
- `"final": 1` in a recording's meta is written only by Stop. Ctrl-C, SIGTERM and a crash leave 0.
- Muse and Polar resume: a restarted program appends to a `final: 0` recording written in the last
  `RESUME_S` seconds (`resumable()`). The band does not: see the `shortcut:` comment on
  `BandRecorder`.
- `run.sh` restarts a program that exits, so a restart mid-night must append, never overwrite.

Numbers written in two places, change both together: the band's motion rate (`RATE` in
`live_band.py`, `MOTION_HZ` in `dashboard/src/lib/band.ts`) and the ports (each program's `--port`
default, `dashboard/vite.config.ts`, and for the band's port also the `--band` default in
`agent/voice.py`). `BAND` in `live_band.py` is the one place our band number is
written.

### Agent (`agent/`)

`voice.py` is one Pipecat pipeline in its own process, so that nothing in it can hold up a
recording: the band's sound (`BandInput`, from `/api/audio`) to Deepgram Flux (speech to text and
the end of a turn), Gemini (`prompt.md` is the system instruction), Deepgram Aura (the voice) and
the Mac's sound output. It is a `LiveServer` and holds no Bluetooth link. `POST /api/talk` starts
and ends the loop; the keys are read from `.env` at each start. Its docstring is the reference.

- The sound goes to Deepgram and the text to Google: keep `NOTE`, printed before any sound is
  sent, the page's line while the Agent switch is on, and `mip_opt_out` on both Deepgram services.
- The loop is deaf while the agent speaks (`deaf_until`), because the band hears the Mac's
  speaker: see the `shortcut:` comment in `BandInput`.
- It has no test. Try it with `sensors/live_band.py --sim` on a spare port and `--band` set to it.

### Page (`dashboard/`)

- `vite.config.ts` proxies `/api/<device>/...` to that program's port as `/api/...`. `cors` is off
  on purpose.
- `src/lib/sse.ts`: `Source` wraps one program's `EventSource`, with the online flag (offline after
  3 s without a message) and its own reconnect. `post()` sends the JSON commands.
- `src/lib/{band,muse,polar}.ts`: one singleton store for each device, and `agent.ts` for the
  voice loop. Samples go into `Ring`
  buffers (`ring.ts`, addressed by absolute sample number) and do not render React. Only `state`,
  `stats` and `event` messages do, through `useSyncExternalStore`. The canvas components
  (`Traces`, `Strip`, `Spectrogram`) read the rings in their own animation frames.
- `src/lib/night.ts`: Start night, Stop night and Connect all. They fan one command out to the
  three programs under one label.

## Conventions

- Comments say why, and many carry a measurement with its date. Keep that style, and keep those
  comments when you move code.
- A known limit is marked `shortcut: <the limit>, <when to upgrade>`.
- Keys go into `.env`, which git ignores, with `data/`. `env.example` is the empty form with every
  key name: add a line there when code starts to read a new key. Never write a key into a file.
