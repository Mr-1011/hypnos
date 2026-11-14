import { useMemo, useState } from 'react'
import { ECG_HZ, polar, usePolar } from '../lib/polar'
import { Traces, type Lane } from '../components/Traces'
import { History } from '../components/History'
import { Strip } from '../components/Strip'
import { Panel, Seg, Tiles, fmt } from '../components/Panel'
import { HIST_POINTS } from './MuseTab'

// The chest strap: ECG, heart rate, the beat-to-beat R-R and the link's counters.
export function PolarTab() {
  const po = usePolar()
  const s = po.stats
  const c = s?.counters ?? po.state?.counters
  const [seconds, setSeconds] = useState<'5' | '10'>('5')
  const ecgLanes: Lane[] = useMemo(() => [{ label: 'ECG', color: '#f0637e', ring: polar.ecg }], [])
  const hrSeries = useMemo(() => [{ label: 'bpm', color: '#f0637e' }], [])

  return (
    <main className="grid">
      <div className="span12">
        <Tiles
          items={[
            { label: 'heart rate', value: fmt(s?.bpm), unit: 'bpm' },
            { label: 'R-R', value: fmt(s?.rr), unit: 'ms' },
            { label: 'battery', value: fmt(s?.battery ?? po.state?.battery), unit: '%', tone: (s?.battery ?? 100) < 15 ? 'bad' : '' },
            { label: 'ECG rate', value: fmt(s?.ecg_hz), unit: 'Hz' },
            { label: 'beats', value: fmt(c?.rr_beats) },
            { label: 'ECG gaps', value: fmt(c?.ecg_gaps), tone: (c?.ecg_gaps ?? 0) > 0 ? 'warn' : '' },
            { label: 'samples lost', value: fmt(c?.ecg_lost), tone: (c?.ecg_lost ?? 0) > 0 ? 'warn' : '' },
            { label: 'drops', value: fmt(po.state?.drops) },
          ]}
        />
      </div>
      <Panel title="ECG" className="span12" tools={<Seg value={seconds} options={['5', '10']} onChange={setSeconds} labels={{ 5: '5 s', 10: '10 s' }} />}>
        <Traces lanes={ecgLanes} rate={ECG_HZ} seconds={Number(seconds)} scale="auto" unit="µV" laneHeight={200} digits={0} />
      </Panel>
      <Panel title="Heart rate" className="span6">
        <History series={hrSeries} values={s ? [s.bpm] : null} seq={po.statsSeq} points={HIST_POINTS} unit="bpm" digits={0} height={180} />
      </Panel>
      <Panel title="R-R" className="span6">
        <Strip series={[{ label: 'R-R ms', color: '#e0b64d', ring: polar.rr }]} rate={1} seconds={120} span="120 beats" height={180} zero={false} />
      </Panel>
    </main>
  )
}
