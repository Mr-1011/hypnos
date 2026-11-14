#!/usr/bin/env python3
"""live_muse.py - the Muse S Gen 1 on the Mac over Bluetooth, with a live view and a recorder.

Talks to the band directly (no Mind Monitor, no phone), decodes every stream it sends, and serves
them to the page in dashboard/ (as /api/muse) over a local API on 127.0.0.1:5301:

    GET  /api/stream      server-sent events: state, data (20 Hz), stats (2 Hz), event
    GET  /api/state       the state snapshot
    POST /api/scan        nearby Muse bands, strongest first
    POST /api/connect     {"address": ..., "preset": "p50"}; reconnects on its own until disconnect
    POST /api/disconnect  and forget the band
    POST /api/autoconnect the remembered band, or the strongest one a scan finds
    POST /api/preset      {"preset": "p21"}: halt, switch, status, stream again
    POST /api/status      ask the band for its status line again (battery, preset)
    POST /api/record      {"on": true, "label": "YYYYMMDD-HHMM"} | {"on": false}

It is one of the three Hypnos sensor programs (live_server.py has the shared plumbing; close
Mind Monitor and the Muse app first, either one holds the band):

    ./run.sh                                            # all three + the page, http://localhost:5300

The band connected last is remembered (data/.recorder-muse.json) and linked again at start.
Recording writes ../data/muse-<label>/ (appending after a crash-restart):
    muse.bin        30-byte records <qBB20s: Mac UTC ms at arrival, kind, payload length, the
                    notification as received. Kinds:
                    0-4 EEG TP9/AF7/AF8/TP10/AUX, 5 gyro, 6 acc, 7 telemetry, 8-10 PPG, 11 control
    muse-meta.json  device, preset, control replies, start/stop, per-stream counters at stop
    events.log      connects, drops, commands, replies

Decoding follows muse-lsl: EEG = uint16 BE packet index + 12 samples x 12 bit BE packed,
uV = 0.48828125 * (raw - 2048) at 256 Hz; acc/gyro = index + 3 samples x int16 BE x,y,z at 52 Hz
(0.0000610352 g, 0.0074768 deg/s per LSB); PPG = index + 6 samples x uint24 BE at 64 Hz;
telemetry = index, battery/512 %, fuel gauge * 2.2 mV, adc, temperature. A lost packet shows as
a gap in its stream's index, and is filled with NaN so every trace keeps its sample clock.

PPG on this band (MS-01, measured 2026-10-15): muse-lsl calls the three channels ambient, IR and
red, which is the Muse 2. Here channels 1 and 2 are both lit and both carry the pulse (86k and
338k counts, pulse 35 dB over the noise) and channel 3 reads ~4 counts of 16.7 M: no LED. So
they are named by number, and heart rate comes from 1 and 2.
"""

import argparse
import asyncio
import collections
import json
import math
import os
import struct
import subprocess
import time
from datetime import datetime

import numpy as np
from scipy import signal as sps

from live_server import BleLink, rec_dir, resumable, save_json


def char_uuid(n):
    return f"273e{n:04x}-4c4d-454d-96be-f03bac821358"


# kind, name, characteristic, samples per packet
STREAMS = [
    (0, "TP9", 0x03, 12), (1, "AF7", 0x04, 12), (2, "AF8", 0x05, 12), (3, "TP10", 0x06, 12),
    (4, "AUX", 0x07, 12), (5, "gyro", 0x09, 3), (6, "acc", 0x0A, 3), (7, "tele", 0x0B, 1),
    (8, "ppg1", 0x0F, 6), (9, "ppg2", 0x10, 6), (10, "ppg3", 0x11, 6), (11, "ctl", 0x01, 0),
]
NAMES = [s[1] for s in STREAMS]
CTL = char_uuid(0x01)
EEG_HZ, IMU_HZ, PPG_HZ = 256, 52, 64
EEG_UV, ACC_G, GYRO_DPS = 0.48828125, 0.0000610352, 0.0074768
PRESETS = ["p20", "p21", "p22", "p23", "p50", "p51", "p52", "p53", "p60", "p61", "p63"]
MAX_FILL = 64  # packets of NaN inserted for one gap; a longer gap is a restart, not loss


def eeg12(d):
    out = []
    for j in range(2, 20, 3):
        out.append((d[j] << 4) | (d[j + 1] >> 4))
        out.append(((d[j + 1] & 15) << 8) | d[j + 2])
    return out


class Track:
    """Packet-index bookkeeping for one stream: rate, loss, last arrival."""

    def __init__(self):
        self.last_idx = None
        self.pkts = 0
        self.lost = 0
        self.last_t = None
        self.recent = collections.deque()  # (arrival, packets lost just before it), last 10 s

    def packet(self, idx, now):
        gap = 0
        if self.last_idx is not None:
            d = (idx - self.last_idx) & 0xFFFF
            if 1 < d <= MAX_FILL:
                gap = d - 1
        self.last_idx = idx
        self.pkts += 1
        self.lost += gap
        self.last_t = now
        self.recent.append((now, gap))
        return gap

    def stat(self, now, per_pkt):
        while self.recent and self.recent[0][0] < now - 10:
            self.recent.popleft()
        got2 = sum(1 for t, _ in self.recent if t >= now - 2)
        got10 = len(self.recent)
        lost10 = sum(g for _, g in self.recent)
        return {
            "pps": round(got2 / 2, 1),
            "sps": round(got2 / 2 * per_pkt, 1),
            "loss": round(100 * lost10 / (got10 + lost10), 1) if got10 + lost10 else None,
            "lost": self.lost,
            "pkts": self.pkts,
            "age": round(now - self.last_t, 1) if self.last_t else None,
        }


class Recorder:
    REC = struct.Struct("<qBB20s")

    def __init__(self, muse, label, resume=None):
        self.dir = rec_dir("muse", label, muse.data)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.f = open(self.dir / "muse.bin", "ab")  # append: a crash-restart continues the same file
        self.ev = open(self.dir / "events.log", "a")
        self.bytes = (self.dir / "muse.bin").stat().st_size
        self.n = self.bytes // self.REC.size
        # keeps the Mac awake while this records; dies with this process
        self.caff = subprocess.Popen(["caffeinate", "-i", "-s", "-w", str(os.getpid())])
        if resume:
            self.meta = resume
            self.meta["final"] = 0
            self.meta.setdefault("resumed_utc_ms", []).append(int(time.time() * 1000))
        else:
            off = datetime.now().astimezone().utcoffset()
            self.meta = {
                "label": label,
                "start_utc_ms": int(time.time() * 1000),
                "tz_min": int(off.total_seconds() // 60) if off else 0,
                "device": muse.device,
                "address": muse.want,
                "preset": muse.preset,
                "info": dict(muse.info),
                "record": "<qBB20s: utc_ms, kind, len, payload",
                "kinds": NAMES,
                "final": 0,
            }
        self.t0 = self.meta["start_utc_ms"] / 1000
        self.save_meta()

    def save_meta(self):
        save_json(self.dir / "muse-meta.json", self.meta)

    def write(self, now, kind, data):
        d = bytes(data[:20])
        self.f.write(self.REC.pack(int(now * 1000), kind, len(d), d))
        self.n += 1
        self.bytes += self.REC.size

    def note(self, line):
        self.ev.write(line + "\n")

    def flush(self):
        self.f.flush()
        self.ev.flush()

    def stop(self, muse, final=True):
        now = time.time()
        self.flush()
        self.f.close()
        self.ev.close()
        self.caff.terminate()
        self.meta.update({
            "end_utc_ms": int(now * 1000),
            "records": self.n,
            "info": dict(muse.info),
            "counters": {name: {"pkts": t.pkts, "lost": t.lost} for name, t in zip(NAMES, muse.tracks)},
            "connects": muse.connects,
            "drops": muse.drops,
            "down_s": round(muse.down_total() / 1000, 1),
            "final": 1 if final else 0,
        })
        self.save_meta()


class Muse(BleLink):
    PREFIX = "muse"
    name = "Muse"

    def __init__(self):
        super().__init__()
        self.preset = "p50"
        self.info = {}
        self.tele = None
        self.ctl_buf = ""
        self.tracks = [Track() for _ in STREAMS]
        self.eeg = [collections.deque(maxlen=EEG_HZ * 10) for _ in range(5)]
        self.acc = collections.deque(maxlen=IMU_HZ * 10)
        self.gyro = collections.deque(maxlen=IMU_HZ * 10)
        self.ppg = [collections.deque(maxlen=PPG_HZ * 12) for _ in range(3)]
        self.pend = self.empty_pending()

    # ---------- packets ----------

    @staticmethod
    def empty_pending():
        return {"eeg": [[] for _ in range(5)], "acc": [], "gyro": [], "ppg": [[] for _ in range(3)]}

    def on_packet(self, kind, data):
        now = time.time()
        self.last_rx = now
        if self.rec:
            self.rec.write(now, kind, data)
        if kind == 11:
            self.tracks[11].pkts += 1
            self.tracks[11].last_t = now
            self.on_control(data)
            return
        if len(data) < (10 if kind == 7 else 20):
            return
        gap = self.tracks[kind].packet((data[0] << 8) | data[1], now)
        if kind <= 4:
            vals = [EEG_UV * (v - 2048) for v in eeg12(data)]
            if gap:
                vals = [math.nan] * (12 * gap) + vals
            self.eeg[kind].extend(vals)
            self.pend["eeg"][kind].extend(vals)
        elif kind in (5, 6):
            raw = struct.unpack(">9h", bytes(data[2:20]))
            sc = GYRO_DPS if kind == 5 else ACC_G
            smp = [(raw[i] * sc, raw[i + 1] * sc, raw[i + 2] * sc) for i in (0, 3, 6)]
            if gap:
                smp = [(math.nan,) * 3] * (3 * gap) + smp
            buf, pend = (self.gyro, self.pend["gyro"]) if kind == 5 else (self.acc, self.pend["acc"])
            buf.extend(smp)
            pend.extend(smp)
        elif kind == 7:
            v = struct.unpack(">5H", bytes(data[0:10]))
            self.tele = {"batt": round(v[1] / 512, 1), "fuel_mv": round(v[2] * 2.2), "adc": v[3], "temp": v[4]}
            self.push_state()
        else:
            vals = [(data[j] << 16) | (data[j + 1] << 8) | data[j + 2] for j in range(2, 20, 3)]
            if gap:
                vals = [math.nan] * (6 * gap) + vals
            self.ppg[kind - 8].extend(vals)
            self.pend["ppg"][kind - 8].extend(vals)

    def on_control(self, data):
        n = data[0] if data else 0
        self.ctl_buf += bytes(data[1:1 + n]).decode("ascii", "replace")
        while "}" in self.ctl_buf:
            j = self.ctl_buf.index("}") + 1
            msg, self.ctl_buf = self.ctl_buf[:j], self.ctl_buf[j:]
            msg = msg[msg.find("{"):] if "{" in msg else msg
            self.log("muse " + msg)
            try:
                self.info.update(json.loads(msg))
            except ValueError:
                pass
            self.push_state()

    # ---------- link (the machinery is BleLink's) ----------

    def match(self, name):
        return name.lower().startswith("muse")

    async def cmd(self, s):
        if not (self.client and self.client.is_connected):
            return
        await self.client.write_gatt_char(CTL, bytes([len(s) + 1]) + s.encode() + b"\n", response=False)
        self.log("cmd " + s)

    async def setup(self, client):
        self.ctl_buf = ""
        for t in self.tracks:
            t.last_idx = None  # packet indices restart on a new link
        subscribed = 0
        for kind, _name, c, _n in STREAMS:
            ch = client.services.get_characteristic(char_uuid(c))
            if ch is None:
                continue
            await client.start_notify(ch, self.handler(kind))
            subscribed += 1
        self.last_rx = time.time()
        for s in ("h", "v1", self.preset, "s", "d"):
            await self.cmd(s)
            await asyncio.sleep(0.15)
        self.log(f"{subscribed} characteristics, preset {self.preset}")
        if self.rec:
            self.rec.meta["address"] = self.want
            self.rec.save_meta()

    def handler(self, kind):
        def on_notify(_sender, data):
            self.on_packet(kind, data)
        return on_notify

    async def kick(self):
        await self.cmd("d")

    async def before_disconnect(self, client):
        await client.write_gatt_char(CTL, b"\x02h\n", response=False)

    async def resume(self):
        """A restart mid-night: append to the recording it was writing."""
        r = resumable("muse", "muse-meta.json", self.data)
        if not r:
            return
        d, meta = r
        self.rec = Recorder(self, d.name[len("muse-"):], resume=meta)
        self.log(f"resumed recording data/{d.name}")
        self.push_state()

    # ---------- what the page gets ----------

    def state(self):
        rec = {"on": False}
        if self.rec:
            rec = {"on": True, "dir": self.rec.dir.name, "label": self.rec.meta.get("label"),
                   "since": int(self.rec.t0 * 1000)}
        return {"t": "state", **self.link_state(), "preset": self.preset, "presets": PRESETS,
                "info": self.info, "tele": self.tele, "rec": rec}

    def take_data(self):
        p, self.pend = self.pend, self.empty_pending()

        def clean(vals, nd):
            return [None if v != v else round(v, nd) for v in vals]

        def cols(rows, nd):
            return [clean([r[a] for r in rows], nd) for a in range(3)]

        if not (any(p["eeg"]) or p["acc"] or p["gyro"] or any(p["ppg"])):
            return None
        return {
            "t": "data",
            "eeg": [clean(ch, 1) for ch in p["eeg"]],
            "acc": cols(p["acc"], 4),
            "gyro": cols(p["gyro"], 2),
            "ppg": [clean(ch, 0) for ch in p["ppg"]],
        }

    def stats(self):
        now = time.time()
        streams = {name: t.stat(now, per) for (_k, name, _c, per), t in zip(STREAMS, self.tracks)}
        # the buffers keep their last samples after a stream stops, and a reading from them shows a
        # band that is off as still on: a stream silent for 3 s gives none (the page greys it out too)
        quiet = {n for n, st in streams.items() if st["age"] is None or st["age"] >= 3}
        out = {
            "t": "stats",
            "streams": streams,
            "eeg": [], "bands": [], "emg": [], "spec": [],
            "hr": self.heart_rates(quiet),
            "motion": None,
            "rec_bytes": self.rec.bytes if self.rec else None,
        }
        for c in range(5):
            x = np.asarray([] if NAMES[c] in quiet else self.eeg[c], dtype=float)
            eeg = bands = emg = spec = None
            if len(x) >= EEG_HZ:
                last = x[-EEG_HZ:]
                v = last[~np.isnan(last)]
                if len(v) >= EEG_HZ // 2:
                    rails = int(((v <= -999.9) | (v >= 999.4)).sum())
                    ac = float(np.std(sps.detrend(v)))
                    q = 3 if rails > 5 or ac >= 150 else (1 if ac < 40 else 2)
                    eeg = {"dc": round(float(v.mean()), 1), "ac": round(ac, 1), "rails": rails, "q": q}
                w = x[-EEG_HZ * 4:]
                good = ~np.isnan(w)
                if len(w) >= EEG_HZ * 2 and good.mean() > 0.7:
                    i = np.arange(len(w))
                    w = np.interp(i, i[good], w[good])
                    f, pxx = sps.welch(w, fs=EEG_HZ, nperseg=EEG_HZ, noverlap=EEG_HZ // 2)
                    spec = [round(float(d), 1) for d in 10 * np.log10(pxx[:101] + 1e-9)]
                    bp = [float(pxx[(f >= lo) & (f < hi)].sum()) for lo, hi in ((1, 4), (4, 8), (8, 13), (13, 30), (30, 45))]
                    tot = sum(bp) or 1.0
                    bands = [round(b / tot, 3) for b in bp]
                    emg = round(float(10 * np.log10(pxx[(f >= 55) & (f <= 100)].mean() + 1e-9)), 1)
            out["eeg"].append(eeg)
            out["bands"].append(bands)
            out["emg"].append(emg)
            out["spec"].append(spec)
        a = np.asarray([] if "acc" in quiet else self.acc, dtype=float)
        if len(a) >= IMU_HZ:
            g = np.nanmean(a[-IMU_HZ // 2:], axis=0)
            mag = np.linalg.norm(a[-IMU_HZ * 2:], axis=1)
            if not np.isnan(g).any():
                out["motion"] = {"g": [round(float(v), 3) for v in g], "move": round(float(np.nanstd(mag) * 1000), 1)}
        return out

    def heart_rate(self, ch):
        """(bpm, regularity) from the last 8 s of one PPG channel, or None when the beats are not regular."""
        x = np.asarray(self.ppg[ch], dtype=float)[-PPG_HZ * 8:]
        if len(x) < PPG_HZ * 6 or np.isnan(x).any():
            return None
        y = -sps.sosfiltfilt(sps.butter(2, [0.7, 3.5], btype="band", fs=PPG_HZ, output="sos"), x - x.mean())
        pk, _ = sps.find_peaks(y, distance=int(PPG_HZ * 0.33), prominence=float(np.std(y)) * 0.5)
        if len(pk) < 4:
            return None
        ibi = np.diff(pk) / PPG_HZ
        med = float(np.median(ibi))
        reg = float(np.mean(np.abs(ibi - med) < 0.2 * med))
        if reg < 0.7:
            return None
        return 60 / med, reg

    def heart_rates(self, quiet):
        a = None if "ppg1" in quiet else self.heart_rate(0)
        b = None if "ppg2" in quiet else self.heart_rate(1)
        if a and b:
            bpm = (a[0] + b[0]) / 2 if abs(a[0] - b[0]) <= 6 else max(a, b, key=lambda r: r[1])[0]
        else:
            bpm = (a or b or (None,))[0]
        return {"bpm": round(bpm) if bpm else None,
                "ppg1": round(a[0]) if a else None, "ppg2": round(b[0]) if b else None}

    async def publisher(self):
        n = 0
        while True:
            await asyncio.sleep(0.05)
            n += 1
            d = self.take_data()
            if d:
                self.broadcast(d)
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
        if path == "/api/connect" and args.get("preset") in PRESETS:
            self.preset = args["preset"]
        r = await self.link_route(method, path, args)
        if r:
            return r
        if method != "POST":
            return 404, {"error": "not found"}
        if path == "/api/preset":
            if args.get("preset") not in PRESETS:
                return 400, {"error": "unknown preset"}
            self.preset = args["preset"]
            for s in ("h", self.preset, "s", "d"):
                await self.cmd(s)
                await asyncio.sleep(0.15)
            self.push_state()
            return 200, {"ok": True}
        if path == "/api/status":
            await self.cmd("s")
            return 200, {"ok": True}
        if path == "/api/record":
            label = "".join(c for c in str(args.get("label") or "") if c.isalnum() or c in "-_")
            if args.get("on"):
                label = label or datetime.now().strftime("%Y%m%d-%H%M%S")
                if self.rec and self.rec.meta.get("label") != label:
                    self.stop_recording(final=True)  # a new night while an old one was still open
                if not self.rec:
                    self.rec = Recorder(self, label)
                    self.log(f"recording to data/{self.rec.dir.name}")
            elif self.rec:
                self.stop_recording(final=True)
            self.push_state()
            return 200, {"ok": True}
        return 404, {"error": "not found"}

    def stop_recording(self, final):
        rec, self.rec = self.rec, None
        rec.stop(self, final)
        self.log(f"recording {'stopped' if final else 'saved'}, {rec.n} packets, {rec.bytes / 1e6:.1f} MB")

    async def shutdown(self):
        if self.rec:
            self.stop_recording(final=False)
        await self.disconnect(forget=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=5301)
    m = Muse()
    m.run(ap.parse_args().port, (m.publisher, m.watchdog, m.resume, m.startup))


if __name__ == "__main__":
    main()
