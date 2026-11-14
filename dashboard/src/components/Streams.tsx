import type { Stats } from '../lib/muse'

const ROWS: [string, string, number][] = [
  ['TP9', 'TP9', 256],
  ['AF7', 'AF7', 256],
  ['AF8', 'AF8', 256],
  ['TP10', 'TP10', 256],
  ['AUX', 'AUX', 256],
  ['acc', 'Accel', 52],
  ['gyro', 'Gyro', 52],
  ['ppg1', 'PPG 1', 64],
  ['ppg2', 'PPG 2', 64],
  ['ppg3', 'PPG 3', 64],
  ['tele', 'Telemetry', 0],
]

// Every characteristic the band can send, and what actually arrives under the current preset.
export function Streams({ stats }: { stats: Stats | null }) {
  return (
    <table className="streams">
      <thead>
        <tr>
          <th>stream</th>
          <th>Hz</th>
          <th>pkt/s</th>
          <th>loss 10 s</th>
          <th>lost</th>
          <th>last</th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map(([key, label, nominal]) => {
          const s = stats?.streams[key]
          const live = !!s && s.age !== null && s.age < (key === 'tele' ? 30 : 3)
          const loss = s?.loss ?? null
          return (
            <tr key={key} className={live ? '' : 'off'}>
              <td>{label}</td>
              <td className={live && nominal && Math.abs(s!.sps - nominal) > nominal * 0.15 ? 'warn' : ''}>
                {live && nominal ? s!.sps.toFixed(0) : '-'}
              </td>
              <td>{live ? s!.pps.toFixed(1) : '-'}</td>
              <td className={loss !== null && loss > 5 ? 'bad' : loss !== null && loss > 1 ? 'warn' : ''}>
                {live && loss !== null ? `${loss.toFixed(1)} %` : '-'}
              </td>
              <td>{s ? s.lost : '-'}</td>
              <td>{s && s.age !== null ? `${s.age.toFixed(1)} s` : '-'}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
