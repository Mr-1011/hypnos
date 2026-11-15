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

The lower part of the **Memory** card in the Live tab shows what the band's microphone hears as
text, while people speak, and what the agent answers: one line, the newest. The agent listens
while the **Demo** switch in the Memory card's title line is on (see Agent). The sound goes over the internet to Deepgram, a company: tell
the people near the band first, and switch the demo off when someone asks. The band's
light is solid blue while the microphone is on. With `./run.sh --sim` the pretend band plays a
recording of a person reading a fable, so the transcript can be tried with the keys and no band.

The band program can also write the text with no agent: `POST /api/mic` with `{"on": true}` on
port 5303, not while the agent is on, or every sentence shows twice. That text is English
(`speech.create()` in `sensors/live_band.py` takes `language="de"`). While the agent program
runs, every settled line of it is also kept in the day's file (see The brain): the people near
the band must know that too.

## Agent

The **Demo** switch in the Memory card's title line starts and ends the voice loop. While it is off, the band's
microphone is off and nothing reacts to what you say. The agent
does not ask how the day was: it knows the day from what the band heard, and speaks from that.
The band's microphone hears what you say back,
and the agent answers. Both sides
show in the Transcript panel. The voice plays on the Mac's sound output (the band has no
speaker): the speakers, or AirPods linked to the Mac.

Deepgram hears (Flux, which also decides when you have finished) and speaks (Flux TTS, the voice Alexis at speed 0.7); Gemini writes
the answers from `agent/prompt.md`, about 4 s after you stop. So the band's sound goes to Deepgram, and what is said goes as
text to Google: tell the people near the band first.

The band is made to be worn for weeks and months, and the agent uses that. When something weighs
on you at night, it answers with an earlier time when the same kind of thing went well: "Four
weeks ago your presentation went well. Tomorrow can go the same way." It does that in two cases:
you speak in your sleep, or you say nothing and the body shows stress (see Sleep).

For that the agent works in a loop with tools. It calls the ones it needs, and then it speaks:

- `recall` searches the earlier days for a kind of thing ("presentation pitch talk"). It finds
  words, not meaning.
- `sense` asks Google's decisions model (`gemini-decision-1`) which notes and which calendar or
  mail items your last words touch, and whether you sound worried.
- `body` gives the stage of sleep, the movement and the heart rate.
- `stay_quiet` says nothing, for a sleeper whom words would wake.

`agent/skills/` holds the steps for each case, one Markdown file each: write one more file there
for one more situation. The Memory card rings what the tools looked at: the earlier days that
`recall` found, and what `sense` named.

The band hears the Mac's speaker, so the agent does not listen while it speaks: you cannot
interrupt it.

### The brain

The agent keeps what it learns as Markdown in `data/brain/` (git ignores it; it stays on this Mac,
and the notes go to Google as text with each talk):

- `days/<date>.md`: the day, a line for each sentence: what the band program's own transcript
  heard (you and whoever was near), and both sides of the talk at night.
- `person.md`: the notes about you: what is on your mind, what comes up, what helps. The agent
  reads them and the day at the start of a talk, so it knows what weighs on you. When a talk
  ends, Gemini writes them again from the old notes and the day (`agent/reflect.md` says
  how). You can write into this file by hand; the notes before the last rewrite stay in
  `person.before.md`.

The agent also reads a calendar and the mail, so it knows what comes without asking. **Both are
made up for now**: `agent/mock/calendar.md` and `agent/mock/mail.md`, one line for each event or
message, and no real account is connected. Write your own lines there for a demo; one more file
in that folder is one more source. Their text goes to Google with each talk, like the notes.

**The weeks before today are made up too.** The band was worn for one day, and the agent needs a
past to find an earlier success in. `agent/mock/days/` holds a few made-up days, one file each in
the form of a real day's file, and each says that it is mock data. Write your own days there for
a demo, and delete the folder when the band has been worn for real weeks.

The **Memory** card in the Live tab draws all of it as a graph: a dot for each note, each day and
each calendar or mail item, and a line from a note or an item to the days it names. Point at a
dot to read it. A connected tool and what came from it have a small mark in place of the dot:
Gmail's for the mail, Google Calendar's for the calendar. A mark says what kind of tool it is, and
the data behind it stay made up. A click on a dot brings it near: the picture grows about it, and
a second click, or a click beside the dots, goes back. A hand edit shows after a reload of the page.

### Sleep

Every half minute the agent program scores the stage of sleep (`agent/sleep.py`): awake, drowsy,
light, deep or REM, from the Muse's EEG bands and from wrist and head movement, and it counts the
cycles of the night. With no Muse on the head it has only stillness and the clock, the way a
wrist tracker scores sleep. The rules were set by hand and no night was held against them: a
prototype's estimate, not a sleep lab's.

The **Sleep State** graph in the Live tab draws the night on one clock. Along the top is the stage
of sleep, in colours. Under it are three lanes, calm at the bottom of each: how much the body
moves (wrist and head), how loud it is at the band's microphone (while the microphone is on), and
the heart rate, from the chest strap or else from the Muse. The heart's lane shows only the beats
a minute that are in view, with the two numbers at its right end, so a change of 3 or 4 beats is
seen. At the bottom is the brain: the spectrogram of the EEG from 1 to 32 Hz, dark violet where
it is quiet and yellow where it is loud, so deep sleep is a bright band at the bottom and a move
is a stripe over every frequency. Zoomed all the way out the graph is a night of 8 hours, and the
hours still to come are empty tracks. A pinch, or Cmd and a scroll, zooms; a sideways swipe pans;
a click follows, with now in the middle, and a second click goes back to the night. No view goes
back before the start of the night.

The **Focus** tab shows only how the agent works: the picture of the Memory card in detail, as
large as the screen, with the one line of words under it, and no device over it. The dots are
small there, and what a day or an item holds is a ring of smaller dots around it. The numbers and charts of
each single device are in the **Debug** tab, one long page.

**The first four hours of that night are made up, for the demo.** The page opens in the middle of
a night that began at 00:00: two cycles of sleep, and two moments in them (one with movement and
a few words, one with movement only; the heart jumps at both). They come from
`dashboard/src/lib/sim.ts`. Only what the graph draws after the page opened is measured. Set `SIM_H` in `dashboard/src/lib/course.ts` to 0 for a graph
that begins when the page opens, on the real clock. A reload of the page starts the graph again.

While the agent is on, the sensors make it speak without being asked,
about what the notes say comes up or weighs on you: when you go to bed, when you fall asleep
(awake to drowsy), when you were asleep and stir (the brain runs fast again, or the body moves),
and when you do not rest (10 moving seconds in 30). It waits two minutes after
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
