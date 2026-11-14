import type { Stats } from '../lib/muse'

export const BAND_NAMES = ['δ', 'θ', 'α', 'β', 'γ']
export const BAND_COLORS = ['#4a6fc0', '#7fb1e6', '#19d18d', '#e0b64d', '#e6864f']

const WHERE: Record<string, string> = {
  TP9: 'left ear',
  AF7: 'left forehead',
  AF8: 'right forehead',
  TP10: 'right ear',
}

// top view, nose up: forehead pair either side of the reference, ear pair behind the ears
const POS: Record<string, [number, number]> = {
  AF7: [122, 60],
  AF8: [198, 60],
  TP9: [96, 146],
  TP10: [224, 146],
}

type Q = 0 | 1 | 2 | 3
const Q_WORD = ['no data', 'good', 'fair', 'bad']

function quality(stats: Stats | null, c: number): { q: Q; word: string; ac: number | null } {
  const e = stats?.eeg[c] ?? null
  if (!e) return { q: 0, word: Q_WORD[0], ac: null }
  if (e.rails > 5) return { q: 3, word: 'rail', ac: e.ac }
  return { q: e.q, word: Q_WORD[e.q], ac: e.ac }
}

function HeadMap({ names, stats }: { names: string[]; stats: Stats | null }) {
  return (
    <svg className="head" viewBox="0 0 320 222" role="img" aria-label="Electrode contact">
      <path className="nose" d="M147 31 L160 13 L173 31" />
      <ellipse className="ear" cx="73" cy="118" rx="9" ry="21" />
      <ellipse className="ear" cx="247" cy="118" rx="9" ry="21" />
      <ellipse className="skull" cx="160" cy="118" rx="82" ry="92" />
      <text className="side" x="48" y="122">L</text>
      <text className="side" x="264" y="122">R</text>
      <circle className="ref" cx="160" cy="44" r="5" />
      {names.map((n, c) => {
        const [x, y] = POS[n]
        const { q, word, ac } = quality(stats, c)
        return (
          <g key={n} className={`el q${q}`}>
            <circle cx={x} cy={y} r="18" />
            <text className="el-name" x={x} y={y + 4}>{n}</text>
            <text className="el-word" x={x} y={y + 34}>{word}</text>
            <text className="el-val" x={x} y={y + 47}>{ac === null ? '' : `${ac.toFixed(0)} µV`}</text>
          </g>
        )
      })}
    </svg>
  )
}

// Contact first (where each electrode sits and which one needs work), then the numbers.
export function Channels({ names, colors, stats }: { names: string[]; colors: string[]; stats: Stats | null }) {
  return (
    <div className="channels">
      <HeadMap names={names} stats={stats} />
      <table className="chan-table">
        <thead>
          <tr>
            <th />
            <th>ac <span className="u">µV</span></th>
            <th>dc <span className="u">µV</span></th>
            <th>loss</th>
            <th>55-100 Hz</th>
          </tr>
        </thead>
        {names.map((name, c) => {
          const e = stats?.eeg[c] ?? null
          const { q } = quality(stats, c)
          const loss = stats?.streams[name]?.loss ?? null
          const emg = stats?.emg[c] ?? null
          const bands = stats?.bands[c] ?? null
          return (
            <tbody key={name}>
              <tr>
                <td>
                  <i className={`dot q${q}`} />
                  <b style={{ color: colors[c] }}>{name}</b>
                  <small>{WHERE[name]}</small>
                </td>
                <td>{e ? e.ac.toFixed(0) : '-'}</td>
                <td>{e ? e.dc.toFixed(0) : '-'}</td>
                <td className={loss !== null && loss > 5 ? 'bad' : loss !== null && loss > 1 ? 'warn' : ''}>
                  {loss === null ? '-' : `${loss.toFixed(1)} %`}
                </td>
                <td>{emg === null ? '-' : `${emg.toFixed(0)} dB`}</td>
              </tr>
              <tr className="bandrow">
                <td colSpan={5}>
                  <div className="bandbar">
                    {bands ? bands.map((v, i) => <i key={i} style={{ width: `${v * 100}%`, background: BAND_COLORS[i] }} />) : null}
                  </div>
                </td>
              </tr>
            </tbody>
          )
        })}
      </table>
      <div className="band-legend">
        {BAND_NAMES.map((b, i) => (
          <span key={b}>
            <i style={{ background: BAND_COLORS[i] }} />
            {b}
          </span>
        ))}
      </div>
    </div>
  )
}
