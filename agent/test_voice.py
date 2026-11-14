"""voice.py: only the rule that takes the place of a switch. The band's link starts and ends the loop.

    cd agent && ../.venv/bin/python -m unittest test_voice
"""
import asyncio
import json
import unittest

from aiohttp import web

import voice

BAND = {"name": "Vexo-HACK-00", "address": "Vexo-HACK-00"}
# the band program's states, as (link, remembered), and what each asks of the loop
STATES = [("idle", BAND, None),             # the band program has just started and will link by itself
          ("connecting", BAND, None),
          ("streaming", BAND, True),        # linked: the agent listens
          ("reconnecting", BAND, None),     # a link lost for a moment ends nothing
          ("streaming", BAND, None),
          ("idle", None, False),            # switched off on its card, which forgets the band
          ("streaming", BAND, True)]


class Switch(unittest.IsolatedAsyncioTestCase):
    async def test_the_bands_link_starts_and_ends_the_loop(self):
        done = asyncio.Event()

        async def stream(request):
            r = web.StreamResponse(headers={"Content-Type": "text/event-stream"})
            await r.prepare(request)
            for link, remembered, _ in STATES:
                await r.write(b"data: " + json.dumps({"t": "state", "link": link, "remembered": remembered}, separators=(",", ":")).encode() + b"\n\n")
            await done.wait()  # the stream stays open, as the band program's does
            return r

        app = web.Application()
        app.router.add_get("/api/stream", stream)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]

        v = voice.Voice("", {})
        asked = []

        async def talk(on):
            asked.append(on)

        v.talk = talk
        want = [on for _, _, on in STATES if on is not None]
        watching = asyncio.create_task(v.watch("wrist", f"http://127.0.0.1:{port}/api/stream"))
        for _ in range(50):
            if len(asked) == len(want):
                break
            await asyncio.sleep(0.1)
        watching.cancel()
        done.set()
        await runner.cleanup()
        self.assertEqual(asked, want)


if __name__ == "__main__":
    unittest.main()
