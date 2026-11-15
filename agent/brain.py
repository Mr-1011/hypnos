"""brain.py - what Hypnos keeps about the person, as Markdown that a person can read and edit.

    data/brain/days/<date>.md   the day, one line each: what the band's microphone heard while its
                                switch was on (**heard**: the person and whoever was near), and
                                both sides of the talk with the agent (**you**, **agent**)
    data/brain/person.md        the notes: what is on the person's mind, what comes up, what helps.
                                Gemini writes them again after a talk (reflect.md says how) and
                                the agent reads them at the start of the next one.
    data/brain/person.before.md the notes as they were before the last rewrite

It is the person's own speech, so it lives in data/, which git ignores. The notes go to Google as
text with every talk, like the talk itself, and the lines of the earlier days with every recall.

    cd agent && ../.venv/bin/python -m unittest test_brain
"""
import re
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
DIR = HERE.parent / "data" / "brain"
PAST = HERE / "mock" / "days"  # a made-up past: see days()

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


def days():
    """Every day there is a file for, as {date: its file}: the real ones in data/brain/days/ and
    the made-up ones in agent/mock/days/. A real day takes the place of a made-up one.
    shortcut: the band was worn for one day, so the weeks before it are made up for the demo;
    delete agent/mock/days/ when there are real weeks."""
    return {f.stem: f for folder in (PAST, DIR / "days") for f in sorted(folder.glob("*.md"))}


def sources():
    """What the agent is connected to besides the band, as {name: a Markdown list}.
    shortcut: made-up files in agent/mock/ (one file is one source, and its name is the source's),
    replace them with the person's real accounts when there is a login for those."""
    return {f.stem: f.read_text() for f in sorted((HERE / "mock").glob("*.md"))}


async def recall(client, about, before):
    """The earlier times when the same kind of thing went well, as [(day, line)], the surest first.
    The decisions model answers one closed question for each line of the earlier days, so it finds
    meaning and not words: "scared of the presentation" found "The pitch went really well" (0.3 to
    0.6 s for 25 lines, 2026-11-14). about: what weighs on the person, in a few words. before: the
    day of the talk, which is not an earlier day. client: a genai.Client, held by the caller.
    shortcut: one question for each line of every earlier day, which is right for weeks of days;
    give the days an index that finds meaning when the band has been worn for more than a few months."""
    lines = [(day, line[2:]) for day, f in sorted(days().items()) if day < before
             for line in f.read_text().splitlines() if line.startswith("- ")]
    if not lines:
        return []
    a = (await client.aio.decisions.create(model=SENSE, input=f"What weighs on the person: {about}", questions={
        f"n{i}": {"type": "noul", "instructions": "This line from an earlier day tells that the same kind of thing went well: "
                                                  + line.replace("**", "")}
        for i, (_, line) in enumerate(lines)})).answers
    return [lines[i] for p, i in sorted(((a[f"n{i}"].noul, i) for i in range(len(lines))), reverse=True) if p > 0.5][:5]


def graph():
    """The brain as nodes and links, for the page: the person, the headings of the notes and their
    lines, the connected sources and their items, and the days. A line or an item that names a
    date is linked to that day. A dot with "in" is inside another dot, and the page shows it when
    that one is opened: what was said on a day, and the indented lines under a note or an item."""
    nodes = {"person": {"id": "person", "label": "the person", "kind": "person"}}
    links = []
    for day, f in sorted(days().items()):
        nodes[day] = {"id": day, "label": day, "kind": "day"}
        links.append(["person", day])
        # shortcut: the last 12 lines of a day, so that a whole day of speech does not go out with
        # every state; let the page ask for one day's lines when a day must show all of them.
        for said in [x[2:] for x in f.read_text().splitlines() if x.startswith("- ")][-12:]:
            nodes[f"{day}/{said}"] = {"id": f"{day}/{said}", "label": said.replace("**", ""), "kind": "said", "in": day}
            links.append([day, f"{day}/{said}"])
    for hub, leaf, doc in [("head", "line", notes())] + [("source", "item", f"## {name}\n{text}") for name, text in sources().items()]:
        head = top = None
        for line in doc.splitlines():
            text = line.strip().lstrip("-* ").strip()
            if line.startswith("## "):
                head, top = line[3:].strip(), None
                nodes[head] = {"id": head, "label": head, "kind": hub}
                links.append(["person", head])
            elif top and text and line[:1].isspace():  # an indented line: more about the one above it
                nodes[f"{top}/{text}"] = {"id": f"{top}/{text}", "label": text, "kind": "detail", "in": top}
                links.append([top, f"{top}/{text}"])
            elif head and text and not line.startswith("#"):
                top = f"{head}/{text}"
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
