import { useMemo, useState } from 'react'
import { MOTION_HZ, band, useBand } from '../lib/band'
import { EEG_HZ, EEG_NAMES, PPG_HZ, muse, useMuse } from '../lib/muse'
import { ECG_HZ, polar, usePolar } from '../lib/polar'
import { useTick } from '../lib/tick'
import { Traces, type Lane } from '../components/Traces'
import { Strip } from '../components/Strip'
import { History } from '../components/History'
import { Spectrogram } from '../components/Spectrogram'
import { Channels, BAND_COLORS, BAND_NAMES } from '../components/Channels'
import { Streams } from '../components/Streams'
import { Transcript } from '../components/Transcript'
import { Panel, Seg, Tiles, fmt } from '../components/Panel'
import { AXIS_COLORS, EL_COLORS, HIST_POINTS, PPG_LANES } from './MuseTab'

// Every device at once: what was said, then three panels a row with the wrist, the brain and the
// heart on the same seconds, then the slow numbers, then how well the Muse sits and how much of
// it arrives.
export function LiveTab() {
  const bd = useBand()
  const mu = useMuse()
  const po = usePolar()
  const tick = useTick(500)
  const [seconds, setSeconds] = useState<'5' | '10' | '20'>('10')

  const wrist: Lane[] = useMemo(() => ['x', 'y', 'z'].map((a, i) => ({ label: `acc ${a}`, color: AXIS_COLORS[i], ring: band.acc[i] })), [])
  const eeg: Lane[] = useMemo(
    () => [
      ...EEG_NAMES.slice(0, 4).map((label, c) => ({ label, color: EL_COLORS[c], ring: muse.eegFilt[c] })),
      { label: 'AF8-TP10', color: '#c47ad9', ring: muse.af8tp10 },
    ],
    [],
  )
  const bandSeries = useMemo(() => BAND_NAMES.map((label, i) => ({ label, color: BAND_COLORS[i] })), [])
  const ecg: Lane[] = useMemo(() => [{ label: 'ECG', color: '#f0637e', ring: polar.ecg }], [])
  const heartSeries = useMemo(() => [{ label: 'Polar', color: '#f0637e' }, { label: 'Muse PPG', color: '#e0b64d' }], [])
  const moveSeries = useMemo(() => [{ label: 'wrist', color: '#4c9be8' }, { label: 'head', color: '#c47ad9' }], [])

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

      <Transcript className="span12" />

      <Panel title="Wrist" className="span4" tools={<Seg value={seconds} options={['5', '10', '20']} onChange={setSeconds} labels={{ 5: '5 s', 10: '10 s', 20: '20 s' }} />}>
        {/* a fixed range, so a still wrist is a flat line and not its own noise blown up */}
        <Traces lanes={wrist} rate={MOTION_HZ} seconds={fast} scale={0.5} unit="g" laneHeight={200 / 3} digits={2} />
      </Panel>
      <Panel title="Brain" className="span4">
        <Traces lanes={eeg} rate={EEG_HZ} seconds={fast} scale="auto" unit="µV" laneHeight={40} center="zero" digits={0} />
      </Panel>
      <Panel title="Heart" className="span4">
        <Traces lanes={ecg} rate={ECG_HZ} seconds={fast} scale="auto" unit="µV" laneHeight={200} digits={0} />
      </Panel>

      <Panel title="Movement" className="span4">
        <History series={moveSeries} values={[bd.stats?.move ?? null, mu.stats?.motion?.move ?? null]} seq={tick} points={HIST_POINTS} unit="mg" digits={0} height={180} />
      </Panel>
      <Panel title="Spectrogram" className="span4">
        <Spectrogram column={mu.specMean} seq={mu.statsSeq} points={HIST_POINTS} fmax={45} height={180} />
      </Panel>
      <Panel title="Band power" className="span4">
        <History series={bandSeries} values={bands} seq={mu.statsSeq} points={HIST_POINTS} range={[0, 100]} unit="%" digits={0} height={180} />
      </Panel>

      <Panel title="Heart rate" className="span6">
        <History series={heartSeries} values={[po.stats?.bpm ?? null, mu.stats?.hr.bpm ?? null]} seq={tick} points={HIST_POINTS} unit="bpm" digits={0} height={160} />
      </Panel>
      <Panel title="R-R" className="span6">
        <Strip series={[{ label: 'R-R ms', color: '#e0b64d', ring: polar.rr }]} rate={1} seconds={120} span="120 beats" height={160} zero={false} />
      </Panel>

      <Panel title="Muse contact" className="span4">
        <Channels names={EEG_NAMES.slice(0, 4)} colors={EL_COLORS} stats={mu.stats} />
      </Panel>
      <Panel title="Muse streams" className="span4">
        <Streams stats={mu.stats} />
      </Panel>
      <Panel
        title="Muse PPG"
        className="span4"
        tools={
          <div className="hr">
            <b>{mu.stats?.hr.bpm ?? '-'}</b> bpm
          </div>
        }
      >
        <Traces lanes={PPG_LANES} rate={PPG_HZ} seconds={10} scale="auto" unit="" laneHeight={229} digits={0} />
      </Panel>
    </main>
  )
}
