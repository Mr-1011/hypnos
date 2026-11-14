import type { ReactNode } from 'react'

export function Panel({ title, tools, children, className = '' }: { title: string; tools?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <header>
        <h2>{title}</h2>
        {tools ? <div className="tools">{tools}</div> : null}
      </header>
      {children}
    </section>
  )
}

export function Seg<T extends string>({ value, options, onChange, labels }: { value: T; options: T[]; onChange: (v: T) => void; labels?: Record<string, string> }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o} className={o === value ? 'on' : ''} onClick={() => onChange(o)}>
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  )
}

export type Tone = 'good' | 'warn' | 'bad' | ''

// A row of big numbers with their names: the live readouts of every tab.
export function Tiles({ items }: { items: { label: string; value: ReactNode; unit?: string; tone?: Tone }[] }) {
  return (
    <div className="tiles">
      {items.map((t) => (
        <div key={t.label} className={`tile ${t.tone ?? ''}`}>
          <span>{t.label}</span>
          <b>
            {t.value}
            {t.unit ? <small>{t.unit}</small> : null}
          </b>
        </div>
      ))}
    </div>
  )
}

export const fmt = (v: unknown, digits = 0): string =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '-'

export const hms = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
