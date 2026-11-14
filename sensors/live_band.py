#!/usr/bin/env python3
"""live_band.py - the Vexo band on the Mac over Bluetooth: wrist acceleration and turning, gestures,
steps, battery and signal, live, and a recording of the motion.

One of the three Hypnos sensor programs (live_server.py has the shared plumbing):

    ./run.sh                            # all three + the page, http://localhost:5300
    ./run.sh --sim                      # the kit's pretend band, no hardware

The kit's own library (vexo-open-kit/python) holds the link. It looks only for the band with our
number, checks the number again after the connect, sets the band's clock, and brings a dropped
link back for 2 minutes. After that this program looks again until the switch goes off.

API on 127.0.0.1:5303 (the page reaches it as /api/band):
    GET  /api/stream       server-sent events: state, data (20 Hz: acc and gyro samples), stats (2 Hz), event
    GET  /api/state
    POST /api/autoconnect  look for the band until it answers (double-tap it: it can be found for 60 s)
    POST /api/disconnect   and stop looking
    POST /api/record       {"on": true, "label": "YYYYMMDD-HHMM"} | {"on": false}

Recording: ../data/band-<label>/motion.csv (utc_ms,n,ax,ay,az,gx,gy,gz; g and degrees/second, the
time from the band's clock), events.log (connects, drops, gestures) and band-meta.json.

The band takes one Bluetooth connection: close the kit's dashboard tab first. The microphone
stays off here, so the band's light is free.
"""
import argparse
import asyncio
import collections
import json
import math
import os
import statistics
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "vexo-open-kit" / "python"))  # the library: a folder in the kit
from vexo_open import Band, band_name  # noqa: E402

from live_server import BleLink, rec_dir, save_json  # noqa: E402

BAND = 61   # our band number, from the bag. The one place it is written.
RATE = 50   # motion samples a second, both sensors (MOTION_HZ in dashboard/src/lib/band.ts)
MAX_FILL = RATE  # samples of NaN inserted for one gap; a longer gap is a restart, not loss


class BandRecorder:
    # shortcut: a crash mid-night does not resume by itself as the Muse and the Polar do; press
    # Start again (the same label appends). Upgrade with live_server.resumable() for whole nights.
    def __init__(self, label, device, data=None):
        self.dir = rec_dir("band", label, data)
        self.dir.mkdir(parents=True, exist_ok=True)
        meta = self.dir / "band-meta.json"
        self.meta = json.loads(meta.read_text()) if meta.exists() else {
            "label": label, "start_utc_ms": int(time.time() * 1000), "device": device, "rate_hz": RATE,
            "record": "motion.csv: utc_ms,n,ax,ay,az,gx,gy,gz (g, degrees/second)"}
        self.meta["final"] = 0
        p = self.dir / "motion.csv"
        new = not p.exists()
        self.f = open(p, "a")
        if new:
            self.f.write("utc_ms,n,ax,ay,az,gx,gy,gz\n")
        self.ev = open(self.dir / "events.log", "a")
        # keeps the Mac awake while this records; dies with this process
        self.caff = subprocess.Popen(["caffeinate", "-i", "-s", "-w", str(os.getpid())])
        save_json(meta, self.meta)

    def motion(self, t, m):
        self.f.write(f"{int(t * 1000)},{'' if m.n is None else m.n},{m.ax:.3f},{m.ay:.3f},{m.az:.3f},{m.gx:.1f},{m.gy:.1f},{m.gz:.1f}\n")

    def note(self, line):
        self.ev.write(line + "\n")

    def flush(self):
        self.f.flush()
        self.ev.flush()

    def close(self, final):
        self.flush()
        self.f.close()
        self.ev.close()
        self.caff.terminate()
        self.meta["final"] = 1 if final else 0
        self.meta["end_utc_ms"] = int(time.time() * 1000)
        save_json(self.dir / "band-meta.json", self.meta)


class BandLink(BleLink):
    """BleLink for its link state, event log and remembered switch; the link itself is the kit's."""

    PREFIX = "band"
    name = "Band"

    def __init__(self, transport="ble"):
        super().__init__()
        self.transport = transport   # "ble", or "sim" for the kit's pretend band
        self.band = None
        self.firmware = None
        self.battery = None
        self.charging = None
        self.rssi = None
        self.activity = None         # the band's own verdict: still, walk, run
        self.steps = None            # since this link; the band itself counts for life
        self.steps0 = None
        self.last_n = None
        self.lost = 0
        self.got = 0
        self.rate = collections.deque(maxlen=5)        # (time, samples so far) at each stats: the rate over 2 s
        self.mag = collections.deque(maxlen=RATE * 2)  # |a| in g, the last 2 s
        self.motion_at = 0.0
        self.pend = self.empty_pending()

    @staticmethod
    def empty_pending():
        return {"acc": [], "gyro": []}

    # ---------- link ----------

    async def keep_linked(self):
        """Look for our band until it answers or the switch goes off. It can be found for 60 s
        after a double-tap and for 2 minutes after a dropped link."""
        while self.want and not self.band:
            self.set_link("reconnecting" if self.down_since else "connecting")
            try:
                band = await Band.connect(BAND, self.transport, auto_reconnect=True)
                try:
                    for event in ("motion", "event", "activity", "battery", "link", "reconnecting", "reconnected", "disconnect"):
                        band.on(event, getattr(self, "on_" + event))
                    await band.configure(motion=RATE, events=True, activity=True, battery=True, link=True)
                except BaseException:
                    await band.disconnect()  # never leave a linked band that nobody holds
                    raise
            except Exception as e:  # every failure means look again: not in range yet, Bluetooth off, a refused setting
                code = getattr(e, "code", type(e).__name__)
                self.attempts += 1
                self.last_error = str(e) or code
                self.log(f"connect failed: {code}")
                if code == "wrong-band":  # a band with another number answered: never try that one again
                    self.want = None
                    break
                await asyncio.sleep(2)
                continue
            self.band = band
            self.firmware = band.info.firmware
            self.device = {"name": band.name + (" (pretend)" if self.transport == "sim" else ""), "address": band.name}
            self.last_n = self.steps0 = None
            self.connects += 1
            self.attempts = 0
            self.last_error = None
            self.remember({"name": band.name, "address": band.name})  # no "(pretend)": the real band has the same name
            self.set_link("streaming")
            self.log(f"connected {self.device['name']}, firmware {self.firmware}")
            self.back()
        if not self.want:
            self.set_link("idle")

    def back(self):
        if self.down_since:
            gone = time.time() - self.down_since
            self.down_ms += gone * 1000
            self.down_since = None
            self.log(f"back after {gone:.0f} s, {self.drops} drops so far")

    def on_reconnecting(self, e):
        self.drops += 1
        self.down_since = self.down_since or time.time()
        self.log(f"link down ({e.reason}), the library looks for the band for {e.seconds:.0f} s")
        self.set_link("reconnecting")

    def on_reconnected(self, e):
        self.last_n = None  # sample numbers start again on a new link
        self.set_link("streaming")
        self.back()
        if e.failed:
            self.log(f"the band refused {', '.join(e.failed)}")

    def on_disconnect(self, e):
        if e.reason == "closed":  # disconnect() below asked for it
            return
        self.band = None
        self.log(f"link closed ({e.reason})")
        if e.reason == "wrong-band":
            self.want = None
        if self.want:
            self.down_since = self.down_since or time.time()
            self.set_link("reconnecting")
            self.ensure_link()
        else:
            self.set_link("idle")

    async def disconnect(self, forget=True):
        self.want = None
        t = self.reconnect_task
        if t and not t.done():
            t.cancel()
            await asyncio.wait([t])  # a Connect right after must find no search left, or ensure_link() starts none
        b, self.band = self.band, None
        if self.down_since:
            self.down_ms += (time.time() - self.down_since) * 1000
            self.down_since = None
        if b:
            try:
                await asyncio.wait_for(b.disconnect(), 5)
            except Exception:
                pass
        if forget:
            self.forget()
        self.set_link("idle")

    async def autoconnect(self):
        self.want = self.want or band_name(BAND)
        self.ensure_link()
        return {"ok": 1}

    # ---------- what the band sends ----------

    def on_motion(self, m):
        now = time.time()
        self.motion_at = now
        if m.n is not None and self.last_n is not None and m.n > self.last_n + 1:
            gap = m.n - self.last_n - 1
            self.lost += gap
            if gap <= MAX_FILL:  # NaN for each lost sample, so the traces keep their sample clock
                self.pend["acc"].extend([(math.nan,) * 3] * gap)
                self.pend["gyro"].extend([(math.nan,) * 3] * gap)
        self.last_n = m.n
        self.got += 1
        self.mag.append(math.sqrt(m.ax ** 2 + m.ay ** 2 + m.az ** 2))
        self.pend["acc"].append((m.ax, m.ay, m.az))
        self.pend["gyro"].append((m.gx, m.gy, m.gz))
        if self.rec:
            self.rec.motion(m.time or now, m)

    def on_event(self, e):
        self.log(f"gesture {e.kind}" + (f" {e.face}" if e.kind == "orientation" else ""))

    def on_activity(self, e):
        if self.steps0 is None:
            self.steps0 = e.steps
        self.steps = e.steps - self.steps0
        self.activity = e.state

    def on_battery(self, e):
        self.battery = e.percent
        self.charging = e.charging

    def on_link(self, e):
        self.rssi = e.rssi

    # ---------- what the page gets ----------

    def stats(self):
        now = time.time()
        self.rate.append((now, self.got))
        (t0, n0), (t1, n1) = self.rate[0], self.rate[-1]
        live = self.link == "streaming" and now - self.motion_at < 3  # an older number says nothing about now
        return {"t": "stats",
                # the spread of |a| over the last 2 s in mg, the number live_muse.py calls motion.move
                "move": round(statistics.pstdev(self.mag) * 1000, 1) if live and len(self.mag) >= RATE else None,
                "hz": round((n1 - n0) / (t1 - t0), 1) if t1 > t0 else 0,
                "lost": self.lost, "battery": self.battery, "charging": self.charging,
                "rssi": self.rssi if live else None, "activity": self.activity if live else None, "steps": self.steps}

    def state(self):
        rec = {"on": False}
        if self.rec:
            rec = {"on": True, "dir": self.rec.dir.name, "label": self.rec.meta.get("label"),
                   "since": self.rec.meta["start_utc_ms"]}
        return {"t": "state", **self.link_state(), "firmware": self.firmware, "rec": rec}

    async def publisher(self):
        def cols(rows, nd):
            return [[None if r[a] != r[a] else round(r[a], nd) for r in rows] for a in range(3)]

        n = 0
        while True:
            await asyncio.sleep(0.05)
            n += 1
            p, self.pend = self.pend, self.empty_pending()
            if p["acc"]:
                self.broadcast({"t": "data", "acc": cols(p["acc"], 3), "gyro": cols(p["gyro"], 1)})
            if n % 10 == 0:
                self.broadcast(self.stats())
            if n % 40 == 0 and self.rec:
                self.rec.flush()

    # ---------- http ----------

    async def route(self, method, path, body):
        try:
            args = json.loads(body) if body else {}
        except ValueError:
            return 400, {"error": "bad json"}
        if method == "GET" and path == "/api/state":
            return 200, self.state()
        if method != "POST":
            return 404, {"error": "not found"}
        if path == "/api/autoconnect":
            return 200, await self.autoconnect()
        if path == "/api/disconnect":
            await self.disconnect()
            return 200, {"ok": True}
        if path == "/api/record":
            label = "".join(c for c in str(args.get("label") or "") if c.isalnum() or c in "-_")
            if args.get("on"):
                label = label or datetime.now().strftime("%Y%m%d-%H%M%S")
                if self.rec and self.rec.meta.get("label") != label:
                    self.stop_recording(final=True)  # a new night while an old one was still open
                if not self.rec:
                    self.rec = BandRecorder(label, self.device, data=self.data)
                    self.log(f"recording to data/{self.rec.dir.name}")
            elif self.rec:
                self.stop_recording(final=True)
            self.push_state()
            return 200, {"ok": True}
        return 404, {"error": "not found"}

    def stop_recording(self, final):
        rec, self.rec = self.rec, None
        rec.close(final)
        self.log(f"recording {'stopped' if final else 'saved'}: data/{rec.dir.name}")

    async def shutdown(self):
        if self.rec:
            self.stop_recording(final=False)
        await self.disconnect(forget=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=5303)
    ap.add_argument("--sim", action="store_true", help="the kit's pretend band, no hardware")
    args = ap.parse_args()
    b = BandLink("sim" if args.sim else "ble")
    b.run(args.port, (b.publisher, b.startup))


if __name__ == "__main__":
    main()
