import { useEffect, useState } from 'react'
import { PROGS, startNight, stopNight, type Prog } from '../lib/night'
import { useBand } from '../lib/band'
import { useMuse } from '../lib/muse'
import { usePolar } from '../lib/polar'
import { hms } from './Panel'

const NAMES: Record<Prog, string> = { band: 'Band', muse: 'Muse', polar: 'Polar' }

function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!on) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [on])
  return now
}

// The header: one Start/Stop for the three programs, and a clock while they record. What each
// device does is on its card; here a program only shows up when Start or Stop failed for it.
export function NightBar() {
  const bd = useBand()
  const mu = useMuse()
  const po = usePolar()
  const [busy, setBusy] = useState('')
  const [errors, setErrors] = useState<Partial<Record<Prog, string>>>({})

  const st = { band: bd.state, muse: mu.state, polar: po.state }
  const online: Record<Prog, boolean> = { band: bd.online, muse: mu.online, polar: po.online }
  const recording = (p: Prog) => !!st[p]?.rec.on
  const linked = (p: Prog) => st[p]?.link === 'streaming'
  // the night is what any program records: its label, and the earliest start
  const recs = PROGS.filter(recording)
  const night = recs.length > 0
  const label = night ? st[recs[0]]!.rec.label : undefined
  const since = Math.min(...recs.map((p) => st[p]!.rec.since ?? Infinity))
  const now = useNow(night)
  // a device switched off on its card sits the night out
  const switchedOn = PROGS.filter((p) => online[p] && st[p] && st[p]!.link !== 'idle')
  // not while Start is still starting them one by one
  const missing = night && busy !== 'start' ? PROGS.filter((p) => online[p] && linked(p) && !recording(p)) : []

  const run = async (what: string, fn: () => Promise<Partial<Record<Prog, string>>>) => {
    setBusy(what)
    try {
      setErrors(await fn())
    } finally {
      setBusy('')
    }
  }

  return (
    <header className="top">
      <div className="brand">
        <svg className="mark" viewBox="0 0 24 24" width={22} height={22} aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="#e0b64d" />
        </svg>
        <h1>Hypnos</h1>
        {night ? (
          <span className="night on">
            <i />
            <b>{Number.isFinite(since) ? hms(now - since) : ''}</b>
          </span>
        ) : null}
      </div>
      <div className="controls">
        {PROGS.filter((p) => errors[p]).map((p) => (
          <span key={p} className="card-err">
            {NAMES[p]}: {errors[p]}
          </span>
        ))}
        {missing.length ? (
          <button className="rec" disabled={!!busy} onClick={() => run('add', () => startNight(missing, label))}>
            <i />
            {busy === 'add' ? 'Adding' : `Add ${missing.map((p) => NAMES[p]).join(', ')}`}
          </button>
        ) : null}
        {night ? (
          <button className="rec on" disabled={!!busy} onClick={() => window.confirm('Stop the night?') && run('stop', stopNight)}>
            <i />
            Stop night
          </button>
        ) : (
          <button className="rec" disabled={!!busy || !switchedOn.length} onClick={() => run('start', () => startNight(switchedOn))}>
            <i />
            {busy === 'start' ? 'Starting' : 'Start night'}
          </button>
        )}
      </div>
    </header>
  )
}
