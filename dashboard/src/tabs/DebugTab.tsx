import { useMemo, useState } from 'react'
import { useBand } from '../lib/band'
import { useMuse } from '../lib/muse'
import { usePolar } from '../lib/polar'
import type { LinkState } from '../lib/sse'
import { Panel, Seg, hms } from '../components/Panel'
import { BandTab } from './BandTab'
import { MuseTab } from './MuseTab'
import { PolarTab } from './PolarTab'

type Prog = 'band' | 'muse' | 'polar'
const NAME: Record<Prog, string> = { band: 'Band', muse: 'Muse', polar: 'Polar' }

// Everything that is about one device and not about the person, as one long page with no tabs in
// it (the user's rule, 2026-11-14): the programs' health, then each device's own numbers and charts.
export function DebugTab() {
  return (
    <main>
      <Programs />
      <h2 className="part">Band</h2>
      <BandTab />
      <h2 className="part">Muse</h2>
      <MuseTab />
      <h2 className="part">Polar</h2>
      <PolarTab />
    </main>
  )
}

// Every number that says why something is not working: each program's link history and the three
// event logs in one timeline.
function Programs() {
  const bd = useBand()
  const mu = useMuse()
  const po = usePolar()
  const [filter, setFilter] = useState<'all' | Prog>('all')
  const [copied, setCopied] = useState('')

  const progs: { key: Prog; online: boolean; st: (LinkState & { rec?: { on: boolean; dir?: string } }) | null }[] = [
    { key: 'band', online: bd.online, st: bd.state },
    { key: 'muse', online: mu.online, st: mu.state },
    { key: 'polar', online: po.online, st: po.state },
  ]
  const museLoss = ['TP9', 'AF7', 'AF8', 'TP10'].map((k) => mu.stats?.streams[k]?.loss).filter((v): v is number => typeof v === 'number')

  const rows: [string, (k: Prog) => string][] = [
    ['program', (k) => (progs.find((p) => p.key === k)!.online ? 'running' : 'offline')],
    ['link', (k) => st(k)?.link ?? '-'],
    ['device', (k) => st(k)?.device?.name ?? '-'],
    ['address', (k) => st(k)?.device?.address ?? st(k)?.remembered?.address ?? '-'],
    ['remembered', (k) => st(k)?.remembered?.name ?? st(k)?.remembered?.address ?? 'none'],
    ['connects', (k) => String(st(k)?.connects ?? '-')],
    ['drops', (k) => String(st(k)?.drops ?? '-')],
    ['down', (k) => (st(k) ? `${st(k)!.down_s} s` : '-')],
    ['failed attempts', (k) => String(st(k)?.attempts ?? '-')],
    ['last error', (k) => st(k)?.last_error ?? '-'],
    ['uptime', (k) => (st(k) ? hms(st(k)!.uptime_s * 1000) : '-')],
    ['recording', (k) => (st(k)?.rec?.on ? st(k)!.rec!.dir ?? 'yes' : 'no')],
  ]
  function st(k: Prog) {
    return progs.find((p) => p.key === k)!.st
  }
  const extra: [string, string][] = [
    ['Band firmware', bd.state?.firmware ?? '-'],
    ['Band motion rate, lost', bd.stats ? `${bd.stats.hz.toFixed(1)} Hz, ${bd.stats.lost}` : '-'],
    ['Muse worst EEG loss', museLoss.length ? `${Math.max(...museLoss).toFixed(1)} %` : '-'],
    ['Polar ECG rate', po.stats ? `${po.stats.ecg_hz.toFixed(1)} Hz` : '-'],
    ['Polar ECG gaps, lost', po.stats ? `${po.stats.counters.ecg_gaps}, ${po.stats.counters.ecg_lost}` : '-'],
  ]

  const events = useMemo(() => {
    const all: [number, Prog, string][] = []
    for (const p of progs) for (const [ts, text] of p.st?.events ?? []) all.push([ts, p.key, text])
    return all.filter((e) => filter === 'all' || e[1] === filter).sort((a, b) => b[0] - a[0])
  }, [bd.state?.events, mu.state?.events, po.state?.events, filter])

  const copy = async () => {
    const report = {
      at: new Date().toISOString(),
      page: location.href,
      band: { online: bd.online, state: bd.state, stats: bd.stats },
      muse: { online: mu.online, state: mu.state, stats: mu.stats },
      polar: { online: po.online, state: po.state, stats: po.stats },
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 1))
      setCopied('Copied')
    } catch {
      setCopied('Clipboard blocked')
    }
    window.setTimeout(() => setCopied(''), 2000)
  }

  return (
    <div className="grid">
      <Panel
        title="Programs"
        className="span12"
        tools={
          <>
            {copied ? <span className="ok">{copied}</span> : null}
            <button onClick={copy}>Copy report</button>
          </>
        }
      >
        <table className="debug">
          <thead>
            <tr>
              <th />
              {progs.map((p) => (
                <th key={p.key}>{NAME[p.key]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, get]) => (
              <tr key={label}>
                <td>{label}</td>
                {progs.map((p) => (
                  <td key={p.key} className={label === 'last error' && st(p.key)?.last_error ? 'warn' : label === 'program' && !p.online ? 'bad' : ''}>
                    {get(p.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <table className="kv">
          <tbody>
            {extra.map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Events" className="span12" tools={<Seg value={filter} options={['all', 'band', 'muse', 'polar']} onChange={setFilter} labels={{ all: 'All', ...NAME }} />}>
        <div className="log">
          {events.map(([ts, k, text], i) => (
            <div key={`${ts}-${i}`}>
              <time>{new Date(ts).toLocaleTimeString([], { hour12: false })}</time>
              <b className={k}>{NAME[k]}</b>
              <span>{text}</span>
            </div>
          ))}
          {events.length ? null : <div className="none">No events</div>}
        </div>
      </Panel>
    </div>
  )
}
