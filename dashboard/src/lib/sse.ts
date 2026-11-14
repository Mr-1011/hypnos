// What the three device clients share: one program's server-sent events, its online flag, and the
// subscribe/version pair useSyncExternalStore wants. Each program lives under its own prefix
// (/api/band, /api/muse, /api/polar), which the Vite proxy maps to its port.

export type Link = 'idle' | 'scanning' | 'connecting' | 'streaming' | 'reconnecting'

export const LINK_LABEL: Record<Link, string> = {
  idle: 'Idle',
  scanning: 'Scanning',
  connecting: 'Connecting',
  streaming: 'Live',
  reconnecting: 'Reconnecting',
}

export interface Found {
  name: string
  address: string
  rssi: number
}

// live_server.BleLink.link_state(), part of every program's state
export interface LinkState {
  link: Link
  device: { name: string; address: string } | null
  found: Found[]
  connects: number
  drops: number
  down_s: number
  attempts: number
  last_error: string | null
  remembered: { name?: string; address: string } | null
  uptime_s: number
  events: [number, string][]
}

export class Source<M> {
  online = false
  private lastMsg = 0
  private seq = 0
  private subs = new Set<() => void>()
  private started = false
  private es: EventSource | null = null
  private openedAt = 0

  // onMsg returns true when the page should render again; data that only feeds rings returns false
  constructor(
    readonly base: string,
    private onMsg: (m: M) => boolean,
  ) {}

  start() {
    if (this.started) return
    this.started = true
    this.open()
    window.setInterval(() => {
      const on = Date.now() - this.lastMsg < 3000
      if (on !== this.online) {
        this.online = on
        this.emit()
      }
      // A program killed mid-stream leaves the proxy's answer open: no error, no data, and the
      // restarted program never shows up. Every program pings once a second, so an open stream
      // that is silent for 3 s is dead.
      if (!on && this.es?.readyState === EventSource.OPEN && Date.now() - this.openedAt > 3000) {
        this.es.close()
        this.open()
      }
    }, 1000)
  }

  private open() {
    const es = new EventSource(`${this.base}/stream`)
    this.es = es
    this.openedAt = Date.now()
    es.onmessage = (e) => {
      this.lastMsg = Date.now()
      const wasOnline = this.online
      this.online = true
      const m = JSON.parse(e.data)
      const render = m.t === 'ping' ? false : this.onMsg(m as M) // ping: the program is alive, nothing else
      if (render || !wasOnline) this.emit()
    }
    // A dropped stream reconnects by itself, but an error answer (the proxy's 500 while the
    // program is not listening yet, or restarting) closes an EventSource for good.
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) window.setTimeout(() => this.es === es && this.open(), 2000)
    }
  }

  subscribe = (fn: () => void) => {
    this.subs.add(fn)
    return () => {
      this.subs.delete(fn)
    }
  }

  version = () => this.seq

  emit() {
    this.seq++
    this.subs.forEach((f) => f())
  }
}

// POST to one program; a program that is down answers with {ok: 0, err: 'offline'}
export async function post(base: string, path: string, body?: unknown): Promise<any> {
  try {
    const r = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
    return await r.json()
  } catch {
    return { ok: 0, err: 'offline' }
  }
}

export function appendEvent<S extends { events: [number, string][] }>(state: S | null, ts: number, text: string): S | null {
  return state ? { ...state, events: [...state.events, [ts, text] as [number, string]].slice(-80) } : null
}
