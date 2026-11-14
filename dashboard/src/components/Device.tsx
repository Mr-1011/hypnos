import { useEffect, useRef, useState } from 'react'
import type { State } from '../lib/muse'

// The band's own replies to "v1" and "s", without what the top bar already shows (name,
// battery) and without the protocol noise (reply codes, ids).
function rows(state: State): [string, string][] {
  const info = state.info
  const out: [string, string][] = []
  if (state.tele) out.push(['voltage', `${state.tele.fuel_mv} mV`])
  // the band reports the preset as the decimal of its hex code: 80 is p50
  if (info.ps !== undefined) out.push(['preset', `p${Number(info.ps).toString(16)}`])
  if (info.fw) out.push(['firmware', `${info.fw}${info.bn ? ` build ${info.bn}` : ''}`])
  if (info.hw) out.push(['hardware', `${info.hw}${info.sp ? ` ${info.sp}` : ''}`])
  if (info.bl) out.push(['bootloader', String(info.bl)])
  if (info.sn) out.push(['serial', String(info.sn)])
  if (info.ma) out.push(['mac', String(info.ma)])
  out.push(['drops', state.drops ? `${state.drops}, ${state.down_s} s down` : '0'])
  return out
}

export function DeviceInfo({ state }: { state: State | null }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  if (!state?.device) return null
  return (
    <div className="info" ref={box}>
      <button className={`info-btn ${open ? 'on' : ''}`} aria-label="Device info" onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <circle cx="8" cy="8" r="6.75" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="8" cy="5" r="0.95" fill="currentColor" />
          <rect x="7.3" y="7" width="1.4" height="4.6" rx="0.5" fill="currentColor" />
        </svg>
      </button>
      {open ? (
        <dl className="info-pop">
          {rows(state).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}
