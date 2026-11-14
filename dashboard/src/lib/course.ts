import { agent } from './agent'
import { band } from './band'
import { muse } from './muse'
import { polar } from './polar'
import { simNight } from './sim'

// What the Sleep State graph of the Live tab draws: every 2 s how much the body moves and how loud
// it is, each from 0 to 1, the heart rate, the stage of sleep, and the spectrum of the EEG.
// shortcut: the page holds this history, so a reload starts the graph again. When a night has to
// survive the tab, agent/voice.py keeps it (it already follows every sensor) and serves it.
// shortcut: the first SIM_H hours are made up for the demo (sim.ts), and the graph's clock is moved
// so that the night began at 00:00. Set SIM_H to 0 when a real night is shown, and never present
// the made-up hours as measured.

export const STAGES = ['awake', 'drowsy', 'light', 'deep', 'rem'] as const // agent/sleep.py
export type Stage = (typeof STAGES)[number]

export interface Sample {
  t: number // utc ms
  move: number | null // the larger of wrist and head movement, on a log scale
  sound: number | null // how loud it is at the band's microphone, on its dB scale; null while it is off
  heart: number | null // beats a minute: the chest strap's, or else the Muse's
  stage: Stage | null // the agent's verdict (agent/sleep.py)
  // the EEG's power in each 1 Hz bin from 1 Hz to SPEC_HZ, from 0 (SPEC_DB[0]) to 255 (SPEC_DB[1])
  spec: Uint8ClampedArray | null
}

export const STEP_MS = 2000
const MAX = (12 * 3600_000) / STEP_MS // 12 h; older samples go
export const SPEC_HZ = 32 // as on Patch's spectrogram: sleep is under it, muscle over it
// dB of µV²/Hz. A guess from textbook EEG (deep sleep's slow waves near 25 dB, 30 Hz near -5 dB):
// set it again from a night on the Muse.
const SPEC_DB = [-10, 30]
const SIM_H = 4
const STILL_MG = 2 // a wrist at rest reads 1 to 5 mg (the spread of |a| over 2 s): 0 on the graph
const WALK_MG = 200 // and a walking one some hundred: 1 on the graph
// dB under full scale at the band's microphone, measured 2026-11-14: the pauses of the kit's reader
// are at -44, the hackathon's hall at -35 to -25 and a voice at -25 to -17
const QUIET_DB = -50 // 0 on the graph
const LOUD_DB = -10 // 1 on the graph

// 0 at STILL_MG, 1 at WALK_MG, a log scale between: a turn in bed and a walk both show
export function moveLevel(mg: number): number {
  return Math.min(1, Math.max(0, Math.log(mg / STILL_MG) / Math.log(WALK_MG / STILL_MG)))
}

// a program that is down keeps its last numbers in its store: they are not now
function sample(): Sample {
  const now = Date.now()
  const moves = [band.online ? band.stats?.move : null, muse.online ? muse.stats?.motion?.move : null].filter((v): v is number => typeof v === 'number')
  const spec = muse.online ? muse.specMean : null // dB in each 1 Hz bin from 0 Hz
  const stage = agent.online ? agent.state?.sleep?.stage : null
  const loud = band.online ? band.loud : null
  band.loud = null
  const beats = [polar.online ? polar.stats?.bpm : null, muse.online ? muse.stats?.hr?.bpm : null].find((v): v is number => typeof v === 'number')
  return {
    t: now,
    move: moves.length ? moveLevel(Math.max(...moves)) : null,
    sound: loud === null ? null : Math.min(1, Math.max(0, (loud - QUIET_DB) / (LOUD_DB - QUIET_DB))),
    heart: beats ?? null,
    stage: STAGES.find((s) => s === stage) ?? null,
    spec: spec ? Uint8ClampedArray.from({ length: SPEC_HZ }, (_, k) => (255 * (spec[k + 1] - SPEC_DB[0])) / (SPEC_DB[1] - SPEC_DB[0])) : null,
  }
}

// the graph reads the samples in its own animation frames, as the traces read their rings
class Course {
  readonly samples: Sample[] = []
  shift = 0 // ms to add to a sample's time for the graph's clock
  private started = false

  start() {
    if (this.started) return
    this.started = true
    if (SIM_H) {
      const from = Date.now() - SIM_H * 3600_000
      const day = new Date(from)
      this.shift = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime() - from // the night began at 00:00
      for (const s of simNight(from, (SIM_H * 3600_000) / STEP_MS, STEP_MS, SPEC_HZ)) this.samples.push(s)
    }
    window.setInterval(() => {
      this.samples.push(sample())
      if (this.samples.length > MAX) this.samples.splice(0, this.samples.length - MAX)
    }, STEP_MS)
  }
}

export const course = new Course()
