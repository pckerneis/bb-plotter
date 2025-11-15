class BytebeatProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    // Shared state
    this._t = 0
    this._fn = (t) => 0

    // Modern mode: evaluate at device rate with fractional t
    this._step = 8000 / sampleRate // default target 8 kHz

    // Classic mode: emulate rendering at target SR with naive resampling
    this._classic = false
    this._targetRate = 8000
    this._phase = 0
    this._lastRaw = 0
    this._gain = 0.5
    this.port.onmessage = (event) => {
      const { type, expression, sampleRate: targetSampleRate, classic } = event.data || {}
      if (type === 'setExpression' && typeof expression === 'string') {
        try {
          // eslint-disable-next-line no-new-func
          const fnBody = `
const abs = Math.abs;
const sin = Math.sin;
const cos = Math.cos;
const tan = Math.tan;
const asin = Math.asin;
const acos = Math.acos;
const atan = Math.atan;
const floor = Math.floor;
const ceil = Math.ceil;
const round = Math.round;
const sqrt = Math.sqrt;
const log = Math.log;
const exp = Math.exp;
const pow = Math.pow;
const PI = Math.PI;
const TAU = Math.PI * 2;
function plot(x) { return x; }
return Number((${expression})) || 0;
`
          const fn = new Function('t', fnBody)
          this._fn = fn
          const hasTarget =
            typeof targetSampleRate === 'number' && isFinite(targetSampleRate) && targetSampleRate > 0
          if (hasTarget) {
            this._targetRate = targetSampleRate
          }

          this._classic = !!classic

          if (this._classic) {
            // Classic: integer t, sample-and-hold resampling
            // Preserve time counter; only reset resampling phase so the
            // transition is smooth but time base stays continuous.
            this._phase = 0
          } else {
            // Modern: fractional t stepping
            const effectiveRate = hasTarget ? this._targetRate : 8000
            this._step = effectiveRate / sampleRate
          }
        } catch (e) {
          // On compile error, fall back to silence and reset time
          this._fn = () => 0
          this._t = 0
          this._phase = 0
          this._lastRaw = 0
          this._gain = 0
        }
      } else if (type === 'reset') {
        // Explicit reset from main thread (e.g. on Play)
        this._t = 0
        this._phase = 0
      }
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0]
    if (!output || output.length === 0) return true

    const channel = output[0]
    const fn = this._fn
    const gain = this._gain

    if (this._classic) {
      // Classic mode: emulate rendering at target SR then resample to device SR
      // using simple sample-and-hold, which introduces characteristic folding.
      let t = this._t | 0
      let phase = this._phase
      let lastRaw = this._lastRaw | 0
      const ratio = this._targetRate / sampleRate // target samples per device sample

      for (let i = 0; i < channel.length; i += 1) {
        phase += ratio
        if (phase >= 1) {
          const steps = Math.floor(phase)
          phase -= steps
          t += steps
          lastRaw = fn(t) | 0
        }

        const byteValue = lastRaw & 0xff
        channel[i] = ((byteValue - 128) / 128) * gain
      }

      this._t = t
      this._phase = phase
      this._lastRaw = lastRaw
    } else {
      // Modern mode: evaluate expression once per device sample at fractional t
      let t = this._t
      const step = this._step

      for (let i = 0; i < channel.length; i += 1) {
        const raw = fn(t) | 0 // integer sample
        const byteValue = raw & 0xff
        channel[i] = ((byteValue - 128) / 128) * gain
        t += step
      }

      this._t = t
    }
    return true
  }
}

// Required for AudioWorkletProcessor subclasses
registerProcessor('bytebeat-processor', BytebeatProcessor)
