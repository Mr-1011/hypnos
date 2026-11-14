import { useSyncExternalStore } from 'react'
import { Source, post } from './sse'

// agent/voice.py, the voice loop. Its lines are both sides of the talk.
export type Who = 'you' | 'agent'

// agent/brain.py graph(): the notes and the days as a graph
export interface BrainNode {
  id: string
  label: string
  kind: 'person' | 'head' | 'line' | 'day'
}

export interface AgentState {
  on: boolean
  err: string | null // what went wrong in the loop, in the service's own words
  lines: [number, Who, string][] // [utc ms, who, what was said]
  brain: { nodes: BrainNode[]; links: [string, string][] }
  // agent/brain.py sense(): what the decisions model made of the last moment. about: ids of the
  // notes the person's words touch; worried: 0 to 1
  sense: { about: string[]; worried: number } | null
  // agent/sleep.py Night.now(): the stage of the last half minute (awake, drowsy, light, deep, rem),
  // the cycle (0 before sleep), minutes since sleep began, and whether the Muse's EEG was in it
  sleep: { stage: string | null; cycle: number; asleep_min: number | null; eeg: boolean }
}

type Msg = ({ t: 'state' } & AgentState) | { t: 'text'; ts: number; who: Who; text: string; final: 0 | 1 }

class AgentLive {
  state: AgentState | null = null
  partial = '' // the person's sentence so far; it may still change
  readonly src = new Source<Msg>('/api/agent', (m) => this.onMsg(m))

  get online() {
    return this.src.online
  }

  start() {
    this.src.start()
  }

  private onMsg(m: Msg): boolean {
    if (m.t === 'state') {
      this.state = m
      if (!m.on) this.partial = ''
    } else {
      this.partial = m.final ? '' : m.text
      if (m.final && this.state) this.state = { ...this.state, lines: [...this.state.lines, [m.ts, m.who, m.text] as [number, Who, string]].slice(-50) }
    }
    return true
  }
}

export const agent = new AgentLive()

export function useAgent(): AgentLive {
  useSyncExternalStore(agent.src.subscribe, agent.src.version)
  return agent
}

export const agentApi = (path: string, body?: unknown) => post('/api/agent', `/${path}`, body)
