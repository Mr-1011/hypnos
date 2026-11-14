import { useAgent, type Who } from '../lib/agent'
import { useBand } from '../lib/band'

// The words under the Memory picture: one line, never more (the user's rule, 2026-11-14). It is
// what the person says, while they say it, or else the last thing that was said, by the person or
// by the agent. No switch, no note and no error line: the agent listens when the band is linked
// (agent/voice.py, watch()), and what went wrong is in the agent's state and its log.
export function Transcript() {
  const bd = useBand()
  const ag = useAgent()
  const partial = ag.partial || bd.partial
  // the microphone's own lines and the two sides of the talk: the newest of them
  const last = [...(bd.state?.lines ?? []).map(([ts, text]) => [ts, 'you', text] as [number, Who, string]), ...(ag.state?.lines ?? [])].sort((a, b) => a[0] - b[0]).pop()
  const who = partial ? 'you' : last?.[1]

  return (
    <section className="talk" aria-label="Transcript" aria-live="polite">
      {who ? <b className={who}>{who}</b> : null}
      <span className={partial ? 'guess' : ''}>{partial || last?.[2]}</span>
    </section>
  )
}
