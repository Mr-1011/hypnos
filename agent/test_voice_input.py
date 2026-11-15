"""voice.py: when the loop hears the band.

    cd agent && ../.venv/bin/python -m unittest test_voice_input
"""
import math
import unittest
from unittest.mock import AsyncMock, patch

import voice


class Once(unittest.IsolatedAsyncioTestCase):
    async def test_the_filmed_scene_hears_nothing_after_the_first_answer(self):
        for once in (True, False):
            band = voice.BandInput("", once=once)
            with patch.object(voice.BaseInputTransport, "process_frame", AsyncMock()):
                await band.process_frame(voice.BotStartedSpeakingFrame(), voice.FrameDirection.DOWNSTREAM)
                await band.process_frame(voice.BotStoppedSpeakingFrame(), voice.FrameDirection.DOWNSTREAM)
            self.assertEqual(band.deaf_until == math.inf, once)  # else: deaf only for the echo
