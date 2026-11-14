import { useMemo, useState } from 'react'
import { MOTION_HZ, band, useBand } from '../lib/band'
import { Traces, type Lane } from '../components/Traces'
import { History } from '../components/History'
import { Panel, Seg, Tiles, fmt } from '../components/Panel'
import { AXIS_COLORS, HIST_POINTS } from './MuseTab'

const SCALES = ['auto', '0.1', '0.5', '2']

// The wrist: acceleration, turning, and how much of it arrives.
export function BandTab() {
  const bd = useBand()
  const s = bd.stats
  const [seconds, setSeconds] = useState<'5' | '10' | '20'>('10')
  const [scale, setScale] = useState('0.5')
  const accLanes: Lane[] = useMemo(() => ['x', 'y', 'z'].map((a, i) => ({ label: `acc ${a}`, color: AXIS_COLORS[i], ring: band.acc[i] })), [])
  const gyroLanes: Lane[] = useMemo(() => ['x', 'y', 'z'].map((a, i) => ({ label: `gyro ${a}`, color: AXIS_COLORS[i], ring: band.gyro[i] })), [])
  const moveSeries = useMemo(() => [{ label: 'wrist', color: '#4c9be8' }], [])

  return (
    <main className="grid">
      <div className="span12">
        <Tiles
          items={[
            { label: 'movement', value: fmt(s?.move), unit: 'mg' },
            { label: 'wrist', value: s?.activity ?? '-', tone: s?.activity === 'still' ? 'good' : '' },
            { label: 'steps', value: fmt(s?.steps) },
            { label: 'battery', value: fmt(s?.battery), unit: s?.charging ? '% charging' : '%', tone: (s?.battery ?? 100) < 15 ? 'bad' : '' },
            { label: 'signal', value: fmt(s?.rssi), unit: 'dBm' },
            { label: 'motion rate', value: fmt(s?.hz), unit: 'Hz' },
            { label: 'samples lost', value: fmt(s?.lost), tone: (s?.lost ?? 0) > 0 ? 'warn' : '' },
            { label: 'drops', value: fmt(bd.state?.drops) },
          ]}
        />
      </div>
      <Panel
        title="Acceleration"
        className="span6"
        tools={
          <>
            <Seg value={scale} options={SCALES} onChange={setScale} labels={{ auto: 'auto', 0.1: '±0.1', 0.5: '±0.5', 2: '±2' }} />
            <Seg value={seconds} options={['5', '10', '20']} onChange={setSeconds} labels={{ 5: '5 s', 10: '10 s', 20: '20 s' }} />
          </>
        }
      >
        <Traces lanes={accLanes} rate={MOTION_HZ} seconds={Number(seconds)} scale={scale === 'auto' ? 'auto' : Number(scale)} unit="g" laneHeight={80} digits={2} />
      </Panel>
      <Panel title="Turning" className="span6">
        <Traces lanes={gyroLanes} rate={MOTION_HZ} seconds={Number(seconds)} scale="auto" unit="°/s" laneHeight={80} digits={0} />
      </Panel>
      <Panel title="Movement" className="span12">
        <History series={moveSeries} values={s ? [s.move] : null} seq={bd.statsSeq} points={HIST_POINTS} unit="mg" digits={0} height={180} />
      </Panel>
    </main>
  )
}
