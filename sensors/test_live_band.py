"""live_band.py without a band: the kit's pretend band through the whole program.

    cd sensors && ../.venv/bin/python -m unittest test_live_band
"""
import asyncio
import base64
import contextlib
import io
import json
import tempfile
import threading
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

    async def test_microphone_to_text(self):
        class Ears:  # what speech.create() gives, without Deepgram
            error = None
            fed = 0

            def start(self, on_text):
                self.on_text = on_text

            def feed(self, packet, seq=None):
                self.fed += 1

            def stop(self):
                return ""

        ears = Ears()
        with tempfile.TemporaryDirectory() as d, mock.patch.object(live_band.speech, "create", return_value=ears), \
                contextlib.redirect_stdout(io.StringIO()):
            b = BandLink("sim")
            b.data = Path(d)
            await b.autoconnect()
            await asyncio.sleep(1)
            self.assertEqual(await b.route("POST", "/api/mic", b'{"on": true}'), (200, {"ok": True, "err": None}))
            await asyncio.sleep(0.5)
            self.assertGreater(ears.fed, 10)  # the pretend band's voice, 50 packets a second
            t = threading.Thread(target=ears.on_text, args=("Hello there.", True))  # Deepgram answers on its own thread
            t.start()
            t.join()
            await asyncio.sleep(0.05)
            self.assertTrue(b.state()["mic"]["on"])
            self.assertEqual(b.state()["lines"][-1][1], "Hello there.")

            await b.route("POST", "/api/mic", b'{"on": false}')
            self.assertFalse(b.state()["mic"]["on"])
            fed = ears.fed
            await asyncio.sleep(0.3)
            self.assertEqual(ears.fed, fed)  # nothing goes out after the switch
            await b.shutdown()

    async def test_sound_stream_for_the_agent(self):
        with tempfile.TemporaryDirectory() as d, contextlib.redirect_stdout(io.StringIO()):
            b = BandLink("sim")
            b.data = Path(d)
            server = await asyncio.start_server(b.serve, "127.0.0.1", 0)
            pub = asyncio.ensure_future(b.publisher())
            await b.autoconnect()
            await asyncio.sleep(1)
            self.assertFalse(b.mic_live)

            r, w = await asyncio.open_connection("127.0.0.1", server.sockets[0].getsockname()[1])
            w.write(b"GET /api/audio HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
            got = b""
            while got.count(b'"opus"') < 10:  # the microphone comes on because someone listens
                got += await asyncio.wait_for(r.read(4096), 3)
            self.assertTrue(b.mic_live)
            self.assertTrue(b.state()["mic"]["agent"])
            first = json.loads(got[got.index(b"data: ") + 6:].split(b"\n")[0])
            self.assertGreater(len(base64.b64decode(first["opus"])), 10)

            w.close()
            await asyncio.sleep(1.5)  # the stream notices within its 1 s ping
            self.assertFalse(b.mic_live)  # nobody listens: the microphone is off again
            pub.cancel()
            server.close()
            await b.shutdown()
