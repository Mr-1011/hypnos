import { useEffect, useState } from 'react'
import { DeviceCard } from './components/DeviceCard'
import { type Tone } from './components/Panel'
import { agent } from './lib/agent'
import { band, bandApi, useBand } from './lib/band'
import { course } from './lib/course'
import { muse, museApi, useMuse } from './lib/muse'
import { polar, polarApi, usePolar } from './lib/polar'
import { LiveTab } from './tabs/LiveTab'
import { FocusTab } from './tabs/FocusTab'
import { DebugTab } from './tabs/DebugTab'

const TABS = ['Live', 'Focus', 'Debug'] as const
type Tab = (typeof TABS)[number]

function savedTab(): Tab {
  try {
    const t = localStorage.getItem('hypnos.tab') as Tab | null
    return t && TABS.includes(t) ? t : 'Live'
  } catch {
    return 'Live'
  }
}

const tone = (bad: boolean, warn: boolean): Tone => (bad ? 'bad' : warn ? 'warn' : '')

function Cards() {
  const bd = useBand()
  const mu = useMuse()
  const po = usePolar()
  const bs = bd.stats
  const bandLive = bd.state?.link === 'streaming'
  const eeg = (mu.stats?.eeg ?? []).slice(0, 4)
  const seen = eeg.filter((e) => e).length // live_muse.py sends none for an electrode silent 3 s
  const good = eeg.filter((e) => e?.q === 1).length
  const losses = ['TP9', 'AF7', 'AF8', 'TP10'].map((k) => mu.stats?.streams[k]?.loss).filter((v): v is number => typeof v === 'number')
  const loss = losses.length ? Math.max(...losses) : null
  const pc = po.stats?.counters

  return (
    <div className="cards">
      <DeviceCard
        title="Vexo band"
        online={bd.online}
        st={bd.state}
        api={bandApi}
        recording={!!bd.state?.rec.on}
        facts={[
          { label: 'battery', value: bs?.battery == null ? '-' : `${bs.battery} %`, tone: tone((bs?.battery ?? 100) < 15, (bs?.battery ?? 100) < 30) },
          { label: 'signal', value: bs?.rssi == null ? '-' : `${bs.rssi} dBm`, tone: tone((bs?.rssi ?? 0) < -90, (bs?.rssi ?? 0) < -80) },
          { label: 'motion', value: bs && bandLive ? `${bs.hz.toFixed(0)} Hz` : '-', tone: tone(!!bs && bandLive && bs.hz < 40, false) },
          { label: 'drops', value: String(bd.state?.drops ?? '-') },
        ]}
      />
      <DeviceCard
        title="Muse S"
        online={mu.online}
        st={mu.state}
        api={museApi}
        recording={!!mu.state?.rec.on}
        facts={[
          { label: 'battery', value: mu.state?.tele ? `${mu.state.tele.batt.toFixed(0)} %` : '-', tone: tone((mu.state?.tele?.batt ?? 100) < 15, (mu.state?.tele?.batt ?? 100) < 30) },
          { label: 'contact', value: seen ? `${good}/4` : '-', tone: tone(seen > 0 && good < 2, seen > 0 && good < 4) },
          { label: 'loss', value: loss === null ? '-' : `${loss.toFixed(1)} %`, tone: tone((loss ?? 0) > 5, (loss ?? 0) > 1) },
          { label: 'drops', value: String(mu.state?.drops ?? '-') },
        ]}
      />
      <DeviceCard
        title="Polar H10"
        online={po.online}
        st={po.state}
        api={polarApi}
        recording={!!po.state?.rec.on}
        facts={[
          { label: 'battery', value: po.stats?.battery == null ? '-' : `${po.stats.battery} %`, tone: tone((po.stats?.battery ?? 100) < 15, (po.stats?.battery ?? 100) < 30) },
          { label: 'heart', value: po.stats?.bpm ? `${po.stats.bpm} bpm` : '-' },
          { label: 'ECG', value: po.stats ? `${po.stats.ecg_hz.toFixed(0)} Hz` : '-', tone: tone(!!po.stats && po.state?.link === 'streaming' && po.stats.ecg_hz < 100, false) },
          { label: 'gaps', value: pc ? String(pc.ecg_gaps) : '-', tone: tone(false, (pc?.ecg_gaps ?? 0) > 0) },
        ]}
      />
    </div>
  )
}

export default function App() {
  const [tab, setTab] = useState<Tab>(savedTab)
  useEffect(() => {
    band.start()
    muse.start()
    polar.start()
    agent.start()
    course.start()
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem('hypnos.tab', tab)
    } catch {
      /* a private window: the tab is simply not remembered */
    }
  }, [tab])

  return (
    <div className={tab === 'Debug' ? 'app' : 'app fit'}>
      <header className="top">
        <div className="brand">
          <img className="mark" src="/logo.svg" width={28} height={28} alt="" />
          <h1>Hypnos</h1>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
      </header>
      {tab === 'Focus' ? null : <Cards />}
      {tab === 'Live' ? <LiveTab /> : null}
      {tab === 'Focus' ? <FocusTab /> : null}
      {tab === 'Debug' ? <DebugTab /> : null}
    </div>
  )
}
