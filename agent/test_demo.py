"""demo.py: the David take.

    cd agent && ../.venv/bin/python -m unittest test_demo
"""
import datetime
import shutil
import unittest
from unittest import mock

import brain
import demo


class David(unittest.TestCase):
    def test_a_take_has_the_whole_template(self):
        # prepare_david() points the brain at the take: put the real folders back after
        with mock.patch.multiple(brain, DIR=brain.DIR, PAST=brain.PAST, SOURCES=brain.SOURCES, PERSON=brain.PERSON):
            folder = demo.prepare_david()
            self.addCleanup(shutil.rmtree, folder)
            today = datetime.date.fromisoformat(brain.today())
            self.assertIn(str(today - datetime.timedelta(days=2)), brain.days())  # days/2.md is two days ago
            self.assertIn("WhatsApp", brain.sources())
            self.assertNotIn("{", "".join(f.read_text() for f in folder.rglob("*.md")))  # every date is filled in
