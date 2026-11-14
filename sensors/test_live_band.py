"""live_band.py without a band: the kit's pretend band through the whole program.

    cd sensors && ../.venv/bin/python -m unittest test_live_band
"""
import asyncio
import contextlib
import io
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import live_band
from live_band import BAND, RATE, BandLink
from vexo_open import Message, band_name


class Gap(unittest.TestCase):
    def test_lost_samples_become_nan(self):
        b = BandLink("sim")
        still = dict(ax=0.0, ay=0.0, az=1.0, gx=0.0, gy=0.0, gz=0.0, time=None)
        b.on_motion(Message(still, n=10))
        b.on_motion(Message(still, n=14))  # 11, 12 and 13 never arrived
        self.assertEqual(b.lost, 3)
        self.assertEqual(len(b.pend["acc"]), 5)
        self.assertNotEqual(b.pend["acc"][1][0], b.pend["acc"][1][0])  # NaN
        self.assertEqual(b.pend["acc"][4], (0.0, 0.0, 1.0))


class Sim(unittest.IsolatedAsyncioTestCase):
    async def test_links_streams_and_records(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(live_band.subprocess, "Popen"), \
                contextlib.redirect_stdout(io.StringIO()):
            b = BandLink("sim")
            b.data = Path(d)
            self.assertEqual(await b.autoconnect(), {"ok": 1})
            await b.route("POST", "/api/record", b'{"on": true, "label": "t"}')
            await asyncio.sleep(2.2)
            self.assertEqual(b.link, "streaming")
            self.assertEqual(b.device["name"], band_name(BAND) + " (pretend)")
            self.assertEqual(b.remembered()["address"], band_name(BAND))
            self.assertGreater(len(b.pend["acc"]), RATE)                # 2 s of motion at about RATE
            self.assertAlmostEqual(b.pend["acc"][-1][2], 1.0, delta=0.1)  # the pretend band lies flat: z is 1 g
            b.stats()
            await asyncio.sleep(0.5)
            s = b.stats()
            self.assertAlmostEqual(s["hz"], RATE, delta=RATE * 0.3)
            self.assertLess(s["move"], 60)  # its gentle swing, in mg
            self.assertEqual(s["battery"], 87)
            self.assertTrue(b.state()["rec"]["on"])

            await b.shutdown()
            self.assertEqual(b.link, "idle")
            rows = (Path(d) / "band-t" / "motion.csv").read_text().splitlines()
            self.assertEqual(rows[0], "utc_ms,n,ax,ay,az,gx,gy,gz")
            self.assertGreater(len(rows), RATE)
            self.assertEqual(len(rows[-1].split(",")), 8)


if __name__ == "__main__":
    unittest.main()
