import { useEffect, useMemo, useRef } from 'react'
import { useAgent, type Who } from '../lib/agent'
import { useBand } from '../lib/band'

// What the band's microphone hears, as text, and what the agent answers: the lower part of the
// Memory card, so the words and the notes they touch are seen together. There is no switch here:
// the agent listens when the band is linked (agent/voice.py, watch()), and the band's own switch
// is on its card. The sound goes to Deepgram, so the line that says so is on the page the whole
// time, also before the band is linked.
export function Transcript() {
  const bd = useBand()
  const ag = useAgent()
  const box = useRef<HTMLDivElement>(null)
  const mic = bd.state?.mic
  const on = !!mic?.on // the band program's own transcript, POST /api/mic: no switch on the page
  const talking = !!ag.state?.on
  const partial = ag.partial || bd.partial
  const err = ag.state?.err || mic?.err

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
      <div className="talk-head">
        <p className={`mic-note ${on || talking ? 'on' : ''}`}>
          {talking
            ? "The agent is on, and so is the band's microphone. Everything it hears goes over the internet to Deepgram (deepgram.com), and what is said goes as text to Google. Tell the people near the band."
            : on
              ? "The band's microphone is on. Everything it hears goes over the internet to Deepgram (deepgram.com). The text is kept on this Mac as the agent's memory of the day, and goes to Google when the agent talks. Tell the people near the band."
              : "The agent listens when the band is linked. Everything the band's microphone hears then goes over the internet to Deepgram (deepgram.com), and what is said goes as text to Google. Tell the people near the band first."}
        </p>
      </div>
      {err ? <p className="mic-note bad">{err}</p> : null}
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
        {lines.length || partial ? null : <div className="none">{on || talking ? 'Listening' : 'Nothing said yet'}</div>}
      </div>
    </section>
  )
}
