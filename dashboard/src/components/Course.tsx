import { useEffect, useRef } from 'react'
import { useAgent } from '../lib/agent'
import { course, type Sample } from '../lib/course'
import { BAND_COLORS, BAND_NAMES } from './Channels'

const GUTTER = 72 // as in Traces: the names live left of the plot, never on top of it
const AXIS = 20 // the clock under the lanes
const MIN_SPAN_MS = 5 * 60_000 // a young graph fills from the left; 10 s are not stretched over the whole width
const TICKS_MIN = [1, 2, 5, 10, 15, 30, 60, 120, 240]

// top to bottom as a sleep lab draws it: awake on top, deep sleep at the bottom
const STAGES = ['awake', 'rem', 'drowsy', 'light', 'deep']
const STAGE_COLORS: Record<string, string> = { awake: '#e6864f', rem: '#c47ad9', drowsy: '#e0b64d', light: '#7fb1e6', deep: '#4a6fc0' }

interface Line {
  label: string
  color: string
  get: (s: Sample) => number | null
}
interface Lane {
  label: string
  unit: string
  floor?: number // the y axis starts here and not at the smallest value
  least: number // the smallest range of the y axis, so a steady number is a line and not its own noise
  lines: Line[]
}

const LANES: Lane[] = [
  { label: 'Heart', unit: 'bpm', least: 10, lines: [{ label: '', color: '#f0637e', get: (s) => s.hr }] },
  {
    label: 'Movement',
    unit: 'mg',
    floor: 0,
    least: 20,
    lines: [
      { label: 'wrist', color: '#4c9be8', get: (s) => s.wrist },
      { label: 'head', color: '#c47ad9', get: (s) => s.head },
    ],
  },
  // delta, theta and alpha: the three rhythms the stage of sleep is read from
  { label: 'Brain', unit: '%', floor: 0, least: 20, lines: [0, 1, 2].map((b) => ({ label: BAND_NAMES[b], color: BAND_COLORS[b], get: (s: Sample) => s.bands?.[b] ?? null })) },
]

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

function draw(cv: HTMLCanvasElement) {
  const W = cv.clientWidth
  const H = cv.clientHeight
  if (!W || !H) return
  const ctx = cv.getContext('2d')!
  const dpr = window.devicePixelRatio || 1
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr)
    cv.height = Math.round(H * dpr)
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)

  const ss = course.samples
  const now = Date.now()
  const t0 = ss.length ? ss[0].t : now
  const span = Math.max(now - t0, MIN_SPAN_MS)
  const PW = W - GUTTER - 8
  const bottom = H - AXIS
  const lh = bottom / (LANES.length + 1)
  const x = (t: number) => GUTTER + ((t - t0) / span) * PW
  const every = Math.max(1, Math.ceil(ss.length / (PW * 2))) // more samples than pixels: every n-th is drawn

  // the clock: a line through every lane, and the time under it
  const tick = (TICKS_MIN.find((m) => span / (m * 60_000) <= 8) ?? 240) * 60_000
  ctx.font = '10px ui-monospace, Menlo, monospace'
  ctx.lineWidth = 1
  for (let t = Math.ceil(t0 / tick) * tick; t <= t0 + span; t += tick) {
    const xx = Math.round(x(t)) + 0.5
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'
    ctx.beginPath()
    ctx.moveTo(xx, 0)
    ctx.lineTo(xx, bottom)
    ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.42)'
    ctx.fillText(clock(t), xx - ctx.measureText(clock(t)).width / 2, H - 6)
  }

  // the stage: its names down the side, each run as a bar at its height in the first lane, and a
  // faint band in its colour behind every lane, so each number is read against the stage
  const level = (st: string) => 12 + (STAGES.indexOf(st) / (STAGES.length - 1)) * (lh - 24)
  const stage = ss.length ? ss[ss.length - 1].stage : null
  STAGES.forEach((st) => {
    ctx.font = `${st === stage ? '600 ' : ''}10px system-ui, -apple-system, sans-serif`
    ctx.fillStyle = STAGE_COLORS[st]
    ctx.globalAlpha = st === stage ? 1 : 0.75
    ctx.fillText(st === 'rem' ? 'REM' : st, 10, level(st) + 3.5)
  })
  ctx.globalAlpha = 1
  let before: number | null = null
  for (let i = 0; i < ss.length; ) {
    let j = i
    while (j + 1 < ss.length && ss[j + 1].stage === ss[i].stage) j++
    const st = ss[i].stage
    if (st && st in STAGE_COLORS) {
      const xa = x(ss[i].t)
      const xb = x(j + 1 < ss.length ? ss[j + 1].t : now)
      const y = level(st)
      ctx.fillStyle = STAGE_COLORS[st]
      ctx.globalAlpha = 0.07
      ctx.fillRect(xa, 0, xb - xa, bottom)
      ctx.globalAlpha = 1
      ctx.fillRect(xa, y - 1.5, Math.max(xb - xa, 1), 3)
      if (before !== null) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)' // the step from the stage before
        ctx.fillRect(Math.round(xa), Math.min(before, y), 1, Math.abs(before - y))
      }
      before = y
    } else before = null
    i = j + 1
  }

  LANES.forEach((lane, li) => {
    const top = (li + 1) * lh
    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    ctx.fillRect(0, Math.round(top), W, 1)

    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < ss.length; i += every) {
      for (const line of lane.lines) {
        const v = line.get(ss[i])
        if (v !== null) {
          lo = Math.min(lo, v)
          hi = Math.max(hi, v)
        }
      }
    }
    const any = Number.isFinite(lo)
    if (any) {
      if (lane.floor !== undefined) lo = lane.floor
      if (hi - lo < lane.least) {
        lo = lane.floor ?? (lo + hi - lane.least) / 2
        hi = lo + lane.least
      }
      const y = (v: number) => top + lh - 8 - ((v - lo) / (hi - lo)) * (lh - 24)
      for (const line of lane.lines) {
        ctx.strokeStyle = line.color
        ctx.lineWidth = 1.5
        ctx.lineJoin = 'round'
        ctx.beginPath()
        let pen = false
        for (let i = 0; i < ss.length; i += every) {
          const v = line.get(ss[i])
          if (v === null) {
            pen = false
            continue
          }
          if (pen) ctx.lineTo(x(ss[i].t), y(v))
          else {
            ctx.moveTo(x(ss[i].t), y(v))
            pen = true
          }
        }
        ctx.stroke()
      }
      ctx.font = '10px ui-monospace, Menlo, monospace'
      ctx.fillStyle = 'rgba(255,255,255,0.42)'
      const r = `${hi.toFixed(0)} / ${lo.toFixed(0)} ${lane.unit}`
      ctx.fillText(r, W - 8 - ctx.measureText(r).width, top + 13)
    }

    // the lane's name, and the newest number of each of its lines in the line's own colour
    const one = lane.lines.length === 1
    ctx.font = '600 11px system-ui, -apple-system, sans-serif'
    ctx.fillStyle = one ? lane.lines[0].color : 'rgba(255,255,255,0.62)'
    ctx.fillText(lane.label, 10, top + 18)
    ctx.font = '10px ui-monospace, Menlo, monospace'
    lane.lines.forEach((line, k) => {
      const v = ss.length ? line.get(ss[ss.length - 1]) : null
      ctx.fillStyle = one ? 'rgba(255,255,255,0.42)' : line.color
      ctx.fillText(`${line.label ? line.label + ' ' : ''}${v === null ? '-' : v.toFixed(0)}${one ? ' ' + lane.unit : ''}`, 10, top + 32 + k * 13)
    })
  })
}

// The course of sleep, as the night chart of the Patch project draws a night: the stage on top,
// and under it the heart, the movement and the brain's rhythms, all on one clock. It grows from
// the left for the first 5 minutes and then holds everything since the page opened.
export function Course() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = ref.current!
    const paint = () => draw(cv)
    paint()
    const off = course.subscribe(paint)
    const ro = new ResizeObserver(paint)
    ro.observe(cv)
    return () => {
      off()
      ro.disconnect()
    }
  }, [])

  return (
    <div className="course">
      <canvas ref={ref} role="img" aria-label="The course of sleep: the stage, the heart rate, the movement and the brain's rhythms over time" />
    </div>
  )
}

// The stage of sleep now, in words (agent/sleep.py: scored each half minute). With no Muse on the
// head it is only stillness and the clock.
export function SleepNow() {
  const sl = useAgent().state?.sleep
  if (!sl?.stage) return null
  return (
    <span className="hr">
      {sl.cycle && sl.stage !== 'awake' ? `${sl.stage} sleep` : sl.stage}
      {sl.cycle ? `, cycle ${sl.cycle}, ${sl.asleep_min} min` : ''}
      {sl.eeg ? '' : ' (no EEG)'}
    </span>
  )
}
