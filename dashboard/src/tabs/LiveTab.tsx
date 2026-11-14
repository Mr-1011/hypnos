import { useMemo, useState } from 'react'
import { MOTION_HZ, band, useBand } from '../lib/band'
import { EEG_HZ, EEG_NAMES, muse, useMuse } from '../lib/muse'
import { ECG_HZ, polar, usePolar } from '../lib/polar'
import { Traces, type Lane } from '../components/Traces'
import { Transcript } from '../components/Transcript'
import { Memory } from '../components/Memory'
import { Panel, Seg, Tiles, fmt } from '../components/Panel'
import { AXIS_COLORS, EL_COLORS } from './MuseTab'

const TRACE = 180 // px, the height of each of the three trace panels; 5 EEG lanes need 36 each for their two lines of text

// Every device at once, on one screen (styles.css, "the Live tab"): the slow numbers, what was said
// and what the agent remembers, then the wrist, the brain and the heart on the same seconds. The
// slow charts and the health of each device are on its own tab.
export function LiveTab() {
  const bd = useBand()
  const mu = useMuse()
  const po = usePolar()
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

  const bands = mu.bandMean
  const hr = po.stats?.bpm ?? mu.stats?.hr.bpm ?? null
  const fast = Number(seconds)

  return (
    <main className="grid">
      <div className="span12">
        <Tiles
          items={[
            { label: 'heart rate', value: fmt(hr), unit: 'bpm' },
            { label: 'R-R', value: fmt(po.stats?.rr), unit: 'ms' },
            { label: 'wrist', value: bd.stats?.activity ?? '-', tone: bd.stats?.activity === 'still' ? 'good' : '' },
            { label: 'wrist movement', value: fmt(bd.stats?.move), unit: 'mg' },
            { label: 'head movement', value: fmt(mu.stats?.motion?.move), unit: 'mg' },
            { label: 'theta', value: fmt(bands?.[1]), unit: '%' },
            { label: 'alpha', value: fmt(bands?.[2]), unit: '%' },
          ]}
        />
      </div>

      <Transcript className="span6" />
      <Memory className="span6" />

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
