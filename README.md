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

Use the switch on a card. A device that is not around yet is retried
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
fable, so the transcript can be tried with the key and no band. While the agent program runs, every
settled line is also kept in the day's file (see The brain): the people near the band must know
that too.

## Agent

The **Agent** switch, beside the Microphone switch, starts the voice loop at bedtime. The agent
does not ask how the day was: it knows the day from what the band heard (keep the Microphone
switch on through the day), and speaks from that. The band's microphone hears what you say back,
and the agent answers. Both sides
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

- `days/<date>.md`: the day, a line for each sentence: what the band's microphone heard while
  the Microphone switch was on (you and whoever was near), and both sides of the talk at night.
- `person.md`: the notes about you: what is on your mind, what comes up, what helps. The agent
  reads them and the day at the start of a talk, so it knows what weighs on you. When a talk
  ends, Gemini writes them again from the old notes and the day (`agent/reflect.md` says
  how). You can write into this file by hand; the notes before the last rewrite stay in
  `person.before.md`.

The agent also reads a calendar and the mail, so it knows what comes without asking. **Both are
made up for now**: `agent/mock/calendar.md` and `agent/mock/mail.md`, one line for each event or
message, and no real account is connected. Write your own lines there for a demo; one more file
in that folder is one more source. Their text goes to Google with each talk, like the notes.

The **Memory** card in the Live tab draws all of it as a graph: a dot for each note, each day and
each calendar or mail item, and a line from a note or an item to the days it names. Point at a
dot to read it. A hand edit shows after a reload of the page.

Before the agent answers, Google's decisions model (`gemini-decision-1`) gets one call with the
last lines of the talk and the sensors' numbers. It says which notes and which calendar or mail
items your words touch, and whether you sound worried. The agent answers with that in mind, and
the Memory card rings what was touched.

### Sleep

Every half minute the agent program scores the stage of sleep (`agent/sleep.py`): awake, drowsy,
light, deep or REM, from the Muse's EEG bands and from wrist and head movement, and it counts the
cycles of the night. With no Muse on the head it has only stillness and the clock, the way a
wrist tracker scores sleep. The rules were set by hand and no night was held against them: a
prototype's estimate, not a sleep lab's.

The **Arousal** graph in the Live tab draws how awake you are, as three lines on one clock, calm
at the bottom: how much the body moves (wrist and head), how fast the brain runs (the share of
alpha and beta in the EEG) and how much is said. Zoomed all the way out it is a night of 8 hours.
A pinch, or Cmd and a scroll, zooms; a sideways swipe pans; a click follows, with now in the
middle, and a second click goes back to the night. It begins when the page opens, and a reload of
the page starts it again.

While the agent is on, the sensors make it speak without being asked, one sentence each time,
about what the notes say comes up or weighs on you: when you go to bed, when you fall asleep
(awake to drowsy), and when you do not rest (10 moving seconds in 30). It waits two minutes after
its last words before the next one, and the deeper the sleep, the less it says. The movement
numbers are set for a demo by day (`agent/brain.py`, `CALM_GAP_S` in `agent/voice.py`).

## Record

The page has no record button. Each sensor program records on a command, under the label you
give it, into `data/` (git ignores it): `band-<label>/motion.csv`, `muse-<label>/muse.bin`,
`polar-<label>/raw/*.csv`.

```bash
# 5301 is the Muse, 5302 the Polar, 5303 the band; {"on": false} ends the recording
curl -H 'Content-Type: application/json' -d '{"on": true, "label": "20261114-2300"}' http://127.0.0.1:5303/api/record
```
