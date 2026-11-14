"""sleep.py - the stage of sleep, every half minute, from what the sensors give.

    awake    the body moves, or the EEG is fast (alpha and beta)
    drowsy   still, and the EEG slows to theta: the minutes in which sleep begins
    light    asleep, between drowsy and deep
    deep     slow waves: delta is most of the EEG
    rem      asleep for an hour or more, the body still, and the EEG fast again

A cycle is the way from light sleep through deep sleep to REM, about 90 minutes. With the EEG the
cycle count goes up each time a REM period ends. Without the Muse there is no EEG: the stage is
then awake, drowsy (lies still) or light (still for STILL_MIN minutes, the way a wrist tracker
scores sleep), and the cycle is counted by the clock.

shortcut: these are the rules a person scores sleep by, set on the Muse's relative band power by
hand on 2026-11-14. No night was held against them, and REM against waking is the weak one (there
is no eye channel); replace them with a stager trained on scored nights before the cycles are
trusted.

    cd agent && ../.venv/bin/python -m unittest test_sleep
"""
EPOCH_S = 30     # one verdict covers this long, as in a sleep lab
STILL_MIN = 10   # with no EEG: still this long counts as asleep
CYCLE_MIN = 90   # with no EEG: a cycle by the clock
SLEEP = ("light", "deep", "rem")


def stage(bands, moving, asleep_min, still_min):
    """The stage of one epoch. bands: the shares of delta, theta, alpha, beta (and gamma) in the
    EEG, or None with no EEG. moving: the share of the epoch in which wrist or head moved.
    asleep_min: minutes since sleep began, None before it. still_min: minutes since the last move."""
    if moving > 1 / 3:
        return "awake"
    if bands is None:
        return "light" if still_min >= STILL_MIN else "drowsy"
    delta, theta, alpha, beta = bands[:4]
    if delta >= 0.55:
        return "deep"
    if alpha + beta >= 0.45:  # a fast EEG is waking, or REM in a body that has slept and lies still
        return "rem" if asleep_min is not None and asleep_min >= 60 and moving == 0 else "awake"
    return "light" if asleep_min is not None or delta >= 0.35 else "drowsy"


class Night:
    """The night so far: a stage for every epoch, when sleep began, and the cycle."""

    def __init__(self):
        self.stages = []    # one for each epoch
        self.onset = None   # the number of the epoch in which sleep began
        self.still = 0      # epochs since the body last moved
        self.rems = 0       # REM periods that have ended
        self.eeg = False    # the last epoch had EEG

    def asleep_min(self):
        return None if self.onset is None else (len(self.stages) - self.onset) * EPOCH_S / 60

    def add(self, bands, moving):
        self.still = 0 if moving else self.still + 1
        s = stage(bands, moving, self.asleep_min(), self.still * EPOCH_S / 60)
        if self.stages and self.stages[-1] == "rem" and s in ("light", "deep"):
            self.rems += 1
        if self.onset is None and s in SLEEP:
            self.onset = len(self.stages)
        self.stages.append(s)
        self.eeg = bands is not None
        return s

    def now(self):
        """For the page and for the agent: the stage, the cycle (0 before sleep) and the minutes asleep."""
        m = self.asleep_min()
        cycle = 0 if m is None else 1 + (self.rems if self.eeg else int(m // CYCLE_MIN))
        return {"stage": self.stages[-1] if self.stages else None, "cycle": cycle,
                "asleep_min": None if m is None else round(m), "eeg": self.eeg}
