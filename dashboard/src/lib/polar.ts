import { useSyncExternalStore } from 'react'
import { Ring } from './ring'
import { Source, appendEvent, post, type LinkState } from './sse'

export const ECG_HZ = 130

export interface Counters {
  hr_packets: number
  rr_beats: number
  ecg_frames: number
  ecg_samples: number
  ecg_gaps: number
  ecg_lost: number
}

export interface PolarState extends LinkState {
  battery: number | null
  rec: { on: boolean; dir?: string; label?: string; since?: number }
  counters: Counters
}

export interface PolarStats {
  bpm: number | null
  rr: number | null
  battery: number | null
  ecg_hz: number
  counters: Counters
}

type Msg =
  | ({ t: 'state' } & PolarState)
  | ({ t: 'stats' } & PolarStats)
  | { t: 'data'; ecg: number[]; hr: [number, number][]; rr: [number, number][] }
  | { t: 'event'; ts: number; text: string }

class PolarLive {
  state: PolarState | null = null
  stats: PolarStats | null = null
  statsSeq = 0
  readonly ecg = new Ring(ECG_HZ * 21) // the Live tab's 20 s view, plus the playhead's lag
  readonly rr = new Ring(600) // one value per beat: the tachogram
  readonly src = new Source<Msg>('/api/polar', (m) => this.onMsg(m))

  get online() {
    return this.src.online
  }

  start() {
    this.src.start()
  }

  private onMsg(m: Msg): boolean {
    switch (m.t) {
      case 'data':
        for (const v of m.ecg) this.ecg.push(v)
        for (const [, ms] of m.rr) this.rr.push(ms)
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

export const polar = new PolarLive()

export function usePolar(): PolarLive {
  useSyncExternalStore(polar.src.subscribe, polar.src.version)
  return polar
}

export const polarApi = (path: string, body?: unknown) => post('/api/polar', `/${path}`, body)
