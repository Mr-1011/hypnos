import { useEffect, useRef } from 'react'
import { STEP_MS, course, type Sample } from '../lib/course'

const AXIS = 20 // the clock under the plot
const TOP = 12 // air over the top line
const PAD = 12 // left and right of the plot
const FULL_MS = 8 * 3600_000 // a night: as far out as the graph goes
const MIN_MS = 60_000 // and as far in: 30 samples
const FOLLOW_MS = 10 * 60_000 // what a click opens around now
const TICKS_S = [10, 30, 60, 120, 300, 600, 900, 1800, 3600]

const LINES: { label: string; color: string; get: (s: Sample) => number | null }[] = [
  { label: 'movement', color: '#4c9be8', get: (s) => s.move },
  { label: 'brain', color: '#c47ad9', get: (s) => s.brain },
  { label: 'talking', color: '#e0b64d', get: (s) => s.talk },
]

// What the graph shows: null is the whole night. follow keeps now in the middle, and s is not read then.
type View = { s: number; w: number; follow: boolean } | null

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// the lines end one step before now: the newest sample is still ahead, so they grow into it and do not jump every 2 s
const head = () => Date.now() - STEP_MS

// the window of a view, in utc ms. The night starts at the first sample; one longer than 8 h shows its last 8.
function windowOf(v: View): { s: number; w: number } {
  const h = head()
  const from = Math.max(course.samples[0]?.t ?? h, h - FULL_MS)
  if (!v) return { s: from, w: FULL_MS }
  return { s: v.follow ? h - v.w / 2 : clamp(v.s, from, from + FULL_MS - v.w), w: v.w }
}

function draw(cv: HTMLCanvasElement, s: number, w: number) {
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
  const now = head()
  const bottom = H - AXIS
  const x = (t: number) => PAD + ((t - s) / w) * (W - 2 * PAD)
  const y = (v: number) => bottom - 4 - v * (bottom - 4 - TOP)

  // calm at the bottom, awake at the top: a line at the bottom and one half way, and the clock under
  // them. The top has none: 12 px under the panel's title line it read as a double line.
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  for (const g of [0, 0.5]) {
    const yy = Math.round(y(g)) + 0.5
    ctx.beginPath()
    ctx.moveTo(0, yy)
    ctx.lineTo(W, yy)
    ctx.stroke()
  }
  const tick = (TICKS_S.find((n) => w / (n * 1000) <= 8) ?? 3600) * 1000
  ctx.font = '10px ui-monospace, Menlo, monospace'
  ctx.fillStyle = 'rgba(255,255,255,0.42)'
  for (let t = Math.ceil(s / tick) * tick; t <= s + w; t += tick) {
    const label = new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: tick < 60_000 ? '2-digit' : undefined, hour12: false })
    ctx.fillText(label, clamp(x(t) - ctx.measureText(label).width / 2, 4, W - 4 - ctx.measureText(label).width), H - 6)
  }

  // the samples in the window and one more on each side, so the lines run off its edges
  let a = ss.findIndex((p) => p.t >= s)
  let b = ss.findIndex((p) => p.t > s + w)
  if (a < 0) a = ss.length
  if (b < 0) b = ss.length - 1
  const every = Math.max(1, Math.ceil((b - a) / (W * 2))) // more samples than pixels: every n-th is drawn
  a = Math.max(0, a - 1)
  a -= a % every // the same samples on every frame, or the lines shimmer while the window moves

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, x(now), H)
  ctx.clip()
  for (const line of LINES) {
    ctx.strokeStyle = line.color
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    ctx.beginPath()
    let pen = false
    for (let i = a; i <= b; i += every) {
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
  ctx.restore()

  // a dot where each line is now: between the two samples around the head
  let n = ss.length - 1
  while (n >= 0 && ss[n].t > now) n--
  if (n >= 0) {
    const p = ss[n]
    const q = ss[n + 1] ?? p
    for (const line of LINES) {
      const vp = line.get(p)
      const vq = line.get(q)
      if (vp === null || vq === null) continue
      ctx.fillStyle = line.color
      ctx.beginPath()
      ctx.arc(x(now), y(vp + (vq - vp) * (q === p ? 0 : (now - p.t) / (q.t - p.t))), 3, 0, 2 * Math.PI)
      ctx.fill()
    }
  }
}

// the names of the lines, for the panel's header: the colour is a box, the text is the page's
export function Legend() {
  return (
    <div className="band-legend">
      {LINES.map((l) => (
        <span key={l.label}>
          <i style={{ background: l.color }} />
          {l.label}
        </span>
      ))}
    </div>
  )
}

// How awake the person is, as one graph: how much the body moves, how fast the brain runs and how
// much is said, each from calm at the bottom to awake at the top, on one clock. Zoomed all the way
// out it is a night of 8 hours. A pinch or Cmd and a scroll zooms about the cursor and a sideways
// swipe or Shift and a scroll pans, as on Patch's night chart. A click follows: now stays in the
// middle. A second click goes back to the night.
export function Course() {
  const ref = useRef<HTMLCanvasElement>(null)
  const view = useRef<View>(null)
  const cam = useRef<{ s: number; w: number } | null>(null) // the window on the canvas: it eases to the view's

  useEffect(() => {
    const cv = ref.current!
    let raf = 0
    const frame = () => {
      const to = windowOf(view.current)
      const c = (cam.current ??= to)
      // a new width is reached over some frames, and the left edge by the same share of its way, so
      // the lines stay in sight between the night and the last minutes
      const there = Math.abs(Math.log(to.w / c.w)) < 0.01
      const w = there ? to.w : c.w * (to.w / c.w) ** 0.2
      c.s += (to.s - c.s) * (there ? 0.2 : (w - c.w) / (to.w - c.w))
      c.w = w
      draw(cv, c.s, c.w)
      raf = requestAnimationFrame(frame)
    }
    frame()

    // native and not passive: only preventDefault keeps the browser from zooming the page on a pinch
    const onWheel = (e: WheelEvent) => {
      const v = view.current
      const { s, w } = windowOf(v)
      const plot = cv.clientWidth - 2 * PAD
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        // Patch's two scales: a pinch (ctrlKey) sends small numbers, Cmd and a scroll sends a page scroll's
        const dy = e.ctrlKey ? e.deltaY : clamp(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY, -80, 80)
        const nw = clamp(w * Math.exp(dy * (e.ctrlKey ? 0.02 : 0.004)), MIN_MS, FULL_MS)
        const at = clamp((e.clientX - cv.getBoundingClientRect().left - PAD) / plot, 0, 1) // the time under the cursor stays there
        view.current = nw >= FULL_MS ? null : { s: s + at * (w - nw), w: nw, follow: !!v?.follow }
      } else {
        const dx = e.shiftKey ? e.deltaX || e.deltaY : e.deltaX
        if (!v || !dx || (!e.shiftKey && Math.abs(dx) <= Math.abs(e.deltaY))) return
        e.preventDefault()
        view.current = { s: s + (dx / plot) * w, w, follow: false } // a pan lets go of now
      }
      cam.current = windowOf(view.current) // the fingers are followed at once, not eased
    }
    cv.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      cancelAnimationFrame(raf)
      cv.removeEventListener('wheel', onWheel)
    }
  }, [])

  const click = () => {
    const v = view.current
    view.current = v?.follow ? null : { s: 0, w: v?.w ?? FOLLOW_MS, follow: true }
  }

  return (
    <div className="course">
      <canvas ref={ref} onClick={click} role="img" aria-label="Sleep state over time: how much the body moves, how fast the brain runs and how much is said" />
    </div>
  )
}
