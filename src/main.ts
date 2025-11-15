import './style.css'
import * as CodeMirror from 'codemirror'
import 'codemirror/lib/codemirror.css'
import 'codemirror/theme/midnight.css'
import 'codemirror/addon/edit/matchbrackets.js'
import 'codemirror/mode/javascript/javascript.js'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Root element #app not found')
}

const EDITOR_STORAGE_KEY = 'bb-editor-code'

app.innerHTML = `
  <main class="bb-root">
    <header class="bb-topbar">
      <div class="bb-topbar-controls">
        <button id="bb-play-button" type="button">Play</button>
        <button id="bb-stop-button" type="button">Stop</button>
        <label class="bb-sr-label" for="bb-sample-rate">SR</label>
        <input
          id="bb-sample-rate"
          class="bb-sr-input"
          type="number"
          min="500"
          max="48000"
          step="500"
          value="8000"
        />
        <label class="bb-classic-label" for="bb-classic">
          <input id="bb-classic" type="checkbox" class="bb-classic-checkbox" />
          Classic
        </label>
        <label class="bb-gain-label" for="bb-gain">
          Gain
          <input
            id="bb-gain"
            class="bb-gain-input"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value="0.5"
          />
          <span id="bb-gain-value" class="bb-gain-value">50%</span>
        </label>
        <span id="bb-error" class="bb-error" aria-live="polite"></span>
      </div>
    </header>
    <section class="bb-editor-shell">
      <div class="bb-editor-container">
        <textarea id="bb-editor" name="bb-editor"></textarea>
      </div>
    </section>
    <div id="bb-plots-container" class="bb-plots-floating">
    </div>
  </main>
`

const editorTextArea = document.querySelector<HTMLTextAreaElement>('#bb-editor')

if (!editorTextArea) {
  throw new Error('Editor textarea #bb-editor not found')
}

// Seed the textarea content so CodeMirror starts with a default expression,
// but prefer any code previously saved in localStorage.
let initialCode = `a=t>>10&7,
plot(a)*t`
try {
  const stored = window.localStorage.getItem(EDITOR_STORAGE_KEY)
  if (stored && typeof stored === 'string') {
    initialCode = stored
  }
} catch {
  // ignore storage errors (e.g. disabled cookies)
}
editorTextArea.value = initialCode

const editor = (CodeMirror as any).fromTextArea(editorTextArea, {
  mode: 'javascript',
  lineNumbers: true,
  theme: 'midnight',
  smartIndent: false,
  electricChars: false,
  matchBrackets: true,
})

const playButton = document.querySelector<HTMLButtonElement>('#bb-play-button')
const stopButton = document.querySelector<HTMLButtonElement>('#bb-stop-button')
const sampleRateInput = document.querySelector<HTMLInputElement>('#bb-sample-rate')
const classicCheckbox = document.querySelector<HTMLInputElement>('#bb-classic')
const gainInput = document.querySelector<HTMLInputElement>('#bb-gain')
const gainValueSpan = document.querySelector<HTMLSpanElement>('#bb-gain-value')
const errorSpan = document.querySelector<HTMLSpanElement>('#bb-error')
const plotsContainer = document.querySelector<HTMLDivElement>('#bb-plots-container')

let audioContext: AudioContext | null = null
let bytebeatNode: AudioWorkletNode | null = null
let gainNode: GainNode | null = null


async function ensureAudioGraph(expression: string, targetSampleRate: number, classic: boolean) {
  if (!audioContext) {
    audioContext = new AudioContext()
    await audioContext.audioWorklet.addModule(new URL('./bytebeat-worklet.js', import.meta.url))
    bytebeatNode = new AudioWorkletNode(audioContext, 'bytebeat-processor')
    gainNode = audioContext.createGain();

    bytebeatNode.connect(gainNode);
    gainNode.gain.value = 0.25;
    gainNode.connect(audioContext.destination);

    // Surface processor errors to the UI without stopping audio
    bytebeatNode.port.onmessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; message?: string } | null
      if (!data || !data.type) return
      if (data.type === 'compileError' || data.type === 'runtimeError') {
        setError(data.message || 'Error in expression.')
      }
    }
  }

  if (!bytebeatNode) return

  bytebeatNode.port.postMessage({ type: 'setExpression', expression, sampleRate: targetSampleRate, classic })
}

function setError(message: string | null) {
  if (!errorSpan) return
  errorSpan.textContent = message ?? ''
}

function extractExpressionFromCode(code: string): string {
  return code
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
    .trim()
}

type AudioParams = {
  expression: string
  targetSampleRate: number
  classic: boolean
}

type PlotConfig = {
  evalFn: (t: number) => { sample: number; plots: number[] }
  windowSize: number
  plotNames: string[]
}

function getAudioParams(): AudioParams | null {
  const code = (editor as any).getValue() as string
  const expression = extractExpressionFromCode(code)

  if (!expression) {
    setError('Expression is empty.')
    return null
  }

  // Compile-check before sending to the audio worklet
  try {
    // eslint-disable-next-line no-new-func
    // We only care that this compiles; result is discarded.
    void new Function('t', `"use strict"; return Number(${expression}) || 0;`)
  } catch (error) {
    setError('Expression does not compile.')
    return null
  }

  setError('Compiled');

  const rawSr = sampleRateInput?.value
  const parsedSr = rawSr ? Number(rawSr) : Number.NaN
  let targetSampleRate = Number.isFinite(parsedSr) ? parsedSr : 8000
  targetSampleRate = Math.min(48000, Math.max(500, Math.floor(targetSampleRate)))

  const classic = !!classicCheckbox?.checked

  return { expression, targetSampleRate, classic }
}

let hotReloadTimer: number | null = null

function scheduleAudioUpdate() {
  if (!audioContext || audioContext.state !== 'running' || !bytebeatNode) {
    return
  }

  if (hotReloadTimer !== null) {
    window.clearTimeout(hotReloadTimer)
  }

  hotReloadTimer = window.setTimeout(() => {
    hotReloadTimer = null
    void updateAudioParams()
  }, 150)
}

async function updateAudioParams() {
  if (!audioContext || !bytebeatNode) return

  const params = getAudioParams()
  if (!params) return

  const { expression, targetSampleRate, classic } = params
  bytebeatNode.port.postMessage({
    type: 'setExpression',
    expression,
    sampleRate: targetSampleRate,
    classic,
  })

  // Clear any previous error once we’ve successfully sent a new expression
  setError('Compiled')

  // Keep realtime plots in sync with the current expression and window
  updatePlotConfigFromCode(targetSampleRate)
  if (!plotAnimationId && audioContext.state === 'running') {
    plotAnimationId = window.requestAnimationFrame(realtimePlotLoop)
  }
}

function buildPlotPath(samples: number[], width: number, height: number): string {
  if (samples.length === 0) return ''

  let min = samples[0]
  let max = samples[0]
  for (const v of samples) {
    if (v < min) min = v
    if (v > max) max = v
  }

  const range = max - min || 1
  const n = samples.length
  let path = ''

  samples.forEach((value, index) => {
    const x = (index / Math.max(1, n - 1)) * width
    const y = height - ((value - min) / range) * height
    path += `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)} `
  })

  return path.trim()
}

function buildPlotConfig(code: string): PlotConfig | null {
  const expression = extractExpressionFromCode(code)

  if (!expression) {
    return null
  }

  // Derive human-friendly plot names from the plot(...) call arguments.
  // We approximate JS evaluation order by collecting inner plot() calls
  // before their parents using a recursive scan.
  const plotNames: string[] = []

  function collectPlotNames(expr: string) {
    for (let i = 0; i < expr.length; i += 1) {
      if (expr.startsWith('plot(', i)) {
        let depth = 0
        const start = i + 'plot('.length
        let end = start
        for (let j = start; j < expr.length; j += 1) {
          const ch = expr[j]
          if (ch === '(') depth += 1
          else if (ch === ')') {
            if (depth === 0) {
              end = j
              break
            }
            depth -= 1
          }
        }

        const arg = expr.slice(start, end)
        // Collect names for any nested plot() inside the argument first
        collectPlotNames(arg)

        const raw = arg.trim()
        plotNames.push(raw || `plot ${plotNames.length + 1}`)

        i = end
      }
    }
  }

  collectPlotNames(expression)

  const fnBody = `
plotState.values.length = 0;
plotState.index = 0;
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
function plot(x) {
  const idx = plotState.index++;
  plotState.values[idx] = Number(x) || 0;
  return x;
}
const sample = (${expression});
return { sample: Number(sample) || 0, plots: plotState.values.slice() };
`

  let inner: (t: number, plotState: { values: number[]; index: number }) => {
    sample: number
    plots: number[]
  }

  try {
    // eslint-disable-next-line no-new-func
    inner = new Function('t', 'plotState', fnBody) as typeof inner
  } catch {
    return null
  }

  const evalFn = (t: number) => {
    const state = { values: [] as number[], index: 0 }
    return inner(t, state)
  }

  const DEFAULT_WINDOW = 8000
  return { evalFn, windowSize: DEFAULT_WINDOW, plotNames }
}

function renderPlots(series: Record<string, number[]>) {
  if (!plotsContainer) return

  const entries = Object.entries(series)
  if (entries.length === 0) {
    plotsContainer.innerHTML = '<p class="bb-placeholder">No data to plot.</p>'
    return
  }

  const width = 400
  const height = 140

  const svgBlocks = entries
    .map(([name, samples]) => {
      if (!samples.length) {
        return `
        <section class="bb-plot">
          <header class="bb-plot-header">${name} (no data)</header>
        </section>`
      }

      let min = samples[0]
      let max = samples[0]
      for (const v of samples) {
        if (v < min) min = v
        if (v > max) max = v
      }
      const minLabel = Number.isFinite(min) ? min : 0
      const maxLabel = Number.isFinite(max) ? max : 0

      const path = buildPlotPath(samples, width, height)
      return `
        <section class="bb-plot">
          <header class="bb-plot-header">${name}<br /><span class="bb-plot-range">min: ${minLabel}</span><span class="bb-plot-range">max: ${maxLabel}</span></header>
          <svg viewBox="0 0 ${width} ${height}" class="bb-plot-svg" role="img" aria-label="Plot of ${name}">
            <path d="${path}" />
          </svg>
        </section>`
    })
    .join('')

  plotsContainer.innerHTML = svgBlocks
}

let currentPlotConfig: PlotConfig | null = null
let plotAnimationId: number | null = null
let lastPlotSampleRate = 8000
let plotStartMs = performance.now()

function updatePlotConfigFromCode(targetSampleRate: number) {
  const code = (editor as any).getValue() as string
  currentPlotConfig = buildPlotConfig(code)
  lastPlotSampleRate = targetSampleRate
  plotStartMs = performance.now()
}

function stopRealtimePlots() {
  if (plotAnimationId !== null) {
    window.cancelAnimationFrame(plotAnimationId)
    plotAnimationId = null
  }
}

function realtimePlotLoop() {
  plotAnimationId = null
  if (!currentPlotConfig) {
    plotAnimationId = window.requestAnimationFrame(realtimePlotLoop)
    return
  }

  const { evalFn, windowSize, plotNames } = currentPlotConfig
  const series: Record<string, number[]> = { sample: [] }
  const plotSeries: number[][] = []

  const now = performance.now()
  const elapsedSeconds = (now - plotStartMs) / 1000
  const baseT = Math.max(0, Math.floor(elapsedSeconds * lastPlotSampleRate) - windowSize + 1)

  try {
    for (let i = 0; i < windowSize; i += 1) {
      const t = baseT + i
      const { sample, plots } = evalFn(t)
      const sampleByte = (Number(sample) || 0) & 0xff
      series.sample.push(sampleByte)
      for (let idx = 0; idx < plots.length; idx += 1) {
        if (!plotSeries[idx]) plotSeries[idx] = []
        plotSeries[idx].push(Number(plots[idx]) || 0)
      }
    }
  } catch {
    // If plotting fails, stop realtime plots but keep audio running
    stopRealtimePlots()
    return
  }

  plotSeries.forEach((values, idx) => {
    const name = plotNames[idx] ?? `plot ${idx + 1}`
    series[name] = values
  })

  renderPlots(series)

  plotAnimationId = window.requestAnimationFrame(realtimePlotLoop)
}

async function handlePlayClick() {
  setError(null)

  const params = getAudioParams()
  if (!params) return

  const { expression, targetSampleRate, classic } = params

  try {
    await ensureAudioGraph(expression, targetSampleRate, classic)
    if (!audioContext) return

    if (audioContext.state === 'suspended') {
      await audioContext.resume()
    }

    if (bytebeatNode) {
      bytebeatNode.port.postMessage({ type: 'reset' })
    }

    updatePlotConfigFromCode(targetSampleRate)
  } catch (error) {
    setError('Failed to start audio playback.')
  }
}

async function handleStopClick() {
  if (!audioContext) return
  try {
    await audioContext.suspend()
  } catch (error) {
    // ignore
  }

  stopRealtimePlots()
}

if (playButton) {
  playButton.addEventListener('click', () => {
    // Fire-and-forget async handler
    void handlePlayClick()
  })
}

// Start realtime plotting loop immediately; it will render whenever a
// valid plot configuration is available.
if (!plotAnimationId) {
  plotAnimationId = window.requestAnimationFrame(realtimePlotLoop)
}
if (stopButton) {
  stopButton.addEventListener('click', () => {
    void handleStopClick()
  })
}

// Hot-reload audio parameters (expression, SR, classic) while audio is running
// and persist the editor contents to localStorage.
;(editor as any).on('change', () => {
  try {
    const code = (editor as any).getValue() as string
    window.localStorage.setItem(EDITOR_STORAGE_KEY, code)
  } catch {
    // ignore storage errors
  }
  scheduleAudioUpdate()
})

if (sampleRateInput) {
  sampleRateInput.addEventListener('change', () => {
    scheduleAudioUpdate()
  })
}

if (classicCheckbox) {
  classicCheckbox.addEventListener('change', () => {
    scheduleAudioUpdate()
  })
}

if (gainInput) {
  gainInput.addEventListener('input', () => {
    const raw = gainInput.value
    const parsed = raw ? Number(raw) : Number.NaN
    
    if (gainValueSpan) {
      let gainPercent = Math.floor(parsed * 100);
      gainValueSpan.textContent = `${gainPercent}%`
    }
    
    if (gainNode) {
      gainNode.gain.value = parsed * parsed;
    }
  })
}
