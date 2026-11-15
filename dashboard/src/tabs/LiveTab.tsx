import { useMemo, useState } from 'react'
import { MOTION_HZ, band } from '../lib/band'
import { EEG_HZ, EEG_NAMES, muse } from '../lib/muse'
import { ECG_HZ, polar } from '../lib/polar'
import { Traces, type Lane } from '../components/Traces'
import { Course, Legend } from '../components/Course'
import { Transcript } from '../components/Transcript'
import { Memory } from '../components/Memory'
import { Panel, Seg } from '../components/Panel'
import { AXIS_COLORS, EL_COLORS } from './MuseTab'

const TRACE = 180 // px, the height of each of the three trace panels; 5 EEG lanes need 36 each for their two lines of text

// Every device at once, on one screen (styles.css, "the Live tab"): how awake the person is beside
// what the agent remembers and what was said, then the wrist, the brain and the heart on the same
// seconds. The numbers, the slow charts and the health of each device are in the Debug tab.
export function LiveTab() {
  const [seconds, setSeconds] = useState<'5' | '10' | '20'>('10')

  const wrist: Lane[] = useMemo(() => ['x', 'y', 'z'].map((a, i) => ({ label: `acc ${a}`, color: AXIS_COLORS[i], ring: band.acc[i] })), [])
  const eeg: Lane[] = useMemo(
    () => [
      ...EEG_NAMES.slice(0, 4).map((label, c) => ({ label, color: EL_COLORS[c], ring: muse.eegFilt[c] })),
      { label: 'AF8-TP10', color: '#c47ad9', ring: muse.af8tp10 },
    ],
    [],
  )
  const ecg: Lane[] = useMemo(() => [{ label: 'ECG', color: '#f0637e', ring: polar.ecg }], [])

  const fast = Number(seconds)

  return (
    <main className="grid">
      <Panel title="Sleep State" className="span6" tools={<Legend />}>
        <Course />
      </Panel>
      <Memory className="span6">
        <Transcript />
      </Memory>

      <Panel title="Wrist" className="span4" tools={<Seg value={seconds} options={['5', '10', '20']} onChange={setSeconds} labels={{ 5: '5 s', 10: '10 s', 20: '20 s' }} />}>
        {/* a fixed range, so a still wrist is a flat line and not its own noise blown up */}
        <Traces lanes={wrist} rate={MOTION_HZ} seconds={fast} scale={0.5} unit="g" laneHeight={TRACE / 3} digits={2} />
      </Panel>
      <Panel title="Brain" className="span4">
        <Traces lanes={eeg} rate={EEG_HZ} seconds={fast} scale="auto" unit="µV" laneHeight={TRACE / 5} center="zero" digits={0} />
      </Panel>
      <Panel title="Heart" className="span4">
        <Traces lanes={ecg} rate={ECG_HZ} seconds={fast} scale="auto" unit="µV" laneHeight={TRACE} digits={0} />
      </Panel>
    </main>
  )
}
