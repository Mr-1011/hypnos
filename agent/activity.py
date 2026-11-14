"""Observable tool activity for the page, never a model's private reasoning."""
from contextlib import asynccontextmanager


class Activity:
    def __init__(self, changed):
        self.changed = changed
        self.turn = 0
        self.phase = "idle"
        self.steps = []

    def state(self):
        return {"turn": self.turn, "phase": self.phase, "steps": [dict(s) for s in self.steps]}

    def begin(self):
        self.turn += 1
        self.steps = []
        self.phase = "processing"
        self.changed()

    def finish(self, phase):
        self.phase = phase
        for step in self.steps:
            if step["status"] == "running":
                step["status"] = "cancelled"
        self.changed()

    @asynccontextmanager
    async def tool(self, name):
        turn = self.turn
        step = {"id": len(self.steps), "tool": name, "status": "running"}
        self.steps.append(step)
        self.changed()
        try:
            yield
        except BaseException:
            if turn == self.turn and step["status"] == "running":
                step["status"] = "failed"
                self.phase = "error"
            raise
        else:
            if turn == self.turn and step["status"] == "running":
                step["status"] = "done"
                if name == "stay_quiet" and self.phase == "processing":
                    self.phase = "quiet"
        finally:
            # A late result from a cancelled turn must not change the next turn's activity.
            if turn == self.turn:
                self.changed()
