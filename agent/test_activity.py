"""Tool progress must survive parallel calls, failure, and a new turn."""
import asyncio
import unittest
from activity import Activity


class Progress(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.events = []
        self.activity = Activity(lambda: self.events.append(self.activity.state()))
        self.activity.begin()

    async def test_parallel_tools_remain_visible_until_each_finishes(self):
        async with self.activity.tool("sense"):
            async with self.activity.tool("body"):
                self.assertEqual([s["status"] for s in self.activity.steps], ["running", "running"])
            self.assertEqual([s["status"] for s in self.activity.steps], ["running", "done"])
        self.assertEqual([s["status"] for s in self.activity.steps], ["done", "done"])
        self.assertEqual(self.activity.phase, "processing")
        # Earlier SSE snapshots must not mutate as a later tool finishes.
        self.assertEqual([s["status"] for s in self.events[2]["steps"]], ["running", "running"])

    async def test_old_tool_cannot_change_a_new_turn(self):
        async with self.activity.tool("stay_quiet"):
            self.activity.begin()
        self.assertEqual(self.activity.phase, "processing")
        self.assertEqual(self.activity.steps, [])

    async def test_failure_and_cancellation_stop_pending_activity(self):
        for error in [ValueError("failed"), asyncio.CancelledError()]:
            self.activity.begin()
            with self.assertRaises(type(error)):
                async with self.activity.tool("recall"):
                    raise error
            self.assertEqual(self.activity.phase, "error")
            self.assertEqual(self.activity.steps[0]["status"], "failed")

    async def test_quiet_is_an_observed_result(self):
        async with self.activity.tool("stay_quiet"):
            self.assertEqual(self.activity.phase, "processing")
        self.assertEqual(self.activity.phase, "quiet")

    async def test_stop_cannot_be_overwritten_by_late_success(self):
        async with self.activity.tool("stay_quiet"):
            self.activity.finish("idle")
        self.assertEqual(self.activity.phase, "idle")
        self.assertEqual(self.activity.steps[0]["status"], "cancelled")
