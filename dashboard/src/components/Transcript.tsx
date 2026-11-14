import { useEffect, useMemo, useRef } from 'react'
import { useAgent, type Who } from '../lib/agent'
import { useBand } from '../lib/band'

// What the band's microphone hears, as text, and what the agent answers: the lower part of the
// Memory card, so the words and the notes they touch are seen together. Only the words: no
// switch, no note and no error line (the user's rule, 2026-11-14). The agent listens when the band
// is linked (agent/voice.py, watch()), and what went wrong is in the agent's state and its log.
export function Transcript() {
  const bd = useBand()
  const ag = useAgent()
  const box = useRef<HTMLDivElement>(null)
  const partial = ag.partial || bd.partial

  // the microphone's own lines and the two sides of the talk, in the order they were said
  const lines = useMemo(
    () => [...(bd.state?.lines ?? []).map(([ts, text]) => [ts, 'you', text] as [number, Who, string]), ...(ag.state?.lines ?? [])].sort((a, b) => a[0] - b[0]),
    [bd.state?.lines, ag.state?.lines],
  )

  useEffect(() => {
    box.current?.scrollTo(0, box.current.scrollHeight) // the newest line stays in view
  }, [lines.length, partial])

  return (
    <section className="talk" aria-label="Transcript">
      <div className="log said" ref={box}>
        {lines.map(([ts, who, text], i) => (
          <div key={`${ts}-${i}`}>
            <time>{new Date(ts).toLocaleTimeString([], { hour12: false })}</time>
            <b className={who}>{who}</b>
            <span>{text}</span>
          </div>
        ))}
        {partial ? (
          <div className="guess">
            <time>...</time>
            <b className="you">you</b>
            <span>{partial}</span>
          </div>
        ) : null}
      </div>
    </section>
  )
}
