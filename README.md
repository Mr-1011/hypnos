# Hypnos

When you sleep, everything sleeps except your ears. Hypnos uses that: a channel where your agent
and you talk while you fall asleep. Built at VexoHacks, 2026-11-14. A prototype, not a medical device.

This repo so far: the live dashboard for the three sensors, the band's microphone as text, and the
voice loop (the band hears you, an agent answers with a soft voice).

| Sensor | What it gives | Program | Port |
|---|---|---|---|
| Vexo band (wrist) | acceleration, turning, gestures, steps, battery, signal, microphone as text | `sensors/live_band.py` | 5303 |
| Muse S (head) | EEG, band power, PPG, head movement | `sensors/live_muse.py` | 5301 |
| Polar H10 (chest) | heart rate, R-R, 130 Hz ECG | `sensors/live_polar.py` | 5302 |

The page (`dashboard/`, port 5300) is only a view. The three programs hold the Bluetooth links and
write the recordings, so closing the tab never interrupts anything. The agent (`agent/voice.py`,
port 5304) is a fourth program: it takes the band's sound from `live_band.py` and holds no link.

## Setup (once)

```bash
gh repo clone VexoAI-Org/vexo-open-kit            # the kit stays a reference: git ignores the folder
brew install portaudio                            # the agent's voice on the Mac's sound output
uv venv .venv && uv pip install -p .venv/bin/python -r requirements.txt
(cd dashboard && npm install)
```

Keys go into `.env` in this folder (`cp env.example .env`, then write each key after its `=`).
Git ignores `.env`; never commit a key and never paste one into a chat. The transcript needs
`DEEPGRAM_API_KEY`. The agent needs `DEEPGRAM_API_KEY` and `GOOGLE_API_KEY` (from AI Studio, in a
project that has credit). Everything else works with no key. `ELEVENLABS_API_KEY` has a line in
the form; nothing reads it yet.
`.venv/bin/python vexo-open-kit/examples/python/check_keys.py` says whether the keys work.

## Run

```bash
./run.sh          # the three programs, the agent and the page: http://localhost:5300
./run.sh --sim    # the kit's pretend band in place of the real one
```

Ctrl-C ends everything. `run.sh` starts a program again if it exits.

## Connect the devices

Press **Connect all**, or use the switch on a card. A device that is not around yet is retried
until it appears. Switch off unlinks and forgets the device.

- **Vexo band:** double-tap it (it blinks blue and can be found for 60 seconds). It takes one
  Bluetooth connection: close the kit's own dashboard tab first. Only our band number is ever
  looked for (`BAND` in `sensors/live_band.py`).
- **Muse S:** switch it on and close Mind Monitor and the Muse app first; either one holds the band.
- **Polar H10:** it advertises only while worn, so wet the pads and put it on. macOS may ask to
  pair on the first link. The phone app can run beside it.

The first link of the Muse and of the Polar takes the first matching device a search finds. Check
the name on the card: with other straps in the room it can be the wrong one. Switch off and on to
search again.

## Transcript

The **Microphone** switch in the Live tab turns the band's microphone on and shows what it hears as
text, while people speak. The sound goes over the internet to Deepgram, a company: tell the people
near the band first, and switch it off when someone asks. The band's light is solid blue while the
microphone is on. The text is English (`speech.create()` in `sensors/live_band.py` takes
`language="de"`). With `./run.sh --sim` the pretend band plays a recording of a person reading a
fable, so the transcript can be tried with the key and no band. The text is shown, not saved.

## Agent

The **Agent** switch, beside the Microphone switch, starts the voice loop: the agent asks one
gentle question, the band's microphone hears the answer, and the agent answers back. Both sides
show in the Transcript panel. The voice plays on the Mac's sound output (the band has no
speaker): the speakers, or AirPods linked to the Mac.

Deepgram hears (Flux, which also decides when you have finished) and speaks (Aura); Gemini writes
the answers from `agent/prompt.md`, about 2 s after you stop. So the band's sound goes to Deepgram, and what is said goes as
text to Google: tell the people near the band first. One switch at a time: with the agent on, the
Microphone switch is locked.

The band hears the Mac's speaker, so the agent does not listen while it speaks: you cannot
interrupt it.

### The brain

The agent keeps what it learns as Markdown in `data/brain/` (git ignores it; it stays on this Mac,
and the notes go to Google as text with each talk):

- `days/<date>.md`: every line of that day's talk, both sides.
- `person.md`: the notes about you: what is on your mind, what comes up, what helps. The agent
  reads them at the start of a talk, so it can connect what you say to what it knows. When a talk
  ends, Gemini writes them again from the old notes and the day's talk (`agent/reflect.md` says
  how). You can write into this file by hand; the notes before the last rewrite stay in
  `person.before.md`.

The **Memory** card in the Live tab draws both as a graph: a dot for each note and each day, and a
line from a note to the days it names. Point at a dot to read it. A hand edit shows after a
reload of the page.

Before the agent answers, Google's decisions model (`gemini-decision-1`) gets one call with the
last lines of the talk and the sensors' numbers. It says which notes your words touch, whether
you sound worried, and the state you seem to be in: awake, drowsy, asleep or restless. The agent
answers with that in mind, and the Memory card rings the touched notes and shows the state. The
state is a guess from words and movement, not a sleep stage.

While the agent is on it also watches how much the wrist (band) and the head (Muse) move. When
you do not rest, 10 moving seconds in 30, it says one calm sentence without being asked, about
what the notes say comes up or weighs on you. It waits two minutes after its last words before it
does that again. These numbers are set for a demo by day, not from a real night
(`agent/brain.py`, `CALM_GAP_S` in `agent/voice.py`).

## Record

**Start night** records every device that is switched on, under one label, into `data/`
(git ignores it): `band-<label>/motion.csv`, `muse-<label>/muse.bin`, `polar-<label>/raw/*.csv`.
**Stop night** ends it.
