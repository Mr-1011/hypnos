import { useEffect, useRef } from 'react'

export interface Series {
  label: string
  color: string
}

interface Props {
  series: Series[]
  values: (number | null)[] | null // one value per series, pushed once per `seq`
  seq: number
  points: number // how many pushes the chart holds
  range?: [number, number] // fixed y range; otherwise fit
  unit: string
  digits?: number
  height: number
}

// A slow strip chart fed by the 2 Hz stats: one column per stats message.
export function History({ series, values, seq, points, range, unit, digits = 1, height }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const hist = useRef<(number | null)[][]>([])
  const lastSeq = useRef(-1)

  useEffect(() => {
    if (!values || seq === lastSeq.current) return
    lastSeq.current = seq
    hist.current.push(values)
    if (hist.current.length > points) hist.current.splice(0, hist.current.length - points)
  }, [seq, values, points])

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
    const h = hist.current
    const top = 26
    const bottom = H - 6
    let lo = range ? range[0] : Infinity
    let hi = range ? range[1] : -Infinity
    let any = false
    for (const row of h) for (const v of row) if (v !== null && v !== undefined) any = true
    if (!range) {
      for (const row of h) for (const v of row) if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v) }
      if (!Number.isFinite(lo)) { lo = 0; hi = 1 }
      const pad = Math.max((hi - lo) * 0.1, 0.5)
      lo -= pad
      hi += pad
    }
    const y = (v: number) => bottom - ((v - lo) / (hi - lo)) * (bottom - top)
    const x = (i: number) => W - (h.length - 1 - i) * (W / (points - 1))

    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.lineWidth = 1
    for (const g of [0.25, 0.5, 0.75]) {
      const yy = Math.round(top + (bottom - top) * g) + 0.5
      ctx.beginPath()
      ctx.moveTo(0, yy)
      ctx.lineTo(W, yy)
      ctx.stroke()
    }
    series.forEach((s, si) => {
      ctx.strokeStyle = s.color
      ctx.lineWidth = 1.5
      ctx.beginPath()
      let pen = false
      h.forEach((row, i) => {
        const v = row[si]
        if (v === null || v === undefined) {
          pen = false
          return
        }
        if (pen) ctx.lineTo(x(i), y(v))
        else {
          ctx.moveTo(x(i), y(v))
          pen = true
        }
      })
      ctx.stroke()
    })
    let lx = 10
    ctx.font = '600 11px system-ui, -apple-system, sans-serif'
    series.forEach((s, si) => {
      const v = h.length ? h[h.length - 1][si] : null
      const text = `${s.label} ${v === null || v === undefined ? '-' : v.toFixed(digits)}`
      ctx.fillStyle = s.color
      ctx.fillText(text, lx, 16)
      lx += ctx.measureText(text).width + 14
    })
    ctx.font = '10px ui-monospace, Menlo, monospace'
    ctx.fillStyle = 'rgba(255,255,255,0.42)'
    const r = `${hi.toFixed(digits)} / ${lo.toFixed(digits)} ${unit}`
    if (any) ctx.fillText(r, W - ctx.measureText(r).width - 8, 16) // no data, no made-up range
  }, [seq, series, points, range, unit, digits, height])

  return <canvas ref={ref} className="history" style={{ height }} />
}
