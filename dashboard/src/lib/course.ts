import { agent } from './agent'
import { band } from './band'
import { muse } from './muse'
import { polar } from './polar'

// What the Sleep graph of the Live tab draws: every 2 s the stage of sleep and the slow numbers
// of every device, from the moment the page opened.
// shortcut: the page holds this history, so a reload starts the graph again. When a night has to
// survive the tab, agent/voice.py keeps it (sleep.Night already holds every stage) and serves it.

export interface Sample {
  t: number // utc ms
  stage: string | null // agent/sleep.py: awake, drowsy, light, deep, rem
  hr: number | null // bpm: the chest strap, else the Muse's PPG
  wrist: number | null // mg
  head: number | null // mg
  bands: number[] | null // percent: delta, theta, alpha, beta, gamma
}

const STEP_MS = 2000
const MAX = (12 * 3600_000) / STEP_MS // 12 h; older samples go

// a program that is down keeps its last numbers in its store: they are not now
const sample = (): Sample => ({
  t: Date.now(),
  stage: (agent.online && agent.state?.sleep?.stage) || null,
  hr: (polar.online && polar.stats?.bpm) || (muse.online && muse.stats?.hr.bpm) || null,
  wrist: (band.online ? band.stats?.move : null) ?? null,
  head: (muse.online ? muse.stats?.motion?.move : null) ?? null,
  bands: muse.online ? muse.bandMean : null,
})

class Course {
  readonly samples: Sample[] = []
  private subs = new Set<() => void>()
  private started = false

  start() {
    if (this.started) return
    this.started = true
    window.setInterval(() => {
      this.samples.push(sample())
      if (this.samples.length > MAX) this.samples.splice(0, this.samples.length - MAX)
      this.subs.forEach((f) => f())
    }, STEP_MS)
  }

  subscribe = (fn: () => void) => {
    this.subs.add(fn)
    return () => {
      this.subs.delete(fn)
    }
  }
}

export const course = new Course()
