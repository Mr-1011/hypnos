import { post } from './sse'

// One Start and one Stop for the three programs: every device that is switched on records under
// one label.

export type Prog = 'band' | 'muse' | 'polar'
export const PROGS: Prog[] = ['band', 'muse', 'polar']

const two = (n: number) => String(n).padStart(2, '0')

export const nightLabel = (d = new Date()) =>
  `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`

type Errors = Partial<Record<Prog, string>>

const failed = (r: any): string | null => (r && (r.ok === true || r.ok === 1) ? null : String(r?.err || r?.error || 'failed'))

async function record(progs: Prog[], on: boolean, label?: string): Promise<Errors> {
  const errors: Errors = {}
  for (const p of progs) {
    const e = failed(await post(`/api/${p}`, '/record', { on, label }))
    if (e) errors[p] = e
  }
  return errors
}

// label: the night that already runs, when `progs` join it late
export const startNight = (progs: Prog[], label = nightLabel()) => record(progs, true, label)

export const stopNight = () => record(PROGS, false)

// Connect all: each program links its remembered device, or the first one a search finds
export async function connectAll(): Promise<Errors> {
  const res = await Promise.all(PROGS.map((p) => post(`/api/${p}`, '/autoconnect')))
  const errors: Errors = {}
  res.forEach((r, i) => {
    const e = failed(r)
    if (e) errors[PROGS[i]] = e
  })
  return errors
}
