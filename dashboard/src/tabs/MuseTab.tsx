import { useMemo, useState } from 'react'
import { EEG_HZ, EEG_NAMES, IMU_HZ, PPG_HZ, muse, museApi, useMuse } from '../lib/muse'
import { Traces, type Lane } from '../components/Traces'
import { History } from '../components/History'
import { Spectrogram } from '../components/Spectrogram'
import { Channels, BAND_COLORS, BAND_NAMES } from '../components/Channels'
import { Streams } from '../components/Streams'
import { DeviceInfo } from '../components/Device'
import { Panel, Seg, Tiles, fmt } from '../components/Panel'

export const EL_COLORS = ['#ffb08a', '#9fb4ff', '#6f8cf0', '#f07f5a', '#9ca3ac']
export const AXIS_COLORS =['#e6864f', '#19d18d', '#4c9be8']
const SCALES = ['auto', '25', '50', '100', '200', '500']
export const HIST_POINTS = 240 // 2 min at 2 Hz
// channel 3 carries no light on this band (see live_muse.py), so it is not drawn
export const PPG_LANES: Lane[] = [
  { label: 'PPG 1', color: '#e0b64d', ring: muse.ppg[0] },
  { label: 'PPG 2', color: '#f0637e', ring: muse.ppg[1] },
]

// Everything the Muse S sends, as Muse Live showed it.
export function MuseTab() {
  const lv = useMuse()
  const st = lv.state
  const stats = lv.stats
  const connected = st?.link === 'streaming'
  const recording = !!st?.rec.on // a preset change restarts the Muse's streams, never mid-night

  const [filtered, setFiltered] = useState<'filt' | 'raw'>('filt')
  const [scale, setScale] = useState('auto')
  const [seconds, setSeconds] = useState<'2' | '5' | '10'>('5')
  const [specCh, setSpecCh] = useState('mean')
  const [fmax, setFmax] = useState<'45' | '100'>('45')
  const [preset, setPreset] = useState<string | null>(null)

  const shownPreset = preset ?? st?.preset ?? 'p50'
  const auxLive = (stats?.streams.AUX?.age ?? 99) < 3
  const ppgLive = (stats?.streams.ppg2?.age ?? 99) < 3

  const eegLanes: Lane[] = useMemo(() => {
    const rings = filtered === 'filt' ? muse.eegFilt : muse.eegRaw
    const n = auxLive ? 5 : 4
    return EEG_NAMES.slice(0, n).map((label, c) => ({ label, color: EL_COLORS[c], ring: rings[c] }))
  }, [filtered, auxLive])
  const accLanes: Lane[] = useMemo(() => ['x', 'y', 'z'].map((a, i) => ({ label: `acc ${a}`, color: AXIS_COLORS[i], ring: muse.acc[i] })), [])
  const gyroLanes: Lane[] = useMemo(() => ['x', 'y', 'z'].map((a, i) => ({ label: `gyro ${a}`, color: AXIS_COLORS[i], ring: muse.gyro[i] })), [])
  const specColumn = specCh === 'mean' ? lv.specMean : (stats?.spec[EEG_NAMES.indexOf(specCh)] ?? null)

  const bandSeries = useMemo(() => BAND_NAMES.map((label, i) => ({ label, color: BAND_COLORS[i] })), [])
  const emgSeries = useMemo(() => EEG_NAMES.slice(0, 4).map((label, i) => ({ label, color: EL_COLORS[i] })), [])

  // the same numbers as the Muse card, plus heart rate and movement
  const eeg = (stats?.eeg ?? []).slice(0, 4)
  const seen = eeg.filter((e) => e).length
  const good = eeg.filter((e) => e?.q === 1).length
  const losses = EEG_NAMES.slice(0, 4).map((k) => stats?.streams[k]?.loss).filter((v): v is number => typeof v === 'number')
  const loss = losses.length ? Math.max(...losses) : null

  return (
    <main className="grid">
      <div className="span12">
        <Tiles
          items={[
            { label: 'battery', value: fmt(st?.tele?.batt), unit: '%', tone: (st?.tele?.batt ?? 100) < 15 ? 'bad' : (st?.tele?.batt ?? 100) < 30 ? 'warn' : '' },
            { label: 'contact', value: seen ? `${good}/4` : '-', tone: seen && good < 2 ? 'bad' : seen && good < 4 ? 'warn' : '' },
            { label: 'heart rate', value: fmt(stats?.hr.bpm), unit: 'bpm' },
            { label: 'movement', value: fmt(stats?.motion?.move), unit: 'mg' },
            { label: 'EEG loss', value: fmt(loss, 1), unit: '%', tone: (loss ?? 0) > 5 ? 'bad' : (loss ?? 0) > 1 ? 'warn' : '' },
            { label: 'drops', value: fmt(st?.drops) },
          ]}
        />
      </div>
      <div className="toolbar span12">
        <select value={shownPreset} onChange={(e) => setPreset(e.target.value)} disabled={!lv.online || recording}>
          {(st?.presets ?? ['p50']).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        {connected && !recording && shownPreset !== st?.preset ? <button onClick={() => museApi('preset', { preset: shownPreset })}>Apply</button> : null}
        {connected ? <button onClick={() => museApi('status')}>Status</button> : null}
        <DeviceInfo state={st} />
      </div>

      <Panel
        title="EEG"
        className="span8"
        tools={
          <>
            <Seg value={filtered} options={['filt', 'raw']} onChange={setFiltered} labels={{ filt: '1-45 Hz', raw: 'raw' }} />
            <Seg value={scale} options={SCALES} onChange={setScale} labels={{ auto: 'auto', 25: '±25', 50: '±50', 100: '±100', 200: '±200', 500: '±500' }} />
            <Seg value={seconds} options={['2', '5', '10']} onChange={setSeconds} labels={{ 2: '2 s', 5: '5 s', 10: '10 s' }} />
          </>
        }
      >
        <Traces
          lanes={eegLanes}
          rate={EEG_HZ}
          seconds={Number(seconds)}
          scale={scale === 'auto' ? 'auto' : Number(scale)}
          unit="µV"
          laneHeight={92}
          center={filtered === 'filt' ? 'zero' : 'median'}
          digits={0}
        />
      </Panel>

      <Panel title="Electrodes" className="span4">
        <Channels names={EEG_NAMES.slice(0, 4)} colors={EL_COLORS} stats={stats} />
      </Panel>

      <Panel
        title="Spectrogram"
        className="span8"
        tools={
          <>
            <Seg value={specCh} options={['mean', 'TP9', 'AF7', 'AF8', 'TP10']} onChange={setSpecCh} />
            <Seg value={fmax} options={['45', '100']} onChange={setFmax} labels={{ 45: '45 Hz', 100: '100 Hz' }} />
          </>
        }
      >
        <Spectrogram column={specColumn} seq={lv.statsSeq} points={HIST_POINTS} fmax={Number(fmax)} height={220} />
      </Panel>

      <Panel title="Streams" className="span4">
        <Streams stats={stats} />
      </Panel>

      <Panel title="Band power" className="span6">
        <History series={bandSeries} values={lv.bandMean} seq={lv.statsSeq} points={HIST_POINTS} range={[0, 100]} unit="%" digits={0} height={180} />
      </Panel>

      <Panel title="Muscle 55-100 Hz" className="span6">
        <History series={emgSeries} values={stats ? stats.emg.slice(0, 4) : null} seq={lv.statsSeq} points={HIST_POINTS} unit="dB" digits={1} height={180} />
      </Panel>

      <Panel
        title="PPG"
        className="span6"
        tools={
          <div className="hr">
            <b>{stats?.hr.bpm ?? '-'}</b> bpm
          </div>
        }
      >
        {ppgLive || !connected ? (
          <Traces lanes={PPG_LANES} rate={PPG_HZ} seconds={10} scale="auto" unit="" laneHeight={105} digits={0} />
        ) : (
          <div className="empty">{shownPreset}</div>
        )}
      </Panel>

      <Panel
        title="Motion"
        className="span6"
        tools={
          stats?.motion ? (
            <div className="hr">
              <b>{stats.motion.move.toFixed(0)}</b> mg <span>g {stats.motion.g.map((v) => v.toFixed(2)).join(' ')}</span>
            </div>
          ) : null
        }
      >
        <Traces lanes={accLanes} rate={IMU_HZ} seconds={10} scale="auto" unit="g" laneHeight={44} digits={2} />
        <Traces lanes={gyroLanes} rate={IMU_HZ} seconds={10} scale="auto" unit="°/s" laneHeight={44} digits={0} />
      </Panel>
    </main>
  )
}
