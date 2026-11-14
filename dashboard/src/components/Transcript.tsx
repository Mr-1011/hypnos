import { useEffect, useRef, useState } from 'react'
import { bandApi, useBand } from '../lib/band'
import { Panel } from './Panel'

// What the band's microphone hears, as text. The switch sends the sound to Deepgram, so the line
// that says so stays on the page the whole time it is on.
export function Transcript({ className = '' }: { className?: string }) {
  const bd = useBand()
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const mic = bd.state?.mic
  const on = !!mic?.on
  const lines = bd.state?.lines ?? []
  const linked = bd.state?.link === 'streaming'

  useEffect(() => {
    box.current?.scrollTo(0, box.current.scrollHeight) // the newest line stays in view
  }, [lines.length, bd.partial])

  const toggle = async () => {
    setBusy(true)
    await bandApi('mic', { on: !on })
    setBusy(false)
  }

  return (
    <Panel
      title="Transcript"
      className={className}
      tools={
        <>
          <span className="hr">Microphone</span>
          {/* off always works; on needs the band, or nothing would be heard */}
          <button role="switch" aria-checked={on} aria-label="Microphone" className={`switch ${on ? 'on' : ''}`} onClick={toggle} disabled={!bd.online || busy || (!on && !linked)} />
        </>
      }
    >
      <p className={`mic-note ${on ? 'on' : ''}`}>
        {on
          ? "The band's microphone is on. Everything it hears goes over the internet to Deepgram (deepgram.com). Tell the people near the band."
          : `The microphone is off.${linked ? '' : ' Link the band to switch it on.'} When it is on, everything it hears goes over the internet to Deepgram, a company: tell the people near the band first.`}
      </p>
      {mic?.err ? <p className="mic-note bad">{mic.err}</p> : null}
      <div className="log said" ref={box}>
        {lines.map(([ts, text], i) => (
          <div key={`${ts}-${i}`}>
            <time>{new Date(ts).toLocaleTimeString([], { hour12: false })}</time>
            <span>{text}</span>
          </div>
        ))}
        {bd.partial ? (
          <div className="guess">
            <time>...</time>
            <span>{bd.partial}</span>
          </div>
        ) : null}
        {lines.length || bd.partial ? null : <div className="none">{on ? 'Listening' : 'Nothing said yet'}</div>}
      </div>
    </Panel>
  )
}
