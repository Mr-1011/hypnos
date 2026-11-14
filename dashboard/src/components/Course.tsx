import { useEffect, useRef } from 'react'
import { SPEC_HZ, STAGES, STEP_MS, course, type Sample, type Stage } from '../lib/course'

const AXIS = 20 // the clock under the plot
const TOP = 12 // air over the ribbon
const PAD = 12 // left and right of the plot
const RIBBON = 8 // the stage of sleep, along the top
const NAMES = 20 // the stages' names under the ribbon
const GAP = 6 // under each lane
const SPEC_H = 64 // the EEG's spectrogram, under the lanes: at least this high
const FULL_MS = 8 * 3600_000 // a night: as far out as the graph goes
const MIN_MS = 60_000 // and as far in: 30 samples
const FOLLOW_MS = 10 * 60_000 // what a click opens around now
const TICKS_S = [10, 30, 60, 120, 300, 600, 900, 1800, 3600]

// A lane for each line, from the top: no line lies on another (the user's rule, 2026-11-14).
// Movement and sound go from 0 to 1. The heart has no such scale: its lane shows the beats a minute
// that are in the window (`beat`), so a change of 3 or 4 is seen.
const LANES: { label: string; color: string; get: (s: Sample) => number | null; bpm?: true }[] = [
  { label: 'movement', color: '#4c9be8', get: (s) => s.move },
  { label: 'sound', color: '#e0b64d', get: (s) => s.sound },
  { label: 'heart', color: '#f0637e', get: (s) => s.heart, bpm: true },
]
const beat = { lo: 50, hi: 70 } // the heart lane's bottom and top; it eases to the window's range

// Patch's colours for the stages of sleep. Patch has no drowsy: it lies between awake and light.
const STAGE: Record<Stage, [string, string]> = {
  awake: ['#e6864f', 'Awake'],
  drowsy: ['#b9a184', 'Drowsy'],
  light: ['#4a6fc0', 'Light'],
  deep: ['#2b2f74', 'Deep'],
  rem: ['#7fb1e6', 'REM'],
}

// Patch's ramp for the spectrogram, from quiet to loud
const HEAT = [[11, 10, 26], [59, 31, 98], [166, 59, 110], [240, 122, 60], [251, 227, 154]]

// What the graph shows: null is the whole night. follow keeps now in the middle, and s is not read then.
type View = { s: number; w: number; follow: boolean } | null

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// the lines end one step before now: the newest sample is still ahead, so they grow into it and do not jump every 2 s
const head = () => Date.now() - STEP_MS

// The night starts at the first sample; one longer than 8 h shows its last 8.
function night(): number {
  const h = head()
  return Math.max(course.samples[0]?.t ?? h, h - FULL_MS)
}

// the window of a view, in utc ms. No view goes over the night's two ends, also not one that
// follows now: there is nothing before the start of sleep.
function windowOf(v: View): { s: number; w: number } {
  const from = night()
  if (!v) return { s: from, w: FULL_MS }
  return { s: clamp(v.follow ? head() - v.w / 2 : v.s, from, from + FULL_MS - v.w), w: v.w }
}

// The spectrogram of the window as a picture: a column for each pixel, the mean of the samples in
// it, and a row for each Hz. It is made again only when the window or the samples change.
// (drawImage scaling a whole night down to the plot smeared the rows into each other.)
const pic = { cv: document.createElement('canvas'), key: '' }

function spectrogram(ss: Sample[], a: number, b: number, x: (t: number) => number, W: number, key: string): HTMLCanvasElement {
  if (key === pic.key) return pic.cv
  pic.key = key
  pic.cv.width = W
  pic.cv.height = SPEC_HZ
  const sum = new Float32Array(W * SPEC_HZ)
  const n = new Uint16Array(W)
  for (let i = a; i <= b; i++) {
    const spec = ss[i].spec
    if (!spec) continue
    // a sample holds until the next one; a timer that ran late leaves no hole
    const c0 = Math.floor(x(ss[i].t))
    const c1 = Math.max(c0, Math.floor(x(Math.min(ss[i + 1]?.t ?? Infinity, ss[i].t + 2 * STEP_MS))) - 1)
    for (let c = Math.max(0, c0); c <= Math.min(W - 1, c1); c++) {
      n[c]++
      for (let k = 0; k < SPEC_HZ; k++) sum[c * SPEC_HZ + k] += spec[k]
    }
  }
  const g = pic.cv.getContext('2d')!
  const img = g.createImageData(W, SPEC_HZ)
  for (let c = 0; c < W; c++) {
    if (!n[c]) continue
    for (let k = 0; k < SPEC_HZ; k++) {
      const v = (sum[c * SPEC_HZ + k] / n[c] / 255) * (HEAT.length - 1)
      const lo = Math.min(Math.floor(v), HEAT.length - 2)
      const o = ((SPEC_HZ - 1 - k) * W + c) * 4 // the top row is the highest Hz
      for (let j = 0; j < 3; j++) img.data[o + j] = HEAT[lo][j] + (HEAT[lo + 1][j] - HEAT[lo][j]) * (v - lo)
      img.data[o + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  return pic.cv
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
  const specH = Math.max(SPEC_H, Math.round(H * 0.16)) // a graph as large as the screen has a spectrogram to match
  const specTop = H - AXIS - specH
  const lanesTop = TOP + RIBBON + NAMES
  const laneH = (specTop - lanesTop) / LANES.length - GAP
  const top = (i: number) => lanesTop + i * (laneH + GAP) // of lane i
  const x = (t: number) => PAD + ((t - s) / w) * (W - 2 * PAD)
  // 2 px of air at a lane's two ends: a line at 0 or at 1 is not cut
  const y = (i: number, v: number) => top(i) + laneH - 2 - clamp(LANES[i].bpm ? (v - beat.lo) / (beat.hi - beat.lo) : v, 0, 1) * (laneH - 4)
  const nowX = x(now)

  // the samples in the window and one more on each side, so that everything runs off its edges
  let a = ss.findIndex((p) => p.t >= s)
  let b = ss.findIndex((p) => p.t > s + w)
  if (a < 0) a = ss.length
  if (b < 0) b = ss.length - 1
  a = Math.max(0, a - 1)
  let n = ss.length - 1 // the last sample before the head
  while (n >= 0 && ss[n].t > now) n--

  // The night as empty tracks, also the hours that are still to come: the graph goes on into them
  // (the user's rule, 2026-11-14). The clock's lines go down all of them.
  const from = night()
  const n0 = Math.max(0, x(from))
  const n1 = Math.min(W, x(from + FULL_MS))
  const tick = (TICKS_S.find((k) => w / (k * 1000) <= 8) ?? 3600) * 1000
  ctx.fillStyle = 'rgba(255,255,255,0.035)'
  ctx.fillRect(n0, TOP, n1 - n0, RIBBON + NAMES - GAP) // the ribbon and the names are one track
  LANES.forEach((_, i) => ctx.fillRect(n0, top(i), n1 - n0, laneH))
  ctx.fillRect(n0, specTop, n1 - n0, specH)
  ctx.fillStyle = 'rgba(255,255,255,0.05)'
  for (let t = Math.ceil((s + course.shift - 1) / tick) * tick; t <= s + course.shift + w; t += tick) {
    const tx = Math.round(x(t - course.shift))
    if (tx >= n0 && tx <= n1) ctx.fillRect(tx, TOP, 1, specTop + specH - TOP)
  }

  // the heart lane's range: the beats a minute in the window, on fives, and never under 20 of them
  let lo = Infinity
  let hi = -Infinity
  for (let i = a; i <= Math.min(b, n); i++) {
    const v = ss[i].heart
    if (v === null) continue
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  if (lo <= hi) {
    lo = Math.floor(lo / 5) * 5
    hi = Math.ceil(hi / 5) * 5
    while (hi - lo < 20) {
      hi += 5
      if (hi - lo < 20) lo -= 5
    }
    beat.lo += (lo - beat.lo) * 0.2
    beat.hi += (hi - beat.hi) * 0.2
  }

  // everything measured ends at the head
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, nowX, H)
  ctx.clip()

  // The stage of sleep as on Patch's night chart: a tint in each lane, a ribbon along the top
  // and the name where it fits. The stage of now is the colour at the head: it has no label of its
  // own (the user's rule, 2026-11-14).
  ctx.font = '10px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  for (let i = a; i <= b; ) {
    let j = i + 1
    while (j <= b && ss[j].stage === ss[i].stage) j++
    const stage = ss[i].stage
    if (stage) {
      const x0 = x(ss[i].t)
      const x1 = Math.min(j < ss.length ? x(ss[j].t) : nowX, nowX)
      ctx.fillStyle = STAGE[stage][0]
      ctx.globalAlpha = 0.18
      LANES.forEach((_, k) => ctx.fillRect(x0, top(k), x1 - x0, laneH))
      ctx.globalAlpha = 1
      ctx.fillRect(x0, TOP, x1 - x0, RIBBON)
      const from = Math.max(x0, 0)
      if (Math.min(x1, W) - from > ctx.measureText(STAGE[stage][1]).width + 8) {
        ctx.fillStyle = 'rgba(255,255,255,0.62)'
        ctx.fillText(STAGE[stage][1], (from + Math.min(x1, W)) / 2, TOP + RIBBON + 13)
      }
    }
    i = j
  }
  ctx.textAlign = 'left'

  const every = Math.max(1, Math.ceil((b - a) / (W * 2))) // more samples than pixels: every n-th is drawn
  const a0 = a - (a % every) // the same samples on every frame, or the lines shimmer while the window moves
  LANES.forEach((lane, k) => {
    ctx.strokeStyle = lane.color
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    ctx.beginPath()
    let pen = false
    for (let i = a0; i <= b; i += every) {
      const v = lane.get(ss[i])
      if (v === null) {
        pen = false
        continue
      }
      if (pen) ctx.lineTo(x(ss[i].t), y(k, v))
      else {
        ctx.moveTo(x(ss[i].t), y(k, v))
        pen = true
      }
    }
    ctx.stroke()
  })

  // the brain as on Patch: the EEG's spectrogram, 1 Hz at the bottom to 32 Hz at the top, bright is loud
  if (ss.length) {
    ctx.imageSmoothingEnabled = false // as on Patch: every column and every Hz keeps its own colour; smoothed, it was a fog
    ctx.drawImage(spectrogram(ss, a, b, x, W, `${a} ${b} ${s} ${w} ${W}`), 0, specTop, W, specH)
  }
  ctx.restore()

  // the clock; course.shift moves it for the made-up night
  ctx.font = '10px ui-monospace, Menlo, monospace'
  ctx.fillStyle = 'rgba(255,255,255,0.42)'
  for (let t = Math.ceil((s + course.shift - 1) / tick) * tick; t <= s + course.shift + w; t += tick) { // - 1: the left edge's own label
    const label = new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: tick < 60_000 ? '2-digit' : undefined, hour12: false })
    ctx.fillText(label, clamp(x(t - course.shift) - ctx.measureText(label).width / 2, 4, W - 4 - ctx.measureText(label).width), H - 6)
  }

  // the heart lane's scale, at its right end
  const heart = LANES.findIndex((l) => l.bpm)
  ctx.textAlign = 'right'
  ctx.fillText(`${Math.round(beat.hi)} bpm`, W - PAD - 4, top(heart) + 11)
  ctx.fillText(`${Math.round(beat.lo)}`, W - PAD - 4, top(heart) + laneH - 4)
  ctx.textAlign = 'left'

  if (n < 0) return
  // now: a line down the graph, and a dot where each line is (between the two samples around the head)
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.beginPath()
  ctx.moveTo(Math.round(nowX) + 0.5, TOP)
  ctx.lineTo(Math.round(nowX) + 0.5, specTop + specH)
  ctx.stroke()
  const p = ss[n]
  const q = ss[n + 1] ?? p
  LANES.forEach((lane, k) => {
    const vp = lane.get(p)
    const vq = lane.get(q)
    if (vp === null || vq === null) return
    ctx.fillStyle = lane.color
    ctx.beginPath()
    ctx.arc(nowX, y(k, vp + (vq - vp) * (q === p ? 0 : (now - p.t) / (q.t - p.t))), 3, 0, 2 * Math.PI)
    ctx.fill()
  })
}

// the names for the panel's header: the colour is a box, the text is the page's
export function Legend() {
  return (
    <div className="band-legend">
      {LANES.map((l) => (
        <span key={l.label}>
          <i style={{ background: l.color }} />
          {l.label}
        </span>
      ))}
      <span>
        <i style={{ width: 20, background: `linear-gradient(90deg, ${HEAT.slice(1).map((c) => `rgb(${c})`).join(', ')})` }} />
        brain
      </span>
      <span>
        <i style={{ width: 20, background: `linear-gradient(90deg, ${STAGES.map((st) => STAGE[st][0]).join(', ')})` }} />
        stage
      </span>
    </div>
  )
}

// How awake the person is, as one graph on one clock: the stage of sleep along the top, then a
// lane each for how much the body moves, how loud it is and how fast the heart beats, calm at the
// bottom of each, and the brain's spectrogram. Zoomed all the way out it is a night of 8 hours. A
// pinch or Cmd and a scroll zooms about the cursor and a sideways swipe or Shift and a scroll
// pans, as on Patch's night chart. A click follows: now stays in the middle. A second click goes
// back to the night. follow: it opens on the minutes around now and not on the night (the Focus tab).
export function Course({ follow = false }: { follow?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const view = useRef<View>(follow ? { s: 0, w: FOLLOW_MS, follow: true } : null)
  const cam = useRef<{ s: number; w: number } | null>(null) // the window on the canvas: it eases to the view's

  useEffect(() => {
    const cv = ref.current!
    let raf = 0
    const frame = () => {
      const to = windowOf(view.current)
      const c = course.samples.length ? (cam.current ??= to) : to // no samples yet: nothing to ease from
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
      <canvas ref={ref} onClick={click} role="img" aria-label="Sleep state over time: the stage of sleep, how much the body moves, how loud it is, the heart rate and the brain's spectrum" />
    </div>
  )
}
