import { useEffect, useState } from 'react'

// A counter that steps every `ms`: the clock for the slow strip charts that mix devices.
export function useTick(ms: number): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setN((v) => v + 1), ms)
    return () => window.clearInterval(t)
  }, [ms])
  return n
}
