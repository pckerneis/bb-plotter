import './style.css'
import * as CodeMirror from 'codemirror'
import 'codemirror/lib/codemirror.css'
// @ts-ignore: JavaScript mode does not ship its own type declarations
import 'codemirror/mode/javascript/javascript.js'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Root element #app not found')
}

app.innerHTML = `
  <main class="bb-root">
    <header class="bb-header">
      <h1 class="bb-title">Bytebeat plotter</h1>
      <p class="bb-tagline">Web-based Bytebeat expression player with plotting capabilities.</p>
    </header>
    <section class="bb-layout">
      <div class="bb-editor-panel">
        <h2 class="bb-section-title">Expression editor</h2>
        <div class="bb-editor-container">
          <textarea id="bb-editor" name="bb-editor"></textarea>
        </div>
        <div class="bb-editor-actions">
          <button id="bb-plot-button" type="button">Plot</button>
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
      </div>
      <div class="bb-plots-panel">
        <h2 class="bb-section-title">Plots</h2>
        <div id="bb-plots-container" class="bb-plots-container">
          <p class="bb-placeholder">Waveform and variable plots will be rendered here.</p>
        </div>
      </div>
    </section>
  </main>
`

const editorTextArea = document.querySelector<HTMLTextAreaElement>('#bb-editor')

if (!editorTextArea) {
  throw new Error('Editor textarea #bb-editor not found')
}

const editor = (CodeMirror as any).fromTextArea(editorTextArea, {
  mode: 'javascript',
  lineNumbers: true,
  theme: 'default',
  value: `a = t >> 10, // plot(a)
a * t`,
})

const plotButton = document.querySelector<HTMLButtonElement>('#bb-plot-button')
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

function renderPlots(series: Record<string, number[]>) {
  if (!plotsContainer) return

  const entries = Object.entries(series)
  if (entries.length === 0) {
    plotsContainer.innerHTML = '<p class="bb-placeholder">No data to plot.</p>'
    return
  }

  const width = 360
  const height = 140

  const svgBlocks = entries
    .map(([name, samples]) => {
      const path = buildPlotPath(samples, width, height)
      return `
        <section class="bb-plot">
          <header class="bb-plot-header">${name}</header>
          <svg viewBox="0 0 ${width} ${height}" class="bb-plot-svg" role="img" aria-label="Plot of ${name}">
            <path d="${path}" />
          </svg>
        </section>`
    })
    .join('')

  plotsContainer.innerHTML = svgBlocks
}

function handlePlotClick() {
  setError(null)

  const code = (editor as any).getValue() as string

  // Find variables referenced in comments like // plot(a) or // plot(a,256)
  type PlotRequest = { name: string; window?: number }
  const plotRequests: PlotRequest[] = []
  const plotCommentRegex = /\/\/\s*plot\(\s*([a-zA-Z_$][\w$]*)\s*(?:,\s*(\d+)\s*)?\)/g
  let match: RegExpExecArray | null
  while ((match = plotCommentRegex.exec(code)) !== null) {
    const name = match[1]
    const windowText = match[2]
    const window = windowText ? Number(windowText) : undefined
    plotRequests.push({ name, window })
  }

  const plotVars = Array.from(new Set(plotRequests.map((p) => p.name)))

  // Strip line comments to get a pure expression body
  const expression = code
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
    .trim()

  if (!expression) {
    setError('Expression is empty.')
    renderPlots({})
    return
  }

  const fnBodyLines: string[] = []
  fnBodyLines.push(`const result = (${expression});`)

  const parts: string[] = ['sample: Number(result) || 0']
  for (const v of plotVars) {
    parts.push(`${v}: Number(typeof ${v} !== 'undefined' ? ${v} : 0) || 0`)
  }
  fnBodyLines.push(`return { ${parts.join(', ')} };`)

  let evalFn: (t: number) => Record<string, number>
  try {
    // eslint-disable-next-line no-new-func
    evalFn = new Function('t', fnBodyLines.join('\n')) as (t: number) => Record<string, number>
  } catch (error) {
    setError('Failed to compile expression.')
    renderPlots({})
    return
  }

  // Determine sampling window from plot requests (e.g. // plot(a,256))
  const DEFAULT_WINDOW = 256
  const MIN_WINDOW = 8
  const MAX_WINDOW = 4096
  let windowSize = DEFAULT_WINDOW
  for (const req of plotRequests) {
    if (req.window && Number.isFinite(req.window)) {
      const clamped = Math.min(MAX_WINDOW, Math.max(MIN_WINDOW, Math.floor(req.window)))
      if (clamped > windowSize) {
        windowSize = clamped
      }
    }
  }

  const NUM_SAMPLES = windowSize
  const series: Record<string, number[]> = {}
  series.sample = []
  for (const v of plotVars) {
    series[v] = []
  }

  try {
    for (let t = 0; t < NUM_SAMPLES; t += 1) {
      const result = evalFn(t)
      series.sample.push(Number(result.sample) || 0)
      for (const v of plotVars) {
        const val = result[v]
        series[v].push(Number(val) || 0)
      }
    }
  } catch (error) {
    setError('Error while evaluating expression.')
    renderPlots({})
    return
  }

  renderPlots(series)
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
}

if (plotButton) {
  plotButton.addEventListener('click', handlePlotClick)
}
if (playButton) {
  playButton.addEventListener('click', () => {
    // Fire-and-forget async handler
    void handlePlayClick()
  })
}
if (stopButton) {
  stopButton.addEventListener('click', () => {
    void handleStopClick()
  })
}

// Hot-reload audio parameters (expression, SR, classic) while audio is running
;(editor as any).on('change', () => {
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
