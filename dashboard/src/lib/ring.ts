// A fixed-size sample history addressed by absolute sample number, so every view can ask for
// "samples i0..i1" without caring where the buffer wrapped. NaN marks a lost sample.
export class Ring {
  readonly buf: Float32Array
  count = 0

  constructor(readonly cap: number) {
    this.buf = new Float32Array(cap).fill(NaN)
  }

  push(v: number) {
    this.buf[this.count % this.cap] = v
    this.count++
  }

  at(i: number): number {
    if (i < 0 || i >= this.count || i < this.count - this.cap) return NaN
    return this.buf[i % this.cap]
  }

  // the newest finite value, or NaN
  last(): number {
    for (let i = this.count - 1; i >= Math.max(0, this.count - 64); i--) {
      const v = this.buf[i % this.cap]
      if (Number.isFinite(v)) return v
    }
    return NaN
  }
}
