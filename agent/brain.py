"""brain.py - what Hypnos keeps about the person, as Markdown that a person can read and edit.

    data/brain/days/<date>.md   the day, one line each: what the band's microphone heard while its
                                switch was on (**heard**: the person and whoever was near), and
                                both sides of the talk with the agent (**you**, **agent**)
    data/brain/person.md        the notes: what is on the person's mind, what comes up, what helps.
                                Gemini writes them again after a talk (reflect.md says how) and
                                the agent reads them at the start of the next one.
    data/brain/person.before.md the notes as they were before the last rewrite

It is the person's own speech, so it lives in data/, which git ignores. The notes go to Google as
text with every talk, like the talk itself.

    cd agent && ../.venv/bin/python -m unittest test_brain
"""
import re
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
DIR = HERE.parent / "data" / "brain"

# shortcut: these three are set for the awake demo, from one afternoon and no real night; set them
# again from recorded nights, where restless is a few turns in minutes and not 10 s of moving.
MOVING_MG = 20  # band 61, 2026-11-14: 1 mg on the desk, 4 to 8 mg held still, 41 mg in a small move
WINDOW = 60     # the movement numbers one verdict looks at: 30 s, at 2 a second
RESTLESS = 20   # that many of them moving: 10 of the 30 s

# Google's decisions model: one input, many closed questions, calibrated answers and no text.
# 0.7 s for two questions on 2026-11-14.
SENSE = "gemini-decision-1"


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


def day_text(day):
    f = DIR / "days" / f"{day}.md"
    return f.read_text() if f.exists() else ""


def sources():
    """What the agent is connected to besides the band, as {name: a Markdown list}.
    shortcut: made-up files in agent/mock/ (calendar.md, mail.md; one more file is one more source),
    replace them with the person's real calendar and mail when there is a login for those."""
    return {f.stem: f.read_text() for f in sorted((HERE / "mock").glob("*.md"))}


def recall(words, before):
    """What the earlier days hold about a thing: their lines with one of the words in them, as
    [(day, line)], the newest day first. before: the day of the talk, which is not an earlier day.
    shortcut: it finds words, not meaning, and reads every day's file; give the days an index that
    finds meaning when the band has been worn for more than a few months."""
    words = [w.lower() for w in words]
    return [(f.stem, line[2:]) for f in sorted((DIR / "days").glob("*.md"), reverse=True) if f.stem < before
            for line in f.read_text().splitlines() if line.startswith("- ") and any(w in line.lower() for w in words)][:30]


def graph():
    """The brain as nodes and links, for the page: the person, the headings of the notes and their
    lines, the connected sources and their items, and the days. A line or an item that names a
    date is linked to that day."""
    nodes = {"person": {"id": "person", "label": "the person", "kind": "person"}}
    links = []
    for f in sorted((DIR / "days").glob("*.md")):
        nodes[f.stem] = {"id": f.stem, "label": f.stem, "kind": "day"}
        links.append(["person", f.stem])
    for hub, leaf, doc in [("head", "line", notes())] + [("source", "item", f"## {name}\n{text}") for name, text in sources().items()]:
        head = None
        for line in doc.splitlines():
            text = line.strip().lstrip("-* ").strip()
            if line.startswith("## "):
                head = line[3:].strip()
                nodes[head] = {"id": head, "label": head, "kind": hub}
                links.append(["person", head])
            elif head and text and not line.startswith("#"):
                nodes[f"{head}/{text}"] = {"id": f"{head}/{text}", "label": text, "kind": leaf}
                links.append([head, f"{head}/{text}"])
                for day in set(re.findall(r"\d{4}-\d{2}-\d{2}", text)):
                    nodes.setdefault(day, {"id": day, "label": day, "kind": "day"})  # a day with no talk yet: one that comes
                    links.append([f"{head}/{text}", day])
    return {"nodes": list(nodes.values()), "links": links}


def restless(moves):
    """True when the last movement numbers (mg; None = no number) are of a body that does not rest."""
    return sum(1 for m in moves if m is not None and m > MOVING_MG) >= RESTLESS


async def sense(client, said, body):
    """What the decisions model makes of this moment: the notes and the items of the connected
    sources that the person's words touch, and
    whether they sound worried. said: the last lines of the talk. body: the stage of sleep and the
    sensors' numbers, in words. client: a genai.Client, held by the caller."""
    lines = [n for n in graph()["nodes"] if n["kind"] in ("line", "item") and not n["id"].startswith("Days/")]
    questions = {f"n{i}": {"type": "noul", "instructions": f"The person's last words are about this: {n['label']}"}
                 for i, n in enumerate(lines)}
    questions["worried"] = {"type": "noul", "instructions": "The person sounds worried or tense."}
    a = (await client.aio.decisions.create(model=SENSE, input=f"{said}\n\n{body}", questions=questions)).answers
    return {"about": [n["id"] for i, n in enumerate(lines) if a[f"n{i}"].noul > 0.5],
            "worried": round(a["worried"].noul, 2)}


async def reflect(client, model, day):
    """Write the notes again, from the notes so far and the day's talk."""
    old = notes()
    r = await client.aio.models.generate_content(
        model=model, config={"system_instruction": (HERE / "reflect.md").read_text()},
        contents=f"<notes>\n{old}</notes>\n\n<day>\n{day_text(day)}</day>")
    if r.text:
        if old:
            (DIR / "person.before.md").write_text(old)  # a bad rewrite must not cost what a person wrote by hand
        (DIR / "person.md").write_text(r.text.strip() + "\n")
