"""Fresh, isolated mock memories for each David take; never overwrite the real brain."""
import datetime
import tempfile
from pathlib import Path

import brain


def prepare_david():
    template = Path(__file__).parent / "demo" / "david"
    parent = Path(__file__).parent.parent / "data" / "demo-david"
    parent.mkdir(parents=True, exist_ok=True)
    folder = Path(tempfile.mkdtemp(prefix="take-", dir=parent))
    day = brain.today()
    dates = {"today": day,
             "earlier": str(datetime.date.fromisoformat(day) - datetime.timedelta(days=28)),
             "tomorrow": str(datetime.date.today() + datetime.timedelta(days=1))}
    for source, target in [("person.md", "person.md"), ("today.md", f"days/{day}.md"),
                           ("earlier.md", f"days/{dates['earlier']}.md"),
                           ("calendar.md", "sources/calendar.md")]:
        path = folder / target
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text((template / source).read_text().format(**dates))
    # More of David's world, so that the Memory picture is not nearly empty (the user, 2026-11-14):
    # days/<n>.md is the day n days before today, and sources/ holds his other connected tools.
    # None of those lines tells of a time that went well: the one with Maya stays the only such line.
    for path in sorted((template / "days").glob("*.md")):
        date = str(datetime.date.fromisoformat(day) - datetime.timedelta(days=int(path.stem)))
        (folder / "days" / f"{date}.md").write_text(path.read_text().format(date=date, **dates))
    for path in sorted((template / "sources").glob("*.md")):
        (folder / "sources" / path.name).write_text(path.read_text().format(**dates))
    brain.DIR = folder
    brain.PAST = folder / "unused-past"
    brain.SOURCES = folder / "sources"
    brain.PERSON = "David · demo"
    return folder
