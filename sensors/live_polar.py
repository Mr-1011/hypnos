#!/usr/bin/env python3
"""live_polar.py - the Polar H10 chest strap on the Mac over Bluetooth: heart rate, R-R and 130 Hz
ECG, live, and a recording as the three CSVs the Polar phone app exports.

One of the three Hypnos sensor programs (live_server.py has the shared plumbing):

    ./run.sh                            # all three + the page, http://localhost:5300

API on 127.0.0.1:5302 (the page reaches it as /api/polar):
    GET  /api/stream       server-sent events: state, data (20 Hz: ECG samples, HR, R-R), stats (2 Hz), event
    GET  /api/state
    POST /api/scan         nearby Polar straps (they advertise only while worn: wet the pads)
    POST /api/connect      {"address": ...}; reconnects on its own until disconnect
    POST /api/disconnect   and forget the strap
    POST /api/autoconnect  the remembered strap, or the strongest one a scan finds
    POST /api/record       {"on": true, "label": "YYYYMMDD-HHMM"} | {"on": false}

Recording: ../data/polar-<label>/raw/<start>_{HR,RR,ECG}-data.csv in the app's own format
(timestamp_local,elapsed_seconds,value; Mac local time, elapsed from the recording's first start),
events.log (connects, drops, ECG gaps on the strap's own clock) and polar-meta.json (the counters).
A restart mid-night appends to the same files.

Protocol (measured 2026-10-14): heart rate + R-R
on the standard 0x2A37 (R-R in 1/1024 s); ECG on Polar's PMD service, started with ECG_START on the
control point (write + indicate), frames on the data characteristic: [0x00 = ECG][u64 ns, the time
of the frame's last sample][frame type 0][3-byte signed uV per sample]. The H10 serves PMD only on
an encrypted link; macOS pairs on the first access.
"""
import argparse
import asyncio
import collections
import json
import os
import subprocess
import time
from datetime import datetime

from live_server import BleLink, rec_dir, resumable, save_json

HRM = "00002a37-0000-1000-8000-00805f9b34fb"
BATT = "00002a19-0000-1000-8000-00805f9b34fb"
PMD_CTL = "fb005c81-02e7-f387-1cad-8acd2d8df0c8"
PMD_DATA = "fb005c82-02e7-f387-1cad-8acd2d8df0c8"
# start ECG: op 2, type 0 (ECG), setting 0 (sample rate) = 130, setting 1 (resolution) = 14
ECG_START = bytes([0x02, 0x00, 0x00, 0x01, 0x82, 0x00, 0x01, 0x01, 0x0E, 0x00])
ECG_HZ = 130
ECG_NS = 1e9 / ECG_HZ
GAP_NS = 100_000_000  # more than 100 ms missing on the strap's own clock is a gap


def parse_hr(d):
    """Heart Rate Measurement (0x2A37): (bpm, R-R in ms), R-R converted from 1/1024 s."""
    flags = d[0]
    bpm, i = (d[1] | (d[2] << 8), 3) if flags & 0x01 else (d[1], 2)
    if flags & 0x08:
        i += 2  # energy expended, never sent by the H10
    rr = []
    while flags & 0x10 and i + 1 < len(d):
        rr.append(((d[i] | (d[i + 1] << 8)) * 1000 + 512) // 1024)
        i += 2
    return bpm, rr


def parse_ecg(d):
    """PMD data frame: (ns of the last sample, samples in uV), or None when it is not ECG."""
    if len(d) < 10 or d[0] != 0x00:
        return None
    out = []
    for i in range(10, len(d) - 2, 3):
        v = d[i] | (d[i + 1] << 8) | (d[i + 2] << 16)
        out.append(v - (1 << 24) if v & 0x800000 else v)
    return int.from_bytes(d[1:9], "little"), out


def local_stamp(t):
    return datetime.fromtimestamp(t).strftime("%Y-%m-%d %H:%M:%S.") + f"{int(t * 1000) % 1000:03d}"


class PolarRecorder:
    HEAD = {"HR": "timestamp_local,elapsed_seconds,hr_bpm",
            "RR": "timestamp_local,elapsed_seconds,rr_ms",
            "ECG": "timestamp_local,elapsed_seconds,ecg_uv"}

    def __init__(self, label, device, data=None, resume=None):
        self.dir = rec_dir("polar", label, data)
        raw = self.dir / "raw"
        raw.mkdir(parents=True, exist_ok=True)
        now = time.time()
        if resume is None and (self.dir / "polar-meta.json").exists():
            # a second Start on the same label (Stop, Start within the minute): one recording, one
            # set of CSVs
            resume = json.loads((self.dir / "polar-meta.json").read_text())
        if resume:
            self.meta = resume
            self.meta.setdefault("resumed_utc_ms", []).append(int(now * 1000))
        else:
            self.meta = {"label": label, "start_utc_ms": int(now * 1000), "device": device,
                         "address": (device or {}).get("address"),
                         "record": "the Polar phone app's three CSVs, Mac local time"}
        self.meta["final"] = 0
        self.t0 = self.meta["start_utc_ms"] / 1000
        stamp = datetime.fromtimestamp(self.t0).strftime("%Y-%m-%d_%H-%M-%S")
        self.f = {}
        for k, head in self.HEAD.items():
            p = raw / f"{stamp}_{k}-data.csv"
            new = not p.exists()
            self.f[k] = open(p, "a")
            if new:
                self.f[k].write(head + "\n")
        self.ev = open(self.dir / "events.log", "a")
        # keeps the Mac awake while this records, whatever the other programs do; dies with this process
        self.caff = subprocess.Popen(["caffeinate", "-i", "-s", "-w", str(os.getpid())])
        self.save()

    def row(self, k, t, v):
        self.f[k].write(f"{local_stamp(t)},{t - self.t0:.6f},{v}\n")

    def hr(self, t, bpm, rrs):
        """One heart-rate row at arrival; its R-R beats stepped back from it, oldest first."""
        self.row("HR", t, bpm)
        at, beats = t, []
        for rr in reversed(rrs):
            beats.append((at, rr))
            at -= rr / 1000
        for at, rr in reversed(beats):
            self.row("RR", at, rr)

    def ecg(self, t, samples):
        """One frame, its last sample at arrival, the others 1/130 s apart before it."""
        n = len(samples)
        for i, v in enumerate(samples):
            self.row("ECG", t - (n - 1 - i) / ECG_HZ, v)

    def note(self, line):
        self.ev.write(line + "\n")

    def save(self, counters=None):
        if counters:
            self.meta["counters"] = dict(counters)
        save_json(self.dir / "polar-meta.json", self.meta)

    def flush(self, counters=None):
        for f in self.f.values():
            f.flush()
        self.ev.flush()
        self.save(counters)

    def close(self, final, counters=None):
        self.flush(counters)
        for f in self.f.values():
            f.close()
        self.ev.close()
        self.caff.terminate()
        self.meta["final"] = 1 if final else 0
        self.meta["end_utc_ms"] = int(time.time() * 1000)
        self.save()


class Polar(BleLink):
    PREFIX = "polar"
    SERVICE = "180D"  # heart rate
    name = "Polar"

    def __init__(self):
        super().__init__()
        self.battery = None
        self.bpm = None
        self.rr_last = None
        self.hr_at = 0.0  # arrival of the last heart-rate packet
        self.counters = {"hr_packets": 0, "rr_beats": 0, "ecg_frames": 0, "ecg_samples": 0,
                         "ecg_gaps": 0, "ecg_lost": 0}
        self.last_ns = None  # kept across a reconnect: the strap's clock runs on, so an outage is a gap
        self.ecg_recent = collections.deque()  # (arrival, samples), last 10 s
        self.pend = self.empty_pending()

    @staticmethod
    def empty_pending():
        return {"ecg": [], "hr": [], "rr": []}

    # ---------- link ----------

    def match(self, name):
        return name.startswith("Polar")

    async def setup(self, client):
        self.battery = (await client.read_gatt_char(BATT))[0]
        # A read of the PMD control point is what makes macOS pair: subscribing to it on a plain link
        # only fails with "Encryption is insufficient" (measured 2026-10-15). The first time, macOS
        # may ask on screen.
        await client.read_gatt_char(PMD_CTL)
        await client.start_notify(HRM, self.on_hr)
        await client.start_notify(PMD_CTL, self.on_ctl)
        await client.start_notify(PMD_DATA, self.on_ecg)
        await client.write_gatt_char(PMD_CTL, ECG_START, response=True)
        self.log(f"heart rate and ECG on, battery {self.battery} %")
        if self.rec:
            self.rec.meta["address"] = self.want
            self.rec.save(self.counters)

    def on_hr(self, _sender, d):
        now = time.time()
        self.last_rx = now
        if len(d) < 2:
            return
        bpm, rr = parse_hr(bytes(d))
        self.bpm = bpm
        self.hr_at = now
        self.counters["hr_packets"] += 1
        self.counters["rr_beats"] += len(rr)
        if rr:
            self.rr_last = rr[-1]
        ms = int(now * 1000)
        self.pend["hr"].append([ms, bpm])
        self.pend["rr"].extend([ms, x] for x in rr)
        if self.rec:
            self.rec.hr(now, bpm, rr)

    def on_ctl(self, _sender, d):
        if len(d) >= 4 and d[0] == 0xF0:  # control point answer: [0xF0][op][type][error], 0 = ok
            self.log(f"pmd op {d[1]} type {d[2]} err {d[3]}")

    def on_ecg(self, _sender, d):
        now = time.time()
        self.last_rx = now
        r = parse_ecg(bytes(d))
        if not r:
            return
        ns, smp = r
        if self.last_ns is not None:
            gap = ns - self.last_ns - len(smp) * ECG_NS
            if gap > GAP_NS:
                lost = int(gap / ECG_NS)
                self.counters["ecg_gaps"] += 1
                self.counters["ecg_lost"] += lost
                self.log(f"ecg gap {gap / 1e6:.0f} ms, {lost} samples")
        self.last_ns = ns
        self.counters["ecg_frames"] += 1
        self.counters["ecg_samples"] += len(smp)
        self.ecg_recent.append((now, len(smp)))
        self.pend["ecg"].extend(smp)
        if self.rec:
            self.rec.ecg(now, smp)

    async def resume(self):
        """A restart mid-night: append to the recording it was writing."""
        r = resumable("polar", "polar-meta.json", self.data)
        if not r:
            return
        d, meta = r
        self.rec = PolarRecorder(d.name[len("polar-"):], None, data=self.data, resume=meta)
        self.log(f"resumed recording data/{d.name}")
        self.push_state()

    # ---------- what the page gets ----------

    def ecg_hz(self, now):
        while self.ecg_recent and self.ecg_recent[0][0] < now - 10:
            self.ecg_recent.popleft()
        return round(sum(n for _, n in self.ecg_recent) / 10, 1)

    def stats(self):
        now = time.time()
        live = now - self.hr_at < 3  # the strap sends 1 Hz; an older number says nothing about now
        return {"t": "stats", "bpm": self.bpm if live else None, "rr": self.rr_last if live else None,
                "battery": self.battery, "ecg_hz": self.ecg_hz(now), "counters": self.counters}

    def state(self):
        rec = {"on": False}
        if self.rec:
            rec = {"on": True, "dir": self.rec.dir.name, "label": self.rec.meta.get("label"),
                   "since": self.rec.meta["start_utc_ms"]}
        return {"t": "state", **self.link_state(), "battery": self.battery, "rec": rec,
                "counters": self.counters}

    async def publisher(self):
        n = 0
        while True:
            await asyncio.sleep(0.05)
            n += 1
            p, self.pend = self.pend, self.empty_pending()
            if p["ecg"] or p["hr"]:
                self.broadcast({"t": "data", **p})
            if n % 10 == 0:
                self.broadcast(self.stats())
            if n % 40 == 0 and self.rec:
                self.rec.flush(self.counters)

    # ---------- http ----------

    async def route(self, method, path, body):
        try:
            args = json.loads(body) if body else {}
        except ValueError:
            return 400, {"error": "bad json"}
        if method == "GET" and path == "/api/state":
            return 200, self.state()
        r = await self.link_route(method, path, args)
        if r:
            return r
        if method == "POST" and path == "/api/record":
            label = "".join(c for c in str(args.get("label") or "") if c.isalnum() or c in "-_")
            if args.get("on"):
                label = label or datetime.now().strftime("%Y%m%d-%H%M%S")
                if self.rec and self.rec.meta.get("label") != label:
                    self.stop_recording(final=True)  # a new night while an old one was still open
                if not self.rec:
                    self.rec = PolarRecorder(label, self.device, data=self.data)
                    self.log(f"recording to data/{self.rec.dir.name}")
            elif self.rec:
                self.stop_recording(final=True)
            self.push_state()
            return 200, {"ok": True}
        return 404, {"error": "not found"}

    def stop_recording(self, final):
        rec, self.rec = self.rec, None
        rec.close(final, self.counters)
        self.log(f"recording {'stopped' if final else 'saved'}: data/{rec.dir.name}")

    async def shutdown(self):
        if self.rec:
            self.stop_recording(final=False)
        await self.disconnect(forget=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=5302)
    p = Polar()
    p.run(ap.parse_args().port, (p.publisher, p.watchdog, p.resume, p.startup))


if __name__ == "__main__":
    main()
