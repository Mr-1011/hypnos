import type { Sample, Stage } from './course'

// A night that never happened, for the demo: the hours of the Sleep State graph before the page
// opened. Two cycles of sleep as a sleep lab scores them, a body that lies still, and two moments:
// after the first REM the person wakes, moves and says a few words; later they turn over and say
// nothing. It is made up: never present it as measured.

// minutes since the night began -> the stage from there on
const STAGES: [number, Stage][] = [
  [0, 'awake'], [6, 'drowsy'], [14, 'light'], [32, 'deep'], [68, 'light'], [80, 'rem'],
  [96, 'awake'], [99, 'drowsy'], [104, 'light'], [128, 'deep'], [152, 'light'],
  [171, 'awake'], [173, 'light'], [186, 'rem'], [212, 'light'],
]

// What each stage adds to the 1/f of a resting brain: [from Hz, to Hz, share of the colour scale].
const EEG: Record<Stage, [number, number, number][]> = {
  awake: [[8, 12, 0.32], [14, 28, 0.16]], // alpha and beta
  drowsy: [[4, 7, 0.22], [8, 11, 0.16]], // alpha gives way to theta
  light: [[1, 3, 0.12], [4, 7, 0.16], [12, 14, 0.28]], // theta, and the sleep spindles
  deep: [[1, 4, 0.4], [9, 32, -0.05]], // slow waves
  rem: [[4, 7, 0.2], [15, 24, 0.14], [1, 3, -0.08]], // fast again, with no slow waves
}

// 1 at `at` minutes, 0 from `len` minutes before and after it
const peak = (min: number, at: number, len: number) => Math.max(0, 1 - Math.abs(min - at) / len)

// n samples, one each stepMs from `from` on; the spectrum has `bins` rows of 1 Hz, from 1 Hz
export function simNight(from: number, n: number, stepMs: number, bins: number): Sample[] {
  const out: Sample[] = []
  const eeg = new Float32Array(bins) // the stage's own rhythm; it comes over some minutes, as in a brain
  const drift = new Float32Array(bins) // each frequency also comes and goes by itself, over a minute or two
  for (let i = 0; i < n; i++) {
    const min = (i * stepMs) / 60_000
    const stage = STAGES.filter(([at]) => at <= min).pop()![1]
    const woke = 0.6 * peak(min, 96.5, 0.6) + 0.45 * peak(min, 97.6, 0.5) + 0.3 * peak(min, 98.6, 0.4) // the first moment
    const turned = 0.5 * peak(min, 171.6, 0.5) + 0.35 * peak(min, 172.3, 0.3) // the second
    const move =
      0.03 + 0.03 * Math.random() + (Math.random() < 0.001 ? 0.12 : 0) + 0.3 * peak(min, 0, 5) + (woke + turned) * (0.7 + 0.6 * Math.random())
    const spec = new Uint8ClampedArray(bins)
    for (let k = 0; k < bins; k++) {
      const want = EEG[stage].reduce((v, [a, b, add]) => (k + 1 >= a && k + 1 <= b ? v + add : v), 0)
      eeg[k] += (want - eeg[k]) * 0.02
      drift[k] = drift[k] * 0.98 + 0.07 * (Math.random() - 0.5)
    }
    for (let k = 0; k < bins; k++) {
      const lo = Math.max(0, k - 1)
      const hi = Math.min(bins - 1, k + 1)
      const rhythm = (eeg[lo] + 2 * eeg[k] + eeg[hi]) / 4 + (drift[lo] + 2 * drift[k] + drift[hi]) / 4 // a band has no sharp edge
      // Loud and slow at the bottom, near silence at 32 Hz: a flatter 1/f was a fog of one colour.
      // The grain is the spread of a spectrum from 2 s of EEG. A body that moves is a stripe over
      // every frequency, as on Patch's spectrogram.
      spec[k] = 255 * (0.6 - (0.55 * Math.log(k + 1)) / Math.log(bins) + rhythm + 0.22 * (Math.random() - 0.5) + 0.5 * (woke + turned))
    }
    out.push({
      t: from + i * stepMs,
      move: Math.min(1, move),
      talk: 0.45 * peak(min, 97.3, 0.7) + 0.35 * peak(min, 98.3, 0.6), // a few sentences, and the agent's answer
      stage,
      spec,
    })
  }
  return out
}
