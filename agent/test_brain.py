"""brain.py without Gemini.

    cd agent && ../.venv/bin/python -m unittest test_brain
"""
import asyncio
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest import mock

import brain


class Brain(unittest.TestCase):
    def test_restless_is_ten_moving_seconds_in_thirty(self):
        self.assertFalse(brain.restless([5.0] * 60))
        self.assertFalse(brain.restless([None] * 60))                # no band: no verdict
        self.assertFalse(brain.restless([5.0] * 45 + [80.0] * 15))   # one turn in bed
        self.assertTrue(brain.restless([5.0, 80.0, 80.0] * 20))

    def test_the_talk_goes_into_the_file_of_its_day(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(brain, "DIR", Path(d)):
            brain.note("2026-11-14", 0, "agent", "How was the day?")
            brain.note("2026-11-14", 60000, "you", "Long.")
            text = (Path(d) / "days" / "2026-11-14.md").read_text()
            self.assertTrue(text.startswith("# 2026-11-14\n"))
            self.assertEqual(text.count("\n- "), 2)
            self.assertTrue(text.endswith("**you**: Long.\n"))

    def test_the_graph_links_a_line_to_the_days_it_names(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(brain, "DIR", Path(d)):
            self.assertEqual([n["id"] for n in brain.graph()["nodes"]], ["person"])  # an empty brain
            brain.note("2026-11-14", 0, "you", "Long.")
            (Path(d) / "person.md").write_text(
                "# The person\n\n## Coming up\n- The pitch, 2026-11-15\n\n## Days\n- 2026-11-14: a long day\n")
            g = brain.graph()
            kinds = {n["id"]: n["kind"] for n in g["nodes"]}
            self.assertEqual(kinds["Coming up"], "head")
            self.assertEqual(kinds["Coming up/The pitch, 2026-11-15"], "line")
            self.assertEqual(kinds["2026-11-15"], "day")  # named in the notes, no talk on it
            self.assertIn(["Coming up/The pitch, 2026-11-15", "2026-11-15"], g["links"])
            self.assertIn(["Days/2026-11-14: a long day", "2026-11-14"], g["links"])
            self.assertIn(["person", "2026-11-14"], g["links"])
            self.assertNotIn(["person", "2026-11-15"], g["links"])

    def test_sense_asks_about_every_note_and_names_the_ones_touched(self):
        asked = {}

        async def create(model, input, questions):  # the decisions model: sure of the pitch, not of the walk
            asked.update(questions)
            return NS(answers={k: NS(noul=0.9 if "pitch" in q["instructions"] else 0.1) for k, q in questions.items()})

        with tempfile.TemporaryDirectory() as d, mock.patch.object(brain, "DIR", Path(d)):
            (Path(d) / "person.md").write_text("## Coming up\n- The pitch, 2026-11-15\n\n## What helps\n- The walk\n\n## Days\n- 2026-11-14: long\n")
            got = asyncio.run(brain.sense(NS(aio=NS(decisions=NS(create=create))), "person: I am not ready.", "Sensors: none."))
        self.assertEqual(len(asked), 3)  # two notes and worried: the Days lines are not asked about
        self.assertEqual(got, {"about": ["Coming up/The pitch, 2026-11-15"], "worried": 0.1})
