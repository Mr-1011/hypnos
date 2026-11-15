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
    brain.DIR = folder
    brain.PAST = folder / "unused-past"
    brain.SOURCES = folder / "sources"
    brain.PERSON = "David · demo"
    return folder
