# Hypnos

When you sleep, everything sleeps except your ears. Hypnos uses that: a channel where your agent
and you talk while you fall asleep. Built at VexoHacks, 2026-11-14. A prototype, not a medical device.

This repo so far: the live dashboard for the three sensors, and the band's microphone as text.

| Sensor | What it gives | Program | Port |
|---|---|---|---|
| Vexo band (wrist) | acceleration, turning, gestures, steps, battery, signal, microphone as text | `sensors/live_band.py` | 5303 |
| Muse S (head) | EEG, band power, PPG, head movement | `sensors/live_muse.py` | 5301 |
| Polar H10 (chest) | heart rate, R-R, 130 Hz ECG | `sensors/live_polar.py` | 5302 |

The page (`dashboard/`, port 5300) is only a view. The three programs hold the Bluetooth links and
write the recordings, so closing the tab never interrupts anything.

## Setup (once)

```bash
gh repo clone VexoAI-Org/vexo-open-kit            # the kit stays a reference: git ignores the folder
uv venv .venv && uv pip install -p .venv/bin/python -r requirements.txt
(cd dashboard && npm install)
```

Keys go into `.env` in this folder (`cp env.example .env`, then write each key after its `=`).
Git ignores `.env`; never commit a key and never paste one into a chat. The transcript needs
`DEEPGRAM_API_KEY`. Everything else works with no key. `GOOGLE_API_KEY` and `ELEVENLABS_API_KEY`
have a line in the form for the agent; nothing reads them yet.
`.venv/bin/python vexo-open-kit/examples/python/check_keys.py` says whether the keys work.

## Run

```bash
./run.sh          # the three programs and the page: http://localhost:5300
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

## Record

**Start night** records every device that is switched on, under one label, into `data/`
(git ignores it): `band-<label>/motion.csv`, `muse-<label>/muse.bin`, `polar-<label>/raw/*.csv`.
**Stop night** ends it.
