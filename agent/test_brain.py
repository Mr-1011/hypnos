"""brain.py without Gemini.

    cd agent && ../.venv/bin/python -m unittest test_brain
"""
import tempfile
import unittest
from pathlib import Path
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
