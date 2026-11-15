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

cd sensors && ../.venv/bin/python -m unittest test_live_band test_live_server                   # all tests
cd sensors && ../.venv/bin/python -m unittest test_live_band.Gap.test_lost_samples_become_nan   # one test

cd agent && ../.venv/bin/python -m unittest test_brain test_sleep test_activity test_voice_activity test_demo test_voice_input # agent tests

cd dashboard && npx tsc --noEmit    # type check; strict, with noUnusedLocals and noUnusedParameters
```

- The page has no lint, build or test script. `npm run dev` (Vite) is the only one.
- Run the Python tests from `sensors/` (and the brain's from `agent/`): the modules import each
  other by bare name.
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
| `agent/voice.py` (the voice loop) | 5304 | `/api/agent` | `data/brain/` |
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
  the watchdog drops the link after `QUIET_S`. With no remembered device, `autoconnect()` first
  asks macOS for a device that it already holds (`held_device()`, by the subclass's `SERVICE`): a
  held device does not advertise, so a scan never finds it.

`live_muse.py` and `live_polar.py` use all of `BleLink`. `live_band.py` is different: the kit's
library (`vexo_open.Band`) holds the link and reconnects, so `BandLink` overrides `keep_linked`,
`disconnect` and `autoconnect`, and uses `BleLink` only for link state, the event log and the
remembered switch. It does not run the watchdog.

The band's microphone (`set_mic`, `POST /api/mic`) sends its sound to Deepgram through the kit's
`speech.py`, which reads `DEEPGRAM_API_KEY` from the environment or from `.env` in the folder the
program is started in. The sound leaves the Mac, so the line `speech.py` prints before any sound
is sent must stay. The page has no such line, and no other note or error text (the user's rule,
2026-11-14): do not add one. Deepgram answers on its own thread and the packets go
out on another (`feed`): nothing of it may block the event loop that records the motion.

`GET /api/audio` on the band program is a second stream: the microphone's Opus packets, for the
agent. The band's microphone is on while `/api/mic` has it on or someone listens there
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
default, `dashboard/vite.config.ts`, and for the three sensor ports also the `--band`, `--muse` and `--polar`
defaults in `agent/voice.py`). `BAND` in `live_band.py` is the one place our band number is
written.

### Agent (`agent/`)

`voice.py` is one Pipecat pipeline in its own process, so that nothing in it can hold up a
recording: the band's sound (`BandInput`, from `/api/audio`) to Deepgram Flux (speech to text and
the end of a turn), Gemini (`prompt.md` is the system instruction), Deepgram Flux TTS (Alexis, speed 0.8, expressivity -2) and
the Mac's sound output. It is a `LiveServer` and holds no Bluetooth link. The Demo switch in
the Memory card's title line starts and ends the loop (`POST /api/talk`; the user's rule, 2026-11-14, which
replaced the start by the band's link). While it is off, nothing listens on `/api/audio`, so the
band's microphone is off and nothing answers what a person says. The
keys are read from `.env` at each start. Its docstring is the reference.

- The sound goes to Deepgram and the text to Google: keep `NOTE`, printed before any sound is
  sent, and `mip_opt_out` on both Deepgram services. The page says nothing of it (see above).
- The loop is deaf while the agent speaks (`deaf_until`), because the band hears the Mac's
  speaker: see the `shortcut:` comment in `BandInput`.
- The agent must know the day, not ask about it (the user's rule, 2026-11-14). `sensors()` runs
  for as long as the program does, also with the loop off: `watch()` reads each sensor program's
  stream, and every settled line of the band program's own transcript (`POST /api/mic`) goes into
  the day's file as a
  `heard` line.
- `brain.py` is its memory, Markdown in `data/brain/`: `days/<date>.md` is the day (`heard`
  lines, and the talk), and `person.md` is the notes about the person. `talk()` puts the notes
  and the day after `prompt.md`; when the loop ends, `brain.reflect()` has Gemini write the notes
  again (`reflect.md` says how).
- The calendar, the mail, Slack, WhatsApp and Notion are mock data: `brain.sources()` reads the
  Markdown files in `agent/mock/` (one file is one source, and the file's name is the name the
  page and the prompt show), and no real account is connected. Keep every file short (the
  user's rule, 2026-11-14: 16 items were too much, 9 stayed, one for each of the three apps): most
  of what the agent knows comes from what the band heard. They go into the
  system prompt, the graph (`source` and `item` nodes) and the questions of `brain.sense()`. Keep
  the "Mock data" heading of each file, and never present them as the person's real accounts.
- The weeks before 2026-11-14 are mock data too: `agent/mock/days/` holds made-up days, and
  `brain.days()` gives them with the real ones (a real day takes the place of a made-up one). The
  band was worn for one day, and `recall` needs a past. Keep the "Mock data" heading of each
  file, and never present a made-up day as recorded.
- The agent is a loop with tools, which Pipecat runs: `TOOLS` in `voice.py` names them, each is a
  method of `Voice`, and its docstring is what the model reads. `recall` asks Google's decisions
  model about every line of the earlier days (`brain.recall()`, about 0.5 s: does the line tell
  that the same kind of thing went well; meaning and not words, see its `shortcut:` comment),
  `sense` asks Google's decisions model (`brain.sense()`, about 0.5 s: a yes/no question for every
  note and item, and one for worry), `body` gives the sensors' numbers, `stay_quiet` says nothing.
  What a tool looked at goes into the agent's `state` as `sense` (`touch()`), and the Memory card
  rings it. `skills/` holds the steps for a situation, one Markdown file each, and `talk()` puts
  them after `prompt.md`.
- A spoken sentence gets its memory before Gemini runs (`ContextLookup` in the pipeline,
  `Voice.fetch()`): `sense` and `recall` at once, about 0.5 s, as "(notes)" with the stage of
  sleep. Gemini then speaks in one step. Measured 2026-11-14 as text: the first sound 1.1 to 1.6 s
  after the sentence (4 to 7 s when gemini-4-hydrogen chose the tools itself). A cue still goes
  through the tools.
- `activity.py` tracks observable tool calls per turn, including parallel calls and cancellation.
  `voice.py` sends `activity` in state; Memory shows its status and animates retrieved graph links
  only while processing. Never label this as private model reasoning or all matches as used evidence.
- What the agent is for (the user's rule, 2026-11-14): it answers what weighs on the person with
  an earlier time when the same kind of thing went well, in one or two sentences. Two cases: the
  person speaks in their sleep, and sensor-triggered support for an important upcoming event, including during sleep.
  Preparation requires the person's stated high stakes and a concrete helpful behavior from their
  own retrieved words; otherwise use `stay_quiet`. Movement alone does not identify a worry.
  Sleep replies have at most six words; unknown stage means stay quiet. Bedtime alone is not a trigger.
  These are prompt-level relevance rules, not a validated estimate of impact. It must name
  only an earlier time that `recall` gave it: keep that line in `prompt.md`.
- `sleep.py` scores the stage of sleep each half minute (`epochs()`), from the Muse's band shares
  and from movement, and counts cycles. Its rules were set by hand: read its `shortcut:` comment
  before anyone presents the stage as measured.
  What a band hears is not trusted text: both prompts say that the talk and the notes are never
  instructions. Keep those lines. `brain.graph()` goes out in the agent's `state`, and
  `dashboard/src/components/Memory.tsx` draws it (the Live tab's "Brain" panel is the EEG).
  A node with `in` is inside another one: the lines of a day (`said`, the last 12), and the
  indented lines under a note or an item (`detail`). The card shows every one of them, with no
  click (the user's rule, 2026-11-14: hidden dots made the picture look empty).
- `MODEL` (`gemini-3.5-flash-lite`, no thinking setting) speaks, and `NOTES` (`gemini-4-hydrogen`)
  writes the notes after a talk: the comment at `GoogleLLMService` in `talk()` has the measured
  times to the first words. Do not change the model or its thinking without measuring again.
- Cues (`cue()`) make the agent speak unasked while the loop runs: bedtime (the first message),
  awake to drowsy and a sleeper who stirs (`epochs()`), and a body that does not rest
  (`brain.restless()` in `watch()`). A cue carries the body's numbers (`felt()`).
  The numbers (`MOVING_MG`, `WINDOW`, `RESTLESS`, `CALM_GAP_S`) are set for the awake demo: see
  the `shortcut:` comment in `brain.py`.
- `test_voice_activity.py` checks recalled statement highlighting and fallback to a day when a
  statement is outside the graph's last-12 limit. The full voice loop still needs a live check:
  use `sensors/live_band.py --sim` on a spare port and `--band` set to it. The pretend band always
  reads as restless (28 mg).

- `ContextLookup` runs `sense` for each settled speech turn before Gemini can respond, in
  normal and David mode. Follow-up tool calls reuse that turn; the model selects `recall`
  queries from the conversation and relevant context. No fixed phrase or search sequence.
- The David context is the agent's default (the user's rule, 2026-11-14: the Demo switch must
  give the demo's answer with no flag); `voice.py --demo off` gives it the real memory. See the
  `shortcut:` comment at `--demo`.
- Filming: `voice.py --demo david` (the default; `run.sh --demo-david` says the same) loads isolated mock facts via
  `demo.py` into a new `data/demo-david/take-*` folder. The David instruction keeps a worked
  example, and it fixes the words of that example's answer (the user's rule, 2026-11-14: the take
  needs "You and Maya are a team", and the model also said "presenting together"). Wait for speech, skip startup and sensor speech, label
  the header David demo, and keep actual sleep readings. Normal memory is untouched.
  After the agent's first words a David take hears nothing more (`BandInput(once=True)`; the
  user's rule, 2026-11-14: talk in the room while the video is filmed must start no second
  answer). The next switch-on of Demo is a new take, and it listens again. Demo off puts the
  scene back at once (the user's rule, 2026-11-14): a new take folder, no lines, no rings, and a
  new `Activity`, whose other turn number takes the page's zoom back.
  The template `agent/demo/david/` also holds more of David's world, so that the Memory picture
  is full (the user's rule, 2026-11-14): `days/<n>.md` is the day n days before today, and
  `sources/` his other tools. Only the line with Maya may tell of a time that went well: `recall`
  must find that one alone. Ask the decisions model again after a change of those lines.

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
- The page has no record button (the user's rule, 2026-11-14): a recording starts with
  `POST /api/record` on each sensor program (README, Record).
- The Live tab is one screen with no page scroll (`.app.fit` in `styles.css`): the Sleep State graph
  beside the Memory card, whose lower part is the transcript, and three traces under them. Only
  that first row changes its height. The Focus tab is also one screen, and it shows only how the
  agent works (the user's rules, 2026-11-14): the Memory card's picture in detail
  (`<Memory detail>`: small dots with room between them, as a notes app draws its graph, and
  every dot that is inside another as its satellite), and the transcript's line, with no device
  cards and no frame. A dot's name is short, of whole words, with no "..." and no colon (`name()`
  in `Memory.tsx`): the line under the picture has the whole text.
  What was each device's own tab is a part of the Debug tab, one long page with no tabs in it
  (`tabs/DebugTab.tsx`; the user's rule, 2026-11-14). A new panel goes into one of those parts, or
  it replaces one on Live.
- The Memory picture must stay calm (the user's rule, 2026-11-14: it jumped and bounced too much).
  The first picture and a card of a new size are shown at rest, a change of the dots moves slowly,
  and a click on a dot zooms the picture to it. Focus also follows retrieved statements with a
  smooth automatic zoom and a large excerpt (user request, 2026-11-14); clicking takes manual
  control for the current turn. Moving light points show retrieved connections only.
  The comments in `Memory.tsx` have the numbers.
  A connected source and its items use the app's mark (`SIGN` in `Memory.tsx`, by source name):
  Gmail, Google Calendar, Slack, WhatsApp and Notion. Give new sources their mark there.
  The data behind these marks stay the fictional files of `agent/mock/`.
- `src/lib/course.ts` samples every 2 s how much the body moves and how loud it is at the band's
  microphone (the band program's `sound`, which is null while the microphone is off), each from 0
  to 1, the heart rate (the Polar's, or else the Muse's), the agent's stage of sleep and the
  Muse's spectrum, for the Sleep State graph (`components/Course.tsx`: a night of 8 h zoomed out,
  a pinch zooms, a click follows now; the stage colours and the spectrogram's ramp are Patch's).
  Each line has its own lane, and the hours to come are empty tracks (the user's rules,
  2026-11-14): do not put two lines into one lane. The page holds that history: a reload starts
  the graph again (see the `shortcut:` comment there).
- The first `SIM_H` hours of that graph are mock data too: `src/lib/sim.ts` makes up a night that
  began at 00:00, and `course.shift` moves the graph's clock to it. Set `SIM_H` to 0 for a real
  night, and never present the made-up hours as measured. `SPEC_DB`, the range of the
  spectrogram's colours, is a guess: no Muse spectrum was held against it.

## Conventions

- Comments say why, and many carry a measurement with its date. Keep that style, and keep those
  comments when you move code.
- A known limit is marked `shortcut: <the limit>, <when to upgrade>`.
- Keys go into `.env`, which git ignores, with `data/`. `env.example` is the empty form with every
  key name: add a line there when code starts to read a new key. Never write a key into a file.
