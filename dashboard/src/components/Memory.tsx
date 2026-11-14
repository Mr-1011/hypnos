import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useAgent, type BrainNode } from '../lib/agent'
import { post } from '../lib/sse'
import { Panel } from './Panel'

const COLOR: Record<BrainNode['kind'], string> = { person: '#f3f4f6', head: '#e0b64d', line: '#c47ad9', day: '#4c9be8', source: '#19d18d', item: '#5fbf9f', said: '#8fbdf0', detail: '#9bd8c2' }
const NAME: Record<BrainNode['kind'], string> = { person: 'the person', head: 'a part of the notes', line: 'a note', day: 'a day', source: 'connected', item: 'from a connected source', said: 'that day', detail: 'more about it' }

type P = { x: number; y: number; vx: number; vy: number }

// The demo: while it is on, the agent listens through the band's microphone and answers
// (agent/voice.py, POST /api/talk). While it is off, nothing reacts to what a person says. It is
// in the Memory card's title line, on Live and on Focus (the user's rule, 2026-11-14).
function Demo() {
  const ag = useAgent()
  const on = !!ag.state?.on
  return (
    <label className="demo">
      Demo
      <button role="switch" aria-checked={on} aria-label="Demo" className={`switch ${on ? 'on' : ''}`} onClick={() => post('/api/agent', '/api/talk', { on: !on })} disabled={!ag.online} />
    </label>
  )
}

const ZOOM = 1.4 // how much larger the picture is about a dot that was clicked
const SPREAD = 1.7 // the detailed picture has that many times the room between its dots
const MAX = 28 // letters in a dot's name
const LITTLE = new Set('a an the of to in on at for and or but if with about my your our their that this is are was were be not by from as it so i you we she he they'.split(' '))

// A dot's name, as a note has its title in a notes app: short, whole words, no "..." and no colon
// (the user's rule, 2026-11-14). The line under the picture has all of the text of the dot under
// the pointer.
function name(n: BrainNode): string {
  if (n.kind === 'day') return new Date(`${n.label}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  let s = n.label
    .replace(/^[\d: -]+/, '') // its date and time: the link to the day shows them
    .replace(/^(you|agent|heard): /, '') // a day's line: who said it
    .replace(/\s*\(\d{4}-\d{2}-\d{2}\)/g, '')
    .replace(/["“”]/g, '')
  const colon = s.indexOf(': ')
  if (colon > 0 && colon <= MAX) s = s.slice(0, colon) // "Finals: the pitch to the judges" is Finals, and a mail is who it is from
  s = s.replace(/^(.{8,}?) (while|before|after|because|when|but) .*/, '$1') // the first part of a long sentence
  const cut = s.lastIndexOf(' ', MAX)
  if (s.length > MAX && cut > 0) {
    const words = s.slice(0, cut).split(' ')
    while (words.length > 1 && LITTLE.has(words[words.length - 1].toLowerCase())) words.pop() // a name does not end in "the"
    s = words.join(' ')
  }
  s = s.replace(/[.,;:!?]+$/, '')
  return s.charAt(0).toUpperCase() + s.slice(1)
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// What the agent keeps about the person (agent/brain.py), drawn the way a notes app draws its
// graph: every note and every day is a dot, and a line joins what belongs together. The dots push
// each other apart and the links pull, until the picture rests. children: the lower part of the
// card, the transcript. detail: the picture of the Focus tab, as a notes app draws a vault: small
// dots with room between them, and every dot that is inside another is there too, as its satellite.
export function Memory({ className = '', detail = false, children }: { className?: string; detail?: boolean; children?: ReactNode }) {
  const scale = detail ? SPREAD : 1 // the dots are laid out in a smaller picture and drawn that much further apart
  const ag = useAgent()
  // the agent sends its whole state for every change: the same graph again must not move a dot
  const sent = ag.state?.brain
  const same = useMemo(() => JSON.stringify(sent), [sent])
  const brain = useMemo(() => sent, [same])
  const sense = ag.state?.sense
  const pos = useRef(new Map<string, P>())
  // the picture is laid out in the card's own pixels, so the words keep their size in a card of any height
  const svg = useRef<SVGSVGElement>(null)
  const [{ W, H }, setSize] = useState({ W: 720, H: 280 })
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ W: Math.round(e.contentRect.width / scale) || 720, H: Math.round(e.contentRect.height / scale) || 280 }))
    ro.observe(svg.current!)
    return () => ro.disconnect()
  }, [scale])
  const [, setFrame] = useState(0)
  const [hot, setHot] = useState<string | null>(null)
  // a dot can hold more dots (in): a day holds what was said on it. A click opens and closes it.
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const toggle = (id: string) => setOpen((o) => new Set(o.has(id) ? [...o].filter((x) => x !== id) : [...o, id]))
  // A click on a dot brings it near: the picture grows about it. A second click on it, or a click
  // beside the dots, goes back to the whole picture.
  const [zoomed, setZoomed] = useState<string | null>(null)
  const holds = useMemo(() => new Set((brain?.nodes ?? []).map((n) => n.in)), [brain])
  const shown = useMemo(() => {
    const nodes = (brain?.nodes ?? []).filter((n) => detail || !n.in || open.has(n.in))
    const ids = new Set(nodes.map((n) => n.id))
    return { nodes, links: (brain?.links ?? []).filter(([a, b]) => ids.has(a) && ids.has(b)) }
  }, [brain, open, detail])
  // the satellites of the detailed picture: small, near their dot, and they push less
  const sat = useMemo(() => new Set(detail ? (brain?.nodes ?? []).filter((n) => n.in).map((n) => n.id) : []), [brain, detail])

  const near = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const [a, b] of brain?.links ?? []) {
      m.set(a, (m.get(a) ?? new Set()).add(b))
      m.set(b, (m.get(b) ?? new Set()).add(a))
    }
    return m
  }, [brain])

  const was = useRef({ W: 0, H: 0 })
  useEffect(() => {
    if (!brain) return
    const p = pos.current
    for (const id of [...p.keys()]) if (!shown.nodes.some((n) => n.id === id)) p.delete(id)
    // The first picture, and the picture in a card of a new size, are shown at rest. Only a change
    // of the dots themselves is seen, and it is slow (the user's rule, 2026-11-14: the picture
    // jumped and bounced too much).
    const quiet = was.current.W !== W || was.current.H !== H
    for (const q of was.current.W ? p.values() : []) {
      // the picture stays in the middle of a card that changed its size
      q.x += (W - was.current.W) / 2
      q.y += (H - was.current.H) / 2
    }
    was.current = { W, H }
    shown.nodes.forEach((n, i) => {
      // a new dot starts beside one it is linked to, so it grows out of the picture and does not fly in.
      // 36 px away: nearer, the two pushed each other off with a jolt
      const from = [...(near.get(n.id) ?? [])].map((id) => p.get(id)).find((q) => q)
      if (!p.has(n.id)) p.set(n.id, { x: (from?.x ?? W / 2) + 36 * Math.cos(i * 2.4), y: (from?.y ?? H / 2) + 36 * Math.sin(i * 2.4), vx: 0, vy: 0 })
    })
    let heat = quiet ? 1 : 0.6
    let raf = 0
    const ps = shown.nodes.map((n) => p.get(n.id)!)
    const push = shown.nodes.map((n) => (sat.has(n.id) ? 0.2 : 1))
    const tick = () => {
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const dx = ps[i].x - ps[j].x
          const dy = ps[i].y - ps[j].y
          const d2 = dx * dx + dy * dy + 1
          const f = (5200 * push[i] * push[j]) / d2 / Math.sqrt(d2)
          ps[i].vx += dx * f
          ps[i].vy += dy * f
          ps[j].vx -= dx * f
          ps[j].vy -= dy * f
        }
      }
      for (const [a, b] of shown.links) {
        const A = p.get(a)!
        const B = p.get(b)!
        const dx = B.x - A.x
        const dy = B.y - A.y
        const near = sat.has(a) || sat.has(b) // a satellite is held near its dot, on a short and stiff link
        const f = ((near ? 0.12 : 0.05) * (Math.hypot(dx, dy) - (near ? 22 : 84))) / (Math.hypot(dx, dy) + 1)
        A.vx += dx * f
        A.vy += dy * f
        B.vx -= dx * f
        B.vy -= dy * f
      }
      for (const q of ps) {
        // the card is wide and low: the pull to the middle is weaker sideways.
        // A dot keeps 0.55 of its speed: with 0.8 it swung past its place and back
        q.vx = (q.vx + (W / 2 - q.x) * 0.0015) * 0.55
        q.vy = (q.vy + (H / 2 - q.y) * 0.012) * 0.55
        const go = heat * Math.min(1, 6 / Math.hypot(q.vx, q.vy)) // and no dot darts: 6 px a frame at most
        q.x = clamp(q.x + q.vx * go, 60, W - 60)
        q.y = clamp(q.y + q.vy * go, 14, H - 26)
      }
      heat *= quiet ? 0.995 : 0.99 // slower dots need more steps to find their places
    }
    const frame = () => {
      tick()
      setFrame((n) => n + 1)
      if (heat > 0.03) raf = requestAnimationFrame(frame)
    }
    if (quiet) {
      while (heat > 0.03) tick()
      // and in the middle of the card: the pull to the middle is too weak to put it there exactly
      const dx = W / 2 - (Math.min(...ps.map((q) => q.x)) + Math.max(...ps.map((q) => q.x))) / 2
      const dy = H / 2 - (Math.min(...ps.map((q) => q.y)) + Math.max(...ps.map((q) => q.y))) / 2
      for (const q of ps) {
        q.x += dx
        q.y += dy
      }
      setFrame((n) => n + 1)
    } else raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [brain, shown, near, sat, W, H])

  const nodes = shown.nodes.filter((n) => pos.current.has(n.id))
  const lit = (id: string) => !hot || id === hot || !!near.get(hot)?.has(id)
  const hotNode = nodes.find((n) => n.id === hot)
  // the clicked dot goes to the middle, as far as the picture's edges allow: nothing beside the picture is shown
  const at = zoomed ? pos.current.get(zoomed) : undefined
  const PW = W * scale // the picture in pixels
  const PH = H * scale
  const view = at ? `translate(${clamp(PW / 2 - at.x * scale * ZOOM, PW - PW * ZOOM, 0)}px, ${clamp(PH / 2 - at.y * scale * ZOOM, PH - PH * ZOOM, 0)}px) scale(${ZOOM})` : 'translate(0px, 0px) scale(1)'
  const click = (id: string) => {
    if (!detail && holds.has(id)) toggle(id) // the detailed picture has every dot open
    setZoomed((z) => (z === id ? null : id))
  }

  return (
    <Panel
      title="Memory"
      className={className}
      tools={
        <>
          <span className="hr">{sense && sense.worried > 0.6 ? 'sounds worried' : ''}</span>
          <Demo />
        </>
      }
    >
      <div className="memory">
        <svg ref={svg} viewBox={`0 0 ${PW} ${PH}`} role="img" aria-label="What the agent remembers about the person, as a graph of notes and days" onClick={() => setZoomed(null)}>
         <g className="view" style={{ transform: view }}>
          {shown.links.map(([a, b]) => {
            const A = pos.current.get(a)
            const B = pos.current.get(b)
            return A && B ? <line key={`${a}|${b}`} x1={A.x * scale} y1={A.y * scale} x2={B.x * scale} y2={B.y * scale} className={`${sat.has(a) || sat.has(b) ? 'in' : ''} ${hot && (a === hot || b === hot) ? 'hot' : hot ? 'dim' : ''}`} /> : null
          })}
          {nodes.map((n) => {
            const q = pos.current.get(n.id)!
            const x = q.x * scale
            const y = q.y * scale
            const touched = !!sense?.about.includes(n.id)
            // near counts the dots inside too: a dot that holds much is big, also while it is closed.
            // The detailed picture has small dots: more of them fit, and the lines show
            const links = Math.sqrt(near.get(n.id)?.size ?? 0)
            const r = sat.has(n.id) ? 2.2 : detail ? (n.kind === 'person' ? 6 : 2.6 + 0.9 * links) : n.kind === 'person' ? 7 : 3 + 1.4 * links
            const more = !detail && holds.has(n.id)
            // a satellite has its name only while the pointer or the zoom is on it: a hundred names
            // at once are no picture, and a day's twelve lie on each other
            const label = !sat.has(n.id) || touched || n.id === hot || n.id === zoomed ? name(n) : ''
            return (
              <g
                key={n.id}
                className={`${n.kind === 'source' ? 'head' : n.kind} ${lit(n.id) ? '' : 'dim'} ${more ? 'more' : ''}`}
                onMouseEnter={() => setHot(n.id)}
                onMouseLeave={() => setHot(null)}
                role="button"
                tabIndex={0}
                aria-expanded={more ? open.has(n.id) : undefined}
                onClick={(e) => {
                  e.stopPropagation() // the picture's own click goes back to the whole picture
                  click(n.id)
                }}
                onKeyDown={(e: KeyboardEvent<SVGGElement>) => e.key === 'Enter' && click(n.id)}
              >
                <circle cx={x} cy={y} r={r + 6} fill="transparent" />
                {/* what the person's last words touch, says the decisions model */}
                {touched ? <circle className="touched" cx={x} cy={y} r={r + 5} stroke={COLOR[n.kind]} /> : null}
                <circle cx={x} cy={y} r={r} fill={COLOR[n.kind]} />
                <text x={x} y={y + r + (detail ? 14 : 11)} textAnchor="middle">
                  {label}
                </text>
              </g>
            )
          })}
         </g>
        </svg>
        {/* only when there is something to say: the dot under the pointer, or a program that is down */}
        {hotNode || !ag.online ? (
          <p className="memory-said">
            {hotNode ? (
              <>
                <b style={{ color: COLOR[hotNode.kind] }}>{NAME[hotNode.kind]}</b> {hotNode.label}
              </>
            ) : (
              'The agent program does not answer.'
            )}
          </p>
        ) : null}
      </div>
      {children}
    </Panel>
  )
}
