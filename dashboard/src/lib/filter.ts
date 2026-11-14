// Streaming biquads (RBJ cookbook) for the EEG display filter. Display only: every number the
// page shows comes from live_muse.py, which reads the unfiltered samples.
class Biquad {
  private z1 = 0
  private z2 = 0

  constructor(
    private b0: number,
    private b1: number,
    private b2: number,
    private a1: number,
    private a2: number,
  ) {}

  step(x: number): number {
    const y = this.b0 * x + this.z1
    this.z1 = this.b1 * x - this.a1 * y + this.z2
    this.z2 = this.b2 * x - this.a2 * y
    return y
  }
}

function design(kind: 'hp' | 'lp' | 'notch', f0: number, fs: number, q: number): Biquad {
  const w = (2 * Math.PI * f0) / fs
  const cos = Math.cos(w)
  const alpha = Math.sin(w) / (2 * q)
  const a0 = 1 + alpha
  const [b0, b1, b2] =
    kind === 'hp' ? [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2]
    : kind === 'lp' ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]
    : [1, -2 * cos, 1]
  return new Biquad(b0 / a0, b1 / a0, b2 / a0, (-2 * cos) / a0, (1 - alpha) / a0)
}

export class Chain {
  // The first sample is subtracted from everything, which the high-pass removes anyway: without
  // it a channel sitting at +800 uV starts with a step the filter takes seconds to ring out of.
  private offset = NaN

  constructor(private stages: Biquad[]) {}

  step(x: number): number {
    if (!Number.isFinite(x)) return NaN
    if (Number.isNaN(this.offset)) this.offset = x
    let y = x - this.offset
    for (const s of this.stages) y = s.step(y)
    return y
  }
}

// 1 Hz high-pass, 50 Hz notch, 45 Hz low-pass
export const eegChain = (fs: number) =>
  new Chain([design('hp', 1, fs, Math.SQRT1_2), design('notch', 50, fs, 20), design('lp', 45, fs, Math.SQRT1_2)])
