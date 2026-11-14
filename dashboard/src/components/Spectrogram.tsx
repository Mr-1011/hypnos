import { useEffect, useRef } from 'react'

interface Props {
  column: number[] | null // dB per 1 Hz bin from 0 Hz, one per stats message
  seq: number
  points: number
  fmax: number
  height: number
}

// magma, five stops
const STOPS: [number, number, number][] = [
  [0, 0, 4],
  [59, 15, 112],
  [140, 41, 129],
  [222, 73, 104],
  [252, 253, 191],
]

function cmap(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(0.9999, t)) * (STOPS.length - 1)
  const i = Math.floor(x)
  const f = x - i
  const a = STOPS[i]
  const b = STOPS[i + 1]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

const AXIS = 34

export function Spectrogram({ column, seq, points, fmax, height }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const cols = useRef<(number[] | null)[]>([])
  const span = useRef<[number, number] | null>(null)
  const lastSeq = useRef(-1)

  // one column per stats message, never per render: the parent rebuilds `column` on every render
  useEffect(() => {
    if (seq === lastSeq.current) return
    lastSeq.current = seq
    cols.current.push(column)
    if (cols.current.length > points) cols.current.splice(0, cols.current.length - points)
  }, [seq, column, points])

  useEffect(() => {
    const cv = ref.current!
    const ctx = cv.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    const W = cv.clientWidth
    const H = cv.clientHeight
    cv.width = Math.round(W * dpr)
    cv.height = Math.round(H * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    // colour range: 5th to 99th percentile of what is on screen, eased so it does not flicker
    const all: number[] = []
    for (const c of cols.current) if (c) for (let f = 1; f <= fmax; f += 2) all.push(c[f])
    if (all.length > 20) {
      all.sort((a, b) => a - b)
      const want: [number, number] = [all[Math.floor(all.length * 0.05)], all[Math.floor(all.length * 0.99)]]
      const s = span.current
      span.current = s ? [s[0] + (want[0] - s[0]) * 0.2, s[1] + (want[1] - s[1]) * 0.2] : want
    }
    const [lo, hi] = span.current ?? [0, 1]

    const img = ctx.createImageData(points, fmax)
    cols.current.forEach((c, ci) => {
      const x = points - cols.current.length + ci
      for (let f = 0; f < fmax; f++) {
        const p = ((fmax - 1 - f) * points + x) * 4
        if (!c) {
          img.data[p + 3] = 0
          continue
        }
        const [r, g, b] = cmap((c[f + 1] - lo) / (hi - lo || 1))
        img.data[p] = r
        img.data[p + 1] = g
        img.data[p + 2] = b
        img.data[p + 3] = 255
      }
    })
    const off = document.createElement('canvas')
    off.width = points
    off.height = fmax
    off.getContext('2d')!.putImageData(img, 0, 0)
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(off, AXIS, 0, W - AXIS, H)

    ctx.font = '10px ui-monospace, Menlo, monospace'
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    const step = fmax > 60 ? 20 : 10
    for (let f = 0; f <= fmax; f += step) {
      const yy = H - (f / fmax) * H
      ctx.fillText(`${f}`, 4, Math.min(H - 3, Math.max(10, yy + 3)))
      ctx.beginPath()
      ctx.moveTo(AXIS - 4, Math.round(yy) + 0.5)
      ctx.lineTo(AXIS, Math.round(yy) + 0.5)
      ctx.stroke()
    }
  }, [seq, points, fmax, height])

  // the canvas sits absolutely inside a box that takes the row's height: a canvas that sizes
  // itself from its own clientHeight would otherwise grow by the pixel ratio on every draw
  return (
    <div className="spectrogram" style={{ minHeight: height }}>
      <canvas ref={ref} />
    </div>
  )
}
