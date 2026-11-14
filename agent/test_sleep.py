"""sleep.py: the rules, and a night that goes through them.

    cd agent && ../.venv/bin/python -m unittest test_sleep
"""
import unittest

from sleep import Night, stage

# the shares of delta, theta, alpha, beta, gamma
WAKING = [0.10, 0.10, 0.35, 0.35, 0.10]
THETA = [0.25, 0.45, 0.15, 0.10, 0.05]
MIXED = [0.45, 0.30, 0.10, 0.10, 0.05]
SLOW = [0.70, 0.15, 0.05, 0.05, 0.05]


class Stage(unittest.TestCase):
    def test_one_epoch(self):
        self.assertEqual(stage(SLOW, 0.5, 30, 0), "awake")       # a body that moves is awake, whatever the EEG
        self.assertEqual(stage(WAKING, 0, None, 5), "awake")
        self.assertEqual(stage(THETA, 0, None, 5), "drowsy")
        self.assertEqual(stage(MIXED, 0, None, 5), "light")
        self.assertEqual(stage(THETA, 0, 20, 5), "light")        # once asleep, theta is light sleep
        self.assertEqual(stage(SLOW, 0, 20, 5), "deep")
        self.assertEqual(stage(WAKING, 0, 20, 5), "awake")       # fast EEG early in the night: woken up
        self.assertEqual(stage(WAKING, 0, 75, 5), "rem")
        self.assertEqual(stage(WAKING, 0.1, 75, 0), "awake")     # REM does not move

    def test_with_no_eeg_stillness_is_the_only_sign(self):
        self.assertEqual(stage(None, 0, None, 2), "drowsy")
        self.assertEqual(stage(None, 0, None, 10), "light")

    def test_a_night_counts_its_cycles(self):
        n = Night()
        for bands, epochs in ((WAKING, 4), (THETA, 4), (MIXED, 20), (SLOW, 60), (MIXED, 40), (WAKING, 20), (MIXED, 2)):
            for _ in range(epochs):
                n.add(bands, 0)
        self.assertEqual(n.stages[3], "awake")
        self.assertEqual(n.stages[4], "drowsy")
        self.assertEqual(n.onset, 8)
        self.assertEqual(n.stages[130], "rem")  # the fast EEG after 61 minutes of sleep
        self.assertEqual(n.now(), {"stage": "light", "cycle": 2, "asleep_min": 71, "eeg": True})

    def test_a_night_with_no_eeg_counts_cycles_by_the_clock(self):
        n = Night()
        n.add(None, 1.0)
        self.assertEqual(n.now()["cycle"], 0)  # not asleep yet
        for _ in range(20 + 200):
            n.add(None, 0)
        self.assertEqual(n.onset, 20)  # still for 10 minutes
        self.assertEqual(n.now(), {"stage": "light", "cycle": 2, "asleep_min": 100, "eeg": False})
