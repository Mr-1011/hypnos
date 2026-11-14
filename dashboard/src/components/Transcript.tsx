import { useEffect, useMemo, useRef, useState } from 'react'
import { agentApi, useAgent, type Who } from '../lib/agent'
import { bandApi, useBand } from '../lib/band'
import { Panel } from './Panel'

// What the band's microphone hears, as text, and what the agent answers. Either switch sends the
// sound to Deepgram, so the line that says so stays on the page the whole time one is on.
export function Transcript({ className = '' }: { className?: string }) {
  const bd = useBand()
  const ag = useAgent()
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState('') // why the last switch-on did nothing; gone with the next try
  const box = useRef<HTMLDivElement>(null)
  const mic = bd.state?.mic
  const on = !!mic?.on
  const talking = !!ag.state?.on
  const linked = bd.state?.link === 'streaming'
  const partial = ag.partial || bd.partial
  const err = refused || ag.state?.err || mic?.err

  // the microphone's own lines and the two sides of the talk, in the order they were said
  const lines = useMemo(
    () => [...(bd.state?.lines ?? []).map(([ts, text]) => [ts, 'you', text] as [number, Who, string]), ...(ag.state?.lines ?? [])].sort((a, b) => a[0] - b[0]),
    [bd.state?.lines, ag.state?.lines],
  )

  useEffect(() => {
    box.current?.scrollTo(0, box.current.scrollHeight) // the newest line stays in view
  }, [lines.length, partial])

  const flip = async (send: Promise<{ ok?: boolean; err?: string }>) => {
    setBusy(true)
    const r = await send
    setRefused(r.ok ? '' : (r.err ?? ''))
    setBusy(false)
  }

  return (
    <Panel
      title="Transcript"
      className={className}
      tools={
        <>
          {/* off always works; on needs the band, or nothing would be heard. One listener at a time:
              both at once would send the sound to Deepgram twice and show every sentence twice. */}
          <span className="hr">Agent</span>
          <button role="switch" aria-checked={talking} aria-label="Agent" className={`switch ${talking ? 'on' : ''}`} onClick={() => flip(agentApi('talk', { on: !talking }))} disabled={!ag.online || busy || (!talking && (!linked || on))} />
          <span className="hr">Microphone</span>
          <button role="switch" aria-checked={on} aria-label="Microphone" className={`switch ${on ? 'on' : ''}`} onClick={() => flip(bandApi('mic', { on: !on }))} disabled={!bd.online || busy || (!on && (!linked || talking))} />
        </>
      }
    >
      <p className={`mic-note ${on || talking ? 'on' : ''}`}>
        {talking
          ? "The agent is on, and so is the band's microphone. Everything it hears goes over the internet to Deepgram (deepgram.com), and what is said goes as text to Google. Tell the people near the band."
          : on
            ? "The band's microphone is on. Everything it hears goes over the internet to Deepgram (deepgram.com). Tell the people near the band."
            : `The microphone is off.${linked ? '' : ' Link the band to switch it on.'} When it is on, everything it hears goes over the internet to Deepgram, a company, and with the agent the text goes to Google too: tell the people near the band first.`}
      </p>
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
    </Panel>
  )
}
