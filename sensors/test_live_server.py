"""live_server.py without a device.

    cd sensors && ../.venv/bin/python -m unittest test_live_server
"""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from live_server import BleLink


class Held(unittest.IsolatedAsyncioTestCase):
    async def test_autoconnect_takes_a_device_that_macos_holds(self):
        # nothing remembered, and a linked device does not advertise: a scan would find nothing
        with tempfile.TemporaryDirectory() as d:
            link = BleLink()
            link.data = Path(d)
            held = mock.AsyncMock(return_value={"address": "A-1", "name": "Muse"})
            with mock.patch.object(link, "held_device", held), mock.patch.object(link, "ensure_link"), \
                    mock.patch("bleak.BleakScanner.find_device_by_filter", side_effect=AssertionError("scanned")):
                self.assertEqual(await link.autoconnect(), {"ok": 1, "address": "A-1"})
            self.assertEqual(link.want, "A-1")
