#!/usr/bin/env python3
"""live_server.py - what the three Hypnos sensor programs share.

    live_muse.py   :5301  data/muse-<label>/    the Muse S headband
    live_polar.py  :5302  data/polar-<label>/   the Polar H10 chest strap
    live_band.py   :5303  data/band-<label>/    the Vexo band (the kit's library holds its link)

The page (dashboard/) reaches them through its Vite proxy as /api/muse, /api/polar and /api/band,
so each program only ever sees paths that start with /api/. run.sh starts all three and starts a
program again when it exits.

LiveServer is the local HTTP + server-sent-events API: GET /api/stream sends the state first and
then whatever the program broadcasts; every other request goes to route(). BleLink adds one
Bluetooth device kept linked: scan, connect, reconnect forever with every call bounded by a
timeout, a watchdog that drops a link gone silent, and the remembered device (data/.recorder-
<prefix>.json): the program connects to it by itself at start and Disconnect forgets it.

Resume: a recording whose meta says "final": 0 and that was written in the last RESUME_S seconds
is the same night after a crash, so the restarted program appends to it. Only Stop writes
"final": 1; Ctrl-C and SIGTERM leave it 0.
"""
import asyncio
import collections
import json
import signal
import sys
import time
from datetime import datetime
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
RESUME_S = 600
LOOPBACK = ("localhost", "127.0.0.1", "::1")


def rec_dir(prefix, label, data=None):
    return (data or DATA) / f"{prefix}-{label}"


def resumable(prefix, meta_name, data=None, now=None):
    """(folder, meta) of the recording a restarted program continues, or None."""
    now = time.time() if now is None else now
    best = None
    for d in (data or DATA).glob(f"{prefix}-*"):
        m = d / meta_name
        if not m.is_file():
            continue
        try:
            meta = json.loads(m.read_text())
        except ValueError:
            continue
        if meta.get("final"):
            continue
        written = max(p.stat().st_mtime for p in d.iterdir())
        if now - written < RESUME_S and (best is None or written > best[0]):
            best = (written, d, meta)
    return (best[1], best[2]) if best else None


def save_json(path, obj):
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(obj, indent=1))
    tmp.replace(path)


class LiveServer:
    name = "live"

    def __init__(self):
        self.clients = set()
        self.streams = {}  # more event streams a program offers: path -> its own set of clients

    def state(self):
        raise NotImplementedError

    async def route(self, method, path, body):
        return 404, {"error": "not found"}

    async def shutdown(self):
        """Ctrl-C or SIGTERM: flush and close. A recording stays final 0, so a restart resumes it."""

    def push_state(self):
        self.broadcast(self.state())

    def broadcast(self, obj, clients=None):
        clients = self.clients if clients is None else clients
        if not clients:
            return
        s = json.dumps(obj, separators=(",", ":"))
        for q in list(clients):
            if not q.full():  # a tab that cannot keep up drops frames instead of holding memory
                q.put_nowait(s)

    async def serve(self, reader, writer):
        try:
            head = await reader.readuntil(b"\r\n\r\n")
            lines = head.decode("latin-1").split("\r\n")
            method, target = lines[0].split(" ")[:2]
            hdr = {}
            for line in lines[1:]:
                if ":" in line:
                    k, v = line.split(":", 1)
                    hdr[k.strip().lower()] = v.strip()
            body = await reader.readexactly(int(hdr.get("content-length") or 0))
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, ConnectionError, ValueError):
            writer.close()
            return
        path = target.split("?")[0]
        # Only the page may command a device. Any other web page in the browser can POST here (a
        # text/plain POST needs no CORS preflight) and a rebinding DNS name can reach 127.0.0.1, so:
        # a loopback Host, and JSON for every POST (the page always sends it; a cross-site JSON POST
        # needs a preflight, which this server never answers).
        host = hdr.get("host", "")
        host = host[1:host.find("]")] if host.startswith("[") else host.split(":")[0]   # "[::1]:5188", "localhost:5188"
        if host not in LOOPBACK:
            code, obj = 403, {"error": "not a local request"}
        elif method == "POST" and not hdr.get("content-type", "").startswith("application/json"):
            code, obj = 415, {"error": "POST JSON"}
        elif method == "GET" and path == "/api/stream":
            await self.sse(writer)
            return
        elif method == "GET" and path in self.streams:
            await self.sse(writer, self.streams[path])
            return
        else:
            try:
                code, obj = await self.route(method, path, body)
            except Exception as e:
                code, obj = 500, {"error": str(e) or type(e).__name__}
        data = json.dumps(obj).encode()
        writer.write(f"HTTP/1.1 {code} {'OK' if code == 200 else 'Error'}\r\nContent-Type: application/json\r\n"
                     f"Content-Length: {len(data)}\r\nConnection: close\r\n\r\n".encode() + data)
        try:
            await writer.drain()
        except ConnectionError:
            pass
        writer.close()

    async def sse(self, writer, clients=None):
        def chunk(b):
            return f"{len(b):x}\r\n".encode() + b + b"\r\n"

        q = asyncio.Queue(maxsize=400)
        if clients is None:  # the main stream starts with the state
            clients = self.clients
            q.put_nowait(json.dumps(self.state(), separators=(",", ":")))
        clients.add(q)
        writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\n"
                     b"Transfer-Encoding: chunked\r\nConnection: keep-alive\r\nX-Accel-Buffering: no\r\n\r\n")
        try:
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), 1)
                    writer.write(chunk(b"data: " + msg.encode() + b"\n\n"))
                except asyncio.TimeoutError:
                    # a real message, not an SSE comment: the page counts a program as offline after
                    # 3 s without one, and an idle program has nothing else to say
                    writer.write(chunk(b'data: {"t":"ping"}\n\n'))
                await writer.drain()
        except (ConnectionError, asyncio.CancelledError):
            pass
        finally:
            clients.discard(q)
            writer.close()

    def run(self, port, tasks=()):
        asyncio.run(self._main(port, tasks))

    async def _main(self, port, tasks):
        async def guarded(t):
            while True:
                try:
                    return await t()
                except Exception as e:  # one disk error must not end a task for the night; a cancel still ends it
                    print(f"{self.name}: {t.__name__}: {str(e) or type(e).__name__}", flush=True)
                    await asyncio.sleep(1)

        server = await asyncio.start_server(self.serve, "127.0.0.1", port)
        running = [asyncio.ensure_future(guarded(t)) for t in tasks]
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        for s in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(s, stop.set)
        print(f"{self.name} API on http://127.0.0.1:{port}", flush=True)
        await stop.wait()
        await self.shutdown()
        for t in running:
            t.cancel()
        server.close()


class BleLink(LiveServer):
    """One Bluetooth device kept linked. Subclasses supply match(name) and setup(client); kick()
    is called once after 5 s of silence, before_disconnect(client) before an asked-for disconnect.
    Every arriving notification must set self.last_rx, or the watchdog drops the link."""

    PREFIX = "dev"
    QUIET_S = 12

    def __init__(self):
        super().__init__()
        self.data = None             # the data folder; None = DATA (tests point it elsewhere)
        self.client = None
        self.want = None             # address to stay linked to; None = stay disconnected
        self.link = "idle"
        self.device = None
        self.found = []
        self.connects = 0
        self.drops = 0               # links lost without anyone asking
        self.attempts = 0            # failed connects since the last good one
        self.last_error = None
        self.down_ms = 0.0           # time spent reconnecting after those drops
        self.down_since = None
        self.last_rx = 0.0
        self.kicked = False
        self.reconnect_task = None
        self.rec = None
        self.events = collections.deque(maxlen=200)
        self.started = time.time()
        self.cbm = None              # this program's own CoreBluetooth manager, for known_device()

    # ---------- hooks ----------

    def match(self, name):
        return False

    async def setup(self, client):
        pass

    async def kick(self):
        pass

    async def before_disconnect(self, client):
        pass

    # ---------- the remembered device ----------

    def _mem(self):
        return (self.data or DATA) / f".recorder-{self.PREFIX}.json"

    def remembered(self):
        try:
            d = json.loads(self._mem().read_text())
        except (OSError, ValueError):
            return None
        return d if d.get("address") else None

    def remember(self, device):
        self._mem().parent.mkdir(parents=True, exist_ok=True)
        save_json(self._mem(), {"name": device.get("name"), "address": device["address"]})

    def forget(self):
        try:
            self._mem().unlink()
        except FileNotFoundError:
            pass

    # ---------- link ----------

    def log(self, text):
        ts = int(time.time() * 1000)
        self.events.append([ts, text])
        print(f"{datetime.now():%H:%M:%S} {self.name}: {text}", flush=True)
        if self.rec:
            self.rec.note(f"{ts} {text}")
        self.broadcast({"t": "event", "ts": ts, "text": text})

    def set_link(self, link):
        if link != self.link:
            self.link = link
            self.push_state()

    async def scan(self):
        from bleak import BleakScanner

        idle = self.link == "idle"
        if idle:
            self.set_link("scanning")
        try:
            # 8 s: the Polar H10 advertises slowly and a 4 s scan missed it at -45 dBm (2026-10-15)
            found = await BleakScanner.discover(timeout=8.0, return_adv=True)
        finally:
            if idle and self.link == "scanning":
                self.set_link("idle")
        res = []
        for addr, (dev, adv) in found.items():
            name = adv.local_name or dev.name or ""
            if self.match(name):
                res.append({"name": name, "address": addr, "rssi": adv.rssi})
        self.found = sorted(res, key=lambda r: -r["rssi"])
        self.log(f"scan: {len(self.found)} found of {len(found)} devices")
        self.push_state()

    async def known_device(self, address):
        """The peripheral this Mac already knows as `address`, without a scan. macOS reconnects a
        paired device by itself, and a connected device does not advertise, so after the first
        pairing a scan never sees it again (measured 2026-10-15: system_profiler said Connected while
        every scan came back empty). CoreBluetooth hands a known peripheral out by its identifier."""
        if sys.platform != "darwin":
            return None
        from Foundation import NSArray, NSUUID
        from bleak.backends.corebluetooth.CentralManagerDelegate import CentralManagerDelegate
        from bleak.backends.device import BLEDevice

        if self.cbm is None:
            cbm = CentralManagerDelegate()
            await cbm.wait_until_ready()
            self.cbm = cbm
        ident = NSUUID.alloc().initWithUUIDString_(address)
        if ident is None:
            return None
        found = self.cbm.central_manager.retrievePeripheralsWithIdentifiers_(NSArray.arrayWithObject_(ident))
        if not found:
            return None
        return BLEDevice(address, found[0].name(), (found[0], self.cbm))

    async def connect_once(self, address):
        from bleak import BleakClient, BleakScanner

        self.set_link("connecting")
        dev = await self.known_device(address) or await BleakScanner.find_device_by_address(address, timeout=8.0)
        if dev is None:
            raise RuntimeError("not advertising")
        client = BleakClient(dev, disconnected_callback=self.on_disconnect, timeout=15.0)
        await client.connect()
        self.client = client
        self.device = {"name": dev.name or self.name, "address": address}
        self.last_rx = time.time()
        await self.setup(client)
        if self.client is not client:  # the link dropped inside setup(), which does not always raise
            raise RuntimeError("link lost during setup")
        self.connects += 1
        self.attempts = 0
        self.last_error = None
        self.remember(self.device)
        self.set_link("streaming")
        self.log(f"connected {self.device['name']}")
        if self.down_since:
            gone = time.time() - self.down_since
            self.down_ms += gone * 1000
            self.down_since = None
            self.log(f"back after {gone:.0f} s, {self.drops} drops so far")

    def on_disconnect(self, client):
        if client is not self.client:
            return  # a link already written off (watchdog, failed attempt, Disconnect) reporting late
        self.link_lost("link down")

    def link_lost(self, why):
        self.client = None
        self.log(why)
        if self.want:
            self.drops += 1
            self.down_since = self.down_since or time.time()
            self.set_link("reconnecting")
            self.ensure_link()
        else:
            self.set_link("idle")

    def ensure_link(self):
        if self.reconnect_task and not self.reconnect_task.done():
            return
        self.reconnect_task = asyncio.ensure_future(self.keep_linked())

    async def keep_linked(self):
        delay = 1.0
        while self.want and not (self.client and self.client.is_connected):
            try:
                # bounded as a whole: a CoreBluetooth call that never returns must not end the night
                await asyncio.wait_for(self.connect_once(self.want), 45)
                return
            except Exception as e:  # BLE failures come in many types; every one means retry
                self.attempts += 1
                self.last_error = str(e) or type(e).__name__
                self.log(f"connect failed: {self.last_error}")
                c, self.client = self.client, None
                if c:
                    try:
                        await asyncio.wait_for(c.disconnect(), 5)
                    except Exception:
                        pass
                if not self.want:
                    break
                self.set_link("reconnecting")
                await asyncio.sleep(delay)
                delay = min(delay * 2, 10.0)
        if not self.want:
            self.set_link("idle")

    async def disconnect(self, forget=True):
        self.want = None
        t = self.reconnect_task
        if t and not t.done():
            t.cancel()
            await asyncio.wait([t])  # a Connect right after must find no retry left, or ensure_link() starts none
        c, self.client = self.client, None
        if self.down_since:
            self.down_ms += (time.time() - self.down_since) * 1000
            self.down_since = None
        if c and c.is_connected:
            try:
                await asyncio.wait_for(self.before_disconnect(c), 3)
                await asyncio.wait_for(c.disconnect(), 5)
            except Exception:
                pass
        if forget:
            self.forget()
        self.set_link("idle")

    async def watchdog(self):
        while True:
            await asyncio.sleep(1)
            if self.link != "streaming" or not self.client:
                continue
            quiet = time.time() - self.last_rx
            if quiet > self.QUIET_S:
                c = self.client
                self.link_lost(f"no data for {self.QUIET_S} s, dropping the link")
                try:
                    await asyncio.wait_for(c.disconnect(), 5)
                except Exception:
                    pass
            elif quiet > 5 and not self.kicked:
                self.kicked = True
                await self.kick()
            elif quiet < 2:
                self.kicked = False

    async def startup(self):
        """At start: link the remembered device and keep trying until it shows up."""
        r = self.remembered()
        if r and not self.want:
            self.want = r["address"]
            self.log(f"connecting to {r.get('name') or r['address']}")
            self.ensure_link()

    async def autoconnect(self):
        """The switch on a card of the page: the remembered device, else the strongest one a scan finds."""
        if self.want:
            self.ensure_link()
            return {"ok": 1, "address": self.want}
        r = self.remembered()
        if not r:
            from bleak import BleakScanner

            # the first matching device, as soon as it is heard, rather than a fixed-length scan
            dev = await BleakScanner.find_device_by_filter(
                lambda d, adv: self.match(adv.local_name or d.name or ""), timeout=12.0)
            if dev is None:
                return {"ok": 0, "err": "nothing found"}
            r = {"address": dev.address, "name": dev.name}
        self.want = r["address"]
        self.ensure_link()
        return {"ok": 1, "address": self.want}

    def down_total(self):
        return self.down_ms + ((time.time() - self.down_since) * 1000 if self.down_since else 0)

    def link_state(self):
        return {
            "link": self.link, "device": self.device, "found": self.found,
            "connects": self.connects, "drops": self.drops, "down_s": round(self.down_total() / 1000),
            "attempts": self.attempts, "last_error": self.last_error, "remembered": self.remembered(),
            "uptime_s": round(time.time() - self.started), "events": list(self.events)[-80:],
        }

    async def link_route(self, method, path, args):
        """The four link endpoints every program has; None when the path is not one of them."""
        if method != "POST":
            return None
        if path == "/api/scan":
            await self.scan()
            return 200, {"found": self.found}
        if path == "/api/connect":
            if not args.get("address"):
                return 400, {"error": "no address"}
            if self.client or self.want:
                await self.disconnect(forget=False)
            self.want = args["address"]
            self.ensure_link()
            return 200, {"ok": True}
        if path == "/api/disconnect":
            await self.disconnect()
            return 200, {"ok": True}
        if path == "/api/autoconnect":
            return 200, await self.autoconnect()
        return None
