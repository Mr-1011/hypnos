import { useEffect, useRef } from 'react'
import type { Ring } from '../lib/ring'

export interface StripSeries {
  label: string
  color: string
  ring: Ring
  dash?: boolean
  digits?: number
}

export interface StripShade {
  ring: Ring // per-sample bit flags, same rate as the series
  mask: number
  color: string
}

interface Props {
  series: StripSeries[]
  rate: number
  seconds: number
  height: number
  unit?: string
  shade?: StripShade[]
  zero?: boolean // keep 0 on the axis: activity and levels, not dB
  span?: string // what the window is called when it is not time (a tachogram counts beats)
}

// Several slow values on one shared axis, newest at the right, with optional flag bands behind
// them (`shade`).
export function Strip({ series, rate, seconds, height, unit = '', shade = [], zero = true, span }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const props = useRef({ series, rate, seconds, unit, shade, zero, span })
  props.current = { series, rate, seconds, unit, shade, zero, span }

  useEffect(() => {
    const cv = ref.current!
    const ctx = cv.getContext('2d')!
    let raf = 0
    let drawn = ''

    const frame = () => {
      raf = requestAnimationFrame(frame)
      const { series, rate, seconds, unit, shade, zero, span } = props.current
      const dpr = window.devicePixelRatio || 1
      const W = cv.clientWidth
      const H = cv.clientHeight
      const end = series.length ? Math.max(...series.map((s) => s.ring.count)) : 0
      const key = `${W}x${H}:${end}:${seconds}:${series.length}`
      if (key === drawn) return // nothing new: the data is 10 Hz, the screen is not
      drawn = key
      cv.width = Math.round(W * dpr)
      cv.height = Math.round(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      const n = Math.max(2, Math.round(seconds * rate))
      const i0 = end - n
      const top = 26
      const bottom = H - 6
      const x = (i: number) => ((i - i0) / (n - 1)) * W

      for (const s of shade) {
        ctx.fillStyle = s.color
        for (let i = Math.max(0, i0); i < end; i++) {
          const f = s.ring.at(i)
          if (Number.isFinite(f) && (f & s.mask) !== 0) ctx.fillRect(x(i), top - 4, Math.max(1, W / n + 0.5), bottom - top + 4)
        }
      }

      let lo = zero ? 0 : Infinity
      let hi = -Infinity
      let any = false
      for (const s of series)
        for (let i = Math.max(0, i0); i < end; i++) {
          const v = s.ring.at(i)
          if (Number.isFinite(v)) {
            lo = Math.min(lo, v)
            hi = Math.max(hi, v)
            any = true
          }
        }
      if (!Number.isFinite(hi)) {
        lo = 0
        hi = 1
      }
      if (hi - lo < 1e-6) hi = lo + 1
      const pad = (hi - lo) * 0.08
      if (!zero) lo -= pad
      hi += pad
      const y = (v: number) => bottom - ((v - lo) / (hi - lo)) * (bottom - top)

      ctx.strokeStyle = 'rgba(255,255,255,0.06)'
      ctx.lineWidth = 1
      for (const g of [0.25, 0.5, 0.75]) {
        const yy = Math.round(top + (bottom - top) * g) + 0.5
        ctx.beginPath()
        ctx.moveTo(0, yy)
        ctx.lineTo(W, yy)
        ctx.stroke()
      }

      for (const s of series) {
        ctx.strokeStyle = s.color
        ctx.lineWidth = s.dash ? 1.25 : 1.75
        ctx.setLineDash(s.dash ? [6, 5] : [])
        ctx.lineJoin = 'round'
        ctx.beginPath()
        let pen = false
        for (let i = Math.max(0, i0); i < end; i++) {
          const v = s.ring.at(i)
          if (!Number.isFinite(v)) {
            pen = false
            continue
          }
          if (pen) ctx.lineTo(x(i), y(v))
          else {
            ctx.moveTo(x(i), y(v))
            pen = true
          }
        }
        ctx.stroke()
      }
      ctx.setLineDash([])

      let lx = 10
      ctx.font = '600 11px system-ui, -apple-system, sans-serif'
      for (const s of series) {
        const v = s.ring.last()
        const text = `${s.label} ${Number.isFinite(v) ? v.toFixed(s.digits ?? 0) : '-'}`
        ctx.fillStyle = s.color
        ctx.fillText(text, lx, 16)
        lx += ctx.measureText(text).width + 14
      }
      ctx.font = '10px ui-monospace, Menlo, monospace'
      ctx.fillStyle = 'rgba(255,255,255,0.42)'
      const win = span ?? (seconds >= 60 ? `${seconds / 60} min` : `${seconds} s`)
      const r = any ? `${hi.toFixed(0)}${unit ? ` ${unit}` : ''} · ${win}` : win
      ctx.fillText(r, W - ctx.measureText(r).width - 8, 16)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  return <canvas ref={ref} className="strip" style={{ height }} />
}
