"""The recalled statement, not every statement of its day, is highlighted in Focus."""
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import brain
from voice import Voice


class RecallActivity(unittest.IsolatedAsyncioTestCase):
    async def test_only_the_returned_statement_is_highlighted(self):
        with tempfile.TemporaryDirectory() as d, patch.object(brain, "DIR", Path(d)), \
                patch.object(brain, "PAST", Path(d) / "no-mock"), patch.object(Voice, "push_state"):
            brain.note("2026-11-12", 0, "you", "Maya helped with the presentation.")
            brain.note("2026-11-12", 1, "you", "Lunch was nice.")
            voice = Voice("", {})
            voice.day = "2026-11-14"
            voice.activity.begin()
            callback = AsyncMock()
            await voice.recall(SimpleNamespace(result_callback=callback), "presentation")
            found = [n for n in brain.graph()["nodes"] if n["id"] in voice.sensed["about"]]
            self.assertEqual(len(found), 1)
            self.assertEqual(found[0]["kind"], "said")
            self.assertIn("Maya helped", found[0]["label"])
            self.assertEqual(voice.activity.steps[0]["status"], "done")
            callback.assert_awaited_once()

    async def test_match_outside_graph_limit_falls_back_to_its_day(self):
        with tempfile.TemporaryDirectory() as d, patch.object(brain, "DIR", Path(d)), \
                patch.object(brain, "PAST", Path(d) / "no-mock"), patch.object(Voice, "push_state"):
            brain.note("2026-11-12", 0, "you", "The presentation went well.")
            for i in range(12):
                brain.note("2026-11-12", i + 1, "you", f"Other memory {i}.")
            voice = Voice("", {})
            voice.day = "2026-11-14"
            await voice.recall(SimpleNamespace(result_callback=AsyncMock()), "presentation")
            self.assertEqual(voice.sensed["about"], ["2026-11-12"])
