import { useSyncExternalStore } from 'react'
import { Ring } from './ring'
import { eegChain } from './filter'
import { Source, appendEvent, post, type LinkState } from './sse'

export const EEG_NAMES = ['TP9', 'AF7', 'AF8', 'TP10', 'AUX']
export const EEG_HZ = 256
export const IMU_HZ = 52
export const PPG_HZ = 64

export interface State extends LinkState {
  preset: string
  presets: string[]
  info: Record<string, string | number>
  tele: { batt: number; fuel_mv: number; adc: number; temp: number } | null
  rec: { on: boolean; dir?: string; label?: string; since?: number }
}

export interface StreamStat {
  pps: number
  sps: number
  loss: number | null
  lost: number
  pkts: number
  age: number | null
}

export interface EegStat {
  dc: number
  ac: number
  rails: number
  q: 1 | 2 | 3
}

export interface Stats {
  streams: Record<string, StreamStat>
  eeg: (EegStat | null)[]
  bands: (number[] | null)[]
  emg: (number | null)[]
  spec: (number[] | null)[]
  hr: { bpm: number | null; ppg1: number | null; ppg2: number | null }
  motion: { g: number[]; move: number } | null
  rec_bytes: number | null
}

type Col = (number | null)[]
type Msg =
  | ({ t: 'state' } & State)
  | ({ t: 'stats' } & Stats)
  | { t: 'event'; ts: number; text: string }
  | { t: 'data'; eeg: Col[]; acc: Col[]; gyro: Col[]; ppg: Col[] }

const num = (v: number | null) => (v === null ? NaN : v)

// element by element over the four electrodes that sent one (AUX is not an electrode)
function mean4(cols: (number[] | null)[]): number[] | null {
  const ok = cols.slice(0, 4).filter((c): c is number[] => !!c)
  return ok.length ? ok[0].map((_, i) => ok.reduce((s, c) => s + c[i], 0) / ok.length) : null
}

class MuseLive {
  state: State | null = null
  stats: Stats | null = null
  statsSeq = 0
  bandMean: number[] | null = null // percent per band
  specMean: number[] | null = null // dB per 1 Hz bin
  // the Live tab's 20 s view, plus the playhead's lag behind the newest sample
  readonly eegRaw = EEG_NAMES.map(() => new Ring(EEG_HZ * 21))
  readonly eegFilt = EEG_NAMES.map(() => new Ring(EEG_HZ * 21))
  readonly af8tp10 = new Ring(EEG_HZ * 21) // the derivation the sleep staging uses, filtered
  readonly acc = [0, 1, 2].map(() => new Ring(IMU_HZ * 15))
  readonly gyro = [0, 1, 2].map(() => new Ring(IMU_HZ * 15))
  readonly ppg = [0, 1, 2].map(() => new Ring(PPG_HZ * 15))
  private chains = EEG_NAMES.map(() => eegChain(EEG_HZ))
  readonly src = new Source<Msg>('/api/muse', (m) => this.onMsg(m))

  get online() {
    return this.src.online
  }

  start() {
    this.src.start()
  }

  private onMsg(m: Msg): boolean {
    switch (m.t) {
      case 'data': {
        m.eeg.forEach((vals, c) => {
          for (const v of vals) {
            const x = num(v)
            this.eegRaw[c].push(x)
            this.eegFilt[c].push(this.chains[c].step(x))
          }
        })
        // both rings are addressed by sample number, so the pair lines up even when one channel's
        // packet arrived in a later message
        const af8 = this.eegFilt[2]
        const tp10 = this.eegFilt[3]
        for (let i = this.af8tp10.count; i < Math.min(af8.count, tp10.count); i++) this.af8tp10.push(af8.at(i) - tp10.at(i))
        m.acc.forEach((vals, a) => vals.forEach((v) => this.acc[a].push(num(v))))
        m.gyro.forEach((vals, a) => vals.forEach((v) => this.gyro[a].push(num(v))))
        m.ppg.forEach((vals, c) => vals.forEach((v) => this.ppg[c].push(num(v))))
        return false
      }
      case 'stats':
        this.stats = m
        this.bandMean = mean4(m.bands)?.map((v) => v * 100) ?? null
        this.specMean = mean4(m.spec)
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

export const muse = new MuseLive()

export function useMuse(): MuseLive {
  useSyncExternalStore(muse.src.subscribe, muse.src.version)
  return muse
}

export const museApi = (path: string, body?: unknown) => post('/api/muse', `/${path}`, body)
