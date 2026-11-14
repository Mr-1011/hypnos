import { agent } from './agent'
import { band } from './band'
import { muse } from './muse'

// What the Sleep State graph of the Live tab draws: every 2 s how much the body moves, how fast the
// brain runs and how much is said, each from 0 to 1, from the moment the page opened.
// shortcut: the page holds this history, so a reload starts the graph again. When a night has to
// survive the tab, agent/voice.py keeps it (it already follows every sensor) and serves it.

export interface Sample {
  t: number // utc ms
  move: number | null // the larger of wrist and head movement, on a log scale
  brain: number | null // the share of alpha and beta in the EEG, the fast rhythms of a waking brain
  talk: number // the words of the last half minute, the person's and the agent's
}

export const STEP_MS = 2000
const MAX = (12 * 3600_000) / STEP_MS // 12 h; older samples go
const STILL_MG = 2 // a wrist at rest reads 1 to 5 mg (the spread of |a| over 2 s): 0 on the graph
const WALK_MG = 200 // and a walking one some hundred: 1 on the graph
const TALK_MS = 30_000
const TALK_WORDS = 60 // a steady talk is about 120 words a minute: 1 on the graph

const words = (text: string) => text.split(/\s+/).filter(Boolean).length

// 0 at STILL_MG, 1 at WALK_MG, a log scale between: a turn in bed and a walk both show
export function moveLevel(mg: number): number {
  return Math.min(1, Math.max(0, Math.log(mg / STILL_MG) / Math.log(WALK_MG / STILL_MG)))
}

// a program that is down keeps its last numbers in its store: they are not now
function sample(): Sample {
  const now = Date.now()
  const moves = [band.online ? band.stats?.move : null, muse.online ? muse.stats?.motion?.move : null].filter((v): v is number => typeof v === 'number')
  const b = muse.online ? muse.bandMean : null // percent: delta, theta, alpha, beta, gamma
  // the microphone's own lines, or both sides of the talk with the agent: only one of the two listens
  const said = [...(band.online ? (band.state?.lines ?? []).map(([ts, text]) => [ts, text] as const) : []), ...(agent.online ? (agent.state?.lines ?? []).map(([ts, , text]) => [ts, text] as const) : [])]
  const spoken = said.filter(([ts]) => now - ts < TALK_MS).reduce((n, [, text]) => n + words(text), 0) + words(agent.partial || band.partial)
  return {
    t: now,
    move: moves.length ? moveLevel(Math.max(...moves)) : null,
    brain: b ? Math.min(1, (b[2] + b[3]) / 100) : null,
    talk: Math.min(1, spoken / TALK_WORDS),
  }
}

// the graph reads the samples in its own animation frames, as the traces read their rings
class Course {
  readonly samples: Sample[] = []
  private started = false

  start() {
    if (this.started) return
    this.started = true
    window.setInterval(() => {
      this.samples.push(sample())
      if (this.samples.length > MAX) this.samples.splice(0, this.samples.length - MAX)
    }, STEP_MS)
  }
}

export const course = new Course()
