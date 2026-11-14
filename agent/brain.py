"""brain.py - what Hypnos keeps about the person, as Markdown that a person can read and edit.

    data/brain/days/<date>.md   what was said in that day's talk, both sides, one line each
    data/brain/person.md        the notes: what is on the person's mind, what comes up, what helps.
                                Gemini writes them again after a talk (reflect.md says how) and
                                the agent reads them at the start of the next one.
    data/brain/person.before.md the notes as they were before the last rewrite

It is the person's own speech, so it lives in data/, which git ignores. The notes go to Google as
text with every talk, like the talk itself.

    cd agent && ../.venv/bin/python -m unittest test_brain
"""
import time
from pathlib import Path

from google import genai

HERE = Path(__file__).resolve().parent
DIR = HERE.parent / "data" / "brain"

# shortcut: these three are set for the awake demo, from one afternoon and no real night; set them
# again from recorded nights, where restless is a few turns in minutes and not 10 s of moving.
MOVING_MG = 20  # band 61, 2026-11-14: 1 mg on the desk, 4 to 8 mg held still, 41 mg in a small move
WINDOW = 60     # the movement numbers one verdict looks at: 30 s, at 2 a second
RESTLESS = 20   # that many of them moving: 10 of the 30 s


def today():
    """The date a talk belongs to. Before 06:00 it is still the day that ends."""
    return time.strftime("%Y-%m-%d", time.localtime(time.time() - 6 * 3600))


def note(day, ts, who, text):
    f = DIR / "days" / f"{day}.md"
    f.parent.mkdir(parents=True, exist_ok=True)
    if not f.exists():
        f.write_text(f"# {day}\n\n")
    with f.open("a") as out:
        out.write(f"- {time.strftime('%H:%M', time.localtime(ts / 1000))} **{who}**: {text}\n")


def notes():
    f = DIR / "person.md"
    return f.read_text() if f.exists() else ""


def restless(moves):
    """True when the last movement numbers (mg; None = no number) are of a body that does not rest."""
    return sum(1 for m in moves if m is not None and m > MOVING_MG) >= RESTLESS


async def reflect(key, model, day):
    """Write the notes again, from the notes so far and the day's talk."""
    old = notes()
    client = genai.Client(api_key=key)  # under a name: unnamed, it is collected and closed mid-request
    r = await client.aio.models.generate_content(
        model=model, config={"system_instruction": (HERE / "reflect.md").read_text()},
        contents=f"<notes>\n{old}</notes>\n\n<talk>\n{(DIR / 'days' / f'{day}.md').read_text()}</talk>")
    if r.text:
        if old:
            (DIR / "person.before.md").write_text(old)  # a bad rewrite must not cost what a person wrote by hand
        (DIR / "person.md").write_text(r.text.strip() + "\n")
