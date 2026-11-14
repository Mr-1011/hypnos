import { useSyncExternalStore } from 'react'
import { Ring } from './ring'
import { Source, appendEvent, post, type LinkState } from './sse'

export const MOTION_HZ = 50 // RATE in sensors/live_band.py

export interface BandState extends LinkState {
  rec: { on: boolean; dir?: string; label?: string; since?: number }
  firmware: string | null
}

export interface BandStats {
  move: number | null // mg: the spread of |a| over the last 2 s, the Muse's movement number
  hz: number // motion samples a second that arrive
  lost: number
  battery: number | null
  charging: boolean | null
  rssi: number | null
  activity: 'still' | 'walk' | 'run' | null // the band's own verdict
  steps: number | null // since this link
}

type Col = (number | null)[]
type Msg =
  | ({ t: 'state' } & BandState)
  | ({ t: 'stats' } & BandStats)
  | { t: 'data'; acc: Col[]; gyro: Col[] }
  | { t: 'event'; ts: number; text: string }

const num = (v: number | null) => (v === null ? NaN : v)

class BandLive {
  state: BandState | null = null
  stats: BandStats | null = null
  statsSeq = 0
  // the Live tab's 20 s view, plus the playhead's lag behind the newest sample
  readonly acc = [0, 1, 2].map(() => new Ring(MOTION_HZ * 21))
  readonly gyro = [0, 1, 2].map(() => new Ring(MOTION_HZ * 21))
  readonly src = new Source<Msg>('/api/band', (m) => this.onMsg(m))

  get online() {
    return this.src.online
  }

  start() {
    this.src.start()
  }

  private onMsg(m: Msg): boolean {
    switch (m.t) {
      case 'data':
        m.acc.forEach((vals, a) => vals.forEach((v) => this.acc[a].push(num(v))))
        m.gyro.forEach((vals, a) => vals.forEach((v) => this.gyro[a].push(num(v))))
        return false
      case 'stats':
        this.stats = m
        this.statsSeq++
        return true
      case 'state':
        this.state = m
        return true
      case 'event':
        this.state = appendEvent(this.state, m.ts, m.text)
        return true
    }
  }
}

export const band = new BandLive()

export function useBand(): BandLive {
  useSyncExternalStore(band.src.subscribe, band.src.version)
  return band
}

export const bandApi = (path: string, body?: unknown) => post('/api/band', `/${path}`, body)
