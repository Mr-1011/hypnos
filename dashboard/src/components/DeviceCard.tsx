import { useState } from 'react'
import { LINK_LABEL, type LinkState } from '../lib/sse'
import type { Tone } from './Panel'

interface Props {
  title: string
  online: boolean
  st: LinkState | null
  facts: { label: string; value: string; tone?: Tone }[]
  api: (path: string, body?: unknown) => Promise<unknown>
  recording?: boolean // switching off then asks first: a device switched off stays off for the night
  detail?: boolean // also the device's own name, as "Vexo-HACK-61": only the Debug tab needs it (the user's rule, 2026-11-14)
}

// One device: its link, its few health numbers, and a switch. On links the remembered device, or
// the first one a search finds; off unlinks and forgets it.
export function DeviceCard({ title, online, st, facts, api, recording, detail }: Props) {
  const [busy, setBusy] = useState(false)
  const [miss, setMiss] = useState('') // why the last switch-on found nothing
  const link = st?.link ?? 'idle'
  const on = link !== 'idle' || busy
  const searching = busy && link === 'idle'
  const name = st?.device?.name ?? st?.remembered?.name ?? null
  const trying = link === 'connecting' || link === 'reconnecting'
  const look = !online ? 'offline' : searching ? 'connecting' : link
  const label = !online ? 'Offline' : searching ? 'Searching' : link === 'idle' ? 'Off' : LINK_LABEL[link]

  const toggle = async () => {
    if (on && recording && !window.confirm(`Switch the ${title} off mid-night?`)) return
    const wasOn = on
    setBusy(true)
    setMiss('')
    try {
      const r = (await api(wasOn ? 'disconnect' : 'autoconnect')) as { ok?: unknown; err?: unknown } | null
      if (!wasOn && !(r && (r.ok === 1 || r.ok === true))) setMiss(String(r?.err ?? 'failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={`card ${look}`}>
      <header>
        <div className="card-id">
          <div className="card-title">{title}</div>
          {detail ? <div className="card-name">{online ? (name ?? '-') : 'Program not running'}</div> : null}
        </div>
        {/* the switch says on and off; the pill is for what it cannot say: a search, a link that is coming or lost, a program that is down */}
        {look === 'streaming' || look === 'idle' ? null : (
          <span className={`pill ${look}`}>
            <i />
            {label}
          </span>
        )}
        <button role="switch" aria-checked={on} aria-label={title} className={`switch ${on ? 'on' : ''}`} onClick={toggle} disabled={!online || busy} />
      </header>
      <dl className="facts">
        {facts.map((f) => (
          <div key={f.label} className={f.tone ?? ''}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      {miss ? <div className="card-err">{miss}</div> : trying && st?.last_error ? <div className="card-err">{st.last_error}</div> : null}
    </section>
  )
}
