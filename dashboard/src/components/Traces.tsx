import { useEffect, useRef } from 'react'
import type { Ring } from '../lib/ring'

export interface Lane {
  label: string
  color: string
  ring: Ring
}

interface Props {
  lanes: Lane[]
  rate: number
  seconds: number
  scale: number | 'auto' // half range in `unit`, or fit the window
  unit: string
  laneHeight: number
  center?: 'zero' | 'median' // where a fixed range is centred
  digits?: number
}

const GUTTER = 72 // lane labels live left of the traces, never on top of them

const fmt = (v: number, digits: number) => (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(digits))

// Scrolling multi-lane oscilloscope. Packets arrive in bursts, so the drawn edge follows a
// playhead that advances at the stream's own rate a little behind the newest sample, which
// is what keeps the scroll smooth instead of jumping once per Bluetooth packet.
export function Traces({ lanes, rate, seconds, scale, unit, laneHeight, center = 'median', digits = 1 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const props = useRef({ lanes, rate, seconds, scale, unit, center, digits })
  props.current = { lanes, rate, seconds, scale, unit, center, digits }

  useEffect(() => {
    const cv = ref.current!
    const ctx = cv.getContext('2d')!
    const ranges = new Map<string, [number, number]>()
    let head = -1
    let last = performance.now()
    let raf = 0

    const frame = () => {
      raf = requestAnimationFrame(frame)
      const { lanes, rate, seconds, scale, unit, center, digits } = props.current
      const dpr = window.devicePixelRatio || 1
      const W = cv.clientWidth
      const H = cv.clientHeight
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
        cv.width = Math.round(W * dpr)
        cv.height = Math.round(H * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      if (!lanes.length) return

      const received = Math.min(...lanes.map((l) => l.ring.count))
      const now = performance.now()
      head += (Math.min(250, now - last) / 1000) * rate
      last = now
      const lead = received - head
      if (head < 0 || lead > rate * 0.6 || lead < -rate * 1.5) head = received - rate * 0.12
      if (head > received) head = received
      const n = seconds * rate
      const start = head - n
      const lh = H / lanes.length
      const PW = W - GUTTER

      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'
      for (let s = Math.ceil(start / rate); s * rate <= head; s++) {
        const x = GUTTER + Math.round(((s * rate - start) / n) * PW) + 0.5
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, H)
        ctx.stroke()
      }

      const i0 = Math.max(0, Math.floor(start))
      const i1 = Math.floor(head)
      lanes.forEach((lane, li) => {
        const top = li * lh
        const mid = top + lh / 2
        if (li) {
          ctx.strokeStyle = 'rgba(255,255,255,0.09)'
          ctx.beginPath()
          ctx.moveTo(0, Math.round(top) + 0.5)
          ctx.lineTo(W, Math.round(top) + 0.5)
          ctx.stroke()
        }
        const vals: number[] = []
        for (let i = i0; i <= i1; i += 2) {
          const v = lane.ring.at(i)
          if (Number.isFinite(v)) vals.push(v)
        }
        vals.sort((a, b) => a - b)
        let lo = NaN
        let hi = NaN
        let range = ''
        if (scale === 'auto') {
          if (vals.length) {
            let a = vals[Math.floor(vals.length * 0.01)]
            let b = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.99))]
            const pad = Math.max((b - a) * 0.08, 1e-6)
            a -= pad
            b += pad
            const prev = ranges.get(lane.label)
            if (prev) {
              // widen at once so nothing clips, narrow slowly so the trace does not breathe
              a = a < prev[0] ? a : prev[0] + (a - prev[0]) * 0.04
              b = b > prev[1] ? b : prev[1] + (b - prev[1]) * 0.04
            }
            ranges.set(lane.label, [a, b])
            lo = a
            hi = b
            range = `${fmt(hi - lo, digits)} ${unit}`
          }
        } else {
          const c = center === 'zero' || !vals.length ? 0 : vals[vals.length >> 1]
          lo = c - scale
          hi = c + scale
          range = `±${scale} ${unit}`
        }

        if (Number.isFinite(lo) && hi > lo) {
          ctx.save()
          ctx.beginPath()
          ctx.rect(GUTTER, top + 1, PW, lh - 2)
          ctx.clip()
          ctx.strokeStyle = lane.color
          ctx.lineWidth = 1.25
          ctx.lineJoin = 'round'
          ctx.beginPath()
          const k = (lh / 2 - 6) / ((hi - lo) / 2)
          const c = (lo + hi) / 2
          let pen = false
          for (let i = i0; i <= i1; i++) {
            const v = lane.ring.at(i)
            if (!Number.isFinite(v)) {
              pen = false
              continue
            }
            const x = GUTTER + ((i - start) / n) * PW
            const y = mid - (v - c) * k
            if (pen) ctx.lineTo(x, y)
            else {
              ctx.moveTo(x, y)
              pen = true
            }
          }
          ctx.stroke()
          ctx.restore()
        }

        ctx.font = '600 11px system-ui, -apple-system, sans-serif'
        ctx.fillStyle = lane.color
        ctx.fillText(lane.label, 10, top + 18)
        ctx.font = '10px ui-monospace, Menlo, monospace'
        ctx.fillStyle = 'rgba(255,255,255,0.42)'
        if (range) ctx.fillText(range, 10, top + 32)
      })
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  return <canvas ref={ref} className="traces" style={{ height: laneHeight * lanes.length }} />
}
