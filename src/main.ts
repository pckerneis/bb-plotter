import './style.css';
import {expressionApi} from './expression-api.js';
import {getEditorValue, initialiseEditor} from './editor.js';
import {hasShareUrlParam, loadFromUrl, updateUrlPatchFromUi} from './share-url.ts';
import {setError, setInfo} from './status.ts';
import {loadGitHubInfoFromStorage, setupGitHubUi} from './github-ui.ts';

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Root element #app not found');
}

const EDITOR_STORAGE_KEY = 'bb-editor-code';

let initialCode = `a=plot(t>>10&7),
a*t`;
let initialSampleRate: number | null = null;
let initialClassic: boolean | null = null;
let initialFloat: boolean | null = null;

const initialParams = loadFromUrl();

if (initialParams?.initialCode) initialCode = initialParams.initialCode;
if (initialParams?.initialSampleRate) initialSampleRate = initialParams.initialSampleRate;
if (initialParams?.initialClassic) initialClassic = initialParams.initialClassic;
if (initialParams?.initialFloat) initialFloat = initialParams.initialFloat;

if (!hasShareUrlParam()) {
  try {
    const stored = window.localStorage.getItem(EDITOR_STORAGE_KEY);
    if (stored) {
      initialCode = stored;
    }
  } catch {
    // ignore storage errors (e.g. disabled cookies)
  }
}

initialiseEditor(initialCode, () => {
  try {
    const code = getEditorValue();
    window.localStorage.setItem(EDITOR_STORAGE_KEY, code);
  } catch {
    // ignore storage errors
  }
  updateUrlPatchFromUi();
  scheduleAudioUpdate();
});

const playButton = document.querySelector<HTMLButtonElement>('#bb-play-button');
const sampleRateInput =
    document.querySelector<HTMLInputElement>('#bb-sample-rate');
const classicCheckbox = document.querySelector<HTMLInputElement>('#bb-classic');
const floatCheckbox = document.querySelector<HTMLInputElement>('#bb-float');
const gainInput = document.querySelector<HTMLInputElement>('#bb-gain');
const gainValueSpan = document.querySelector<HTMLSpanElement>('#bb-gain-value');
const plotsContainer = document.querySelector<HTMLDivElement>(
    '#bb-plots-container',
);

let audioContext: AudioContext | null = null;
let bytebeatNode: AudioWorkletNode | null = null;
let gainNode: GainNode | null = null;

loadGitHubInfoFromStorage();

if (sampleRateInput && initialSampleRate !== null) {
  const sr = Math.min(
      48000,
      Math.max(500, Math.floor(Number.isFinite(initialSampleRate) ? initialSampleRate : 8000)),
  );
  sampleRateInput.value = String(sr);
}

if (classicCheckbox && initialClassic !== null) {
  classicCheckbox.checked = initialClassic;
}

if (floatCheckbox && initialFloat !== null) {
  floatCheckbox.checked = initialFloat;
}


async function ensureAudioGraph(
    expression: string,
    targetSampleRate: number,
    classic: boolean,
    float: boolean,
) {
  if (!audioContext) {
    audioContext = new AudioContext();
    await audioContext.audioWorklet.addModule(
        new URL('./bytebeat-worklet.js', import.meta.url),
    );
    bytebeatNode = new AudioWorkletNode(audioContext, 'bytebeat-processor');
    gainNode = audioContext.createGain();

    bytebeatNode.connect(gainNode);
    gainNode.gain.value = 0.25;
    gainNode.connect(audioContext.destination);

    bytebeatNode.port.onmessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; message?: string } | null;
      if (!data || !data.type) return;
      if (data.type === 'compileError' || data.type === 'runtimeError') {
        setError(data.message || 'Error in expression.');
      }
    };
  }

  if (!bytebeatNode) return;

  bytebeatNode.port.postMessage({
    type: 'setExpression',
    expression,
    sampleRate: targetSampleRate,
    classic,
    float,
  });
}

setupGitHubUi();

function extractExpressionFromCode(code: string): string {
  return code
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n')
      .trim();
}

type AudioParams = {
  expression: string;
  targetSampleRate: number;
  classic: boolean;
  float: boolean;
};

type PlotConfig = {
  evalFn: (t: number) => { sample: number; plots: number[] };
  windowSize: number;
  plotNames: string[];
};

function getAudioParams(): AudioParams | null {
  const code = getEditorValue();
  const expression = extractExpressionFromCode(code);

  if (!expression) {
    setError('Expression is empty.');
    return null;
  }

  try {
    void new Function('t', `return Number(${expression}) || 0;`);
  } catch (error) {
    setError('Expression does not compile.');
    console.error(error);
    return null;
  }

  setInfo('Compiled');

  const rawSr = sampleRateInput?.value;
  const parsedSr = rawSr ? Number(rawSr) : Number.NaN;
  let targetSampleRate = Number.isFinite(parsedSr) ? parsedSr : 8000;
  targetSampleRate = Math.min(
      48000,
      Math.max(500, Math.floor(targetSampleRate)),
  );

  const classic = !!classicCheckbox?.checked;
  const float = !!floatCheckbox?.checked;

  return {expression, targetSampleRate, classic, float};
}

let hotReloadTimer: number | null = null;

function scheduleAudioUpdate() {
  if (!audioContext || audioContext.state !== 'running' || !bytebeatNode) {
    return;
  }

  if (hotReloadTimer !== null) {
    window.clearTimeout(hotReloadTimer);
  }

  hotReloadTimer = window.setTimeout(() => {
    hotReloadTimer = null;
    void updateAudioParams();
  }, 150);
}

async function updateAudioParams() {
  if (!audioContext || !bytebeatNode) return;

  const params = getAudioParams();
  if (!params) return;

  const {expression, targetSampleRate, classic, float} = params;
  bytebeatNode.port.postMessage({
    type: 'setExpression',
    expression,
    sampleRate: targetSampleRate,
    classic,
    float,
  });

  setInfo('Compiled');

  updatePlotConfigFromCode(targetSampleRate);

  if (!plotAnimationId && audioContext.state === 'running') {
    plotAnimationId = window.requestAnimationFrame(realtimePlotLoop);
  }
}

function buildPlotPath(
    samples: number[],
    width: number,
    height: number,
): string {
  if (samples.length === 0) return '';

  let min = samples[0];
  let max = samples[0];
  for (const v of samples) {
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const range = max - min || 1;
  const n = samples.length;
  let path = '';

  samples.forEach((value, index) => {
    const x = (index / Math.max(1, n - 1)) * width;
    const y = height - ((value - min) / range) * height;
    path += `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)} `;
  });

  return path.trim();
}

function buildPlotConfig(code: string): PlotConfig | null {
  const expression = extractExpressionFromCode(code);

  if (!expression) {
    return null;
  }

  const plotNames: string[] = [];

  function collectPlotNames(expr: string) {
    for (let i = 0; i < expr.length; i += 1) {
      if (expr.startsWith('plot(', i)) {
        let depth = 0;
        const start = i + 'plot('.length;
        let end = start;
        for (let j = start; j < expr.length; j += 1) {
          const ch = expr[j];
          if (ch === '(') depth += 1;
          else if (ch === ')') {
            if (depth === 0) {
              end = j;
              break;
            }
            depth -= 1;
          }
        }

        const arg = expr.slice(start, end);
        // Collect names for any nested plot() inside the argument first
        collectPlotNames(arg);

        const raw = arg.trim();
        plotNames.push(raw || `plot ${plotNames.length + 1}`);

        i = end;
      }
    }
  }

  collectPlotNames(expression);

  const fnBody = `
${expressionApi}
plotState.values.length = 0;
plotState.index = 0;
function plot(x) {
  const idx = plotState.index++;
  plotState.values[idx] = Number(x) || 0;
  return x;
}
const sample = (${expression});
return { sample: Number(sample) || 0, plots: plotState.values.slice() };
`;

  let inner: (
      t: number,
      plotState: { values: number[]; index: number },
  ) => {
    sample: number;
    plots: number[];
  };

  try {
    inner = new Function('t', 'plotState', fnBody) as typeof inner;
  } catch (error) {
    console.error('Failed to compile plot function', error, fnBody);
    return null;
  }

  const evalFn = (t: number) => {
    const state = {values: [] as number[], index: 0};
    return inner(t, state);
  };

  const DEFAULT_WINDOW = 8000;
  return {evalFn, windowSize: DEFAULT_WINDOW, plotNames};
}

function renderPlots(series: Record<string, number[]>) {
  if (!plotsContainer) return;

  const entries = Object.entries(series);
  if (entries.length === 0) {
    plotsContainer.innerHTML = '<p class="bb-placeholder">No data to plot.</p>';
    return;
  }

  const width = 400;
  const height = 140;

  const svgBlocks = entries
      .map(([name, samples]) => {
        if (!samples.length) {
          return `
        <section class="bb-plot">
          <header class="bb-plot-header">${name} (no data)</header>
        </section>`;
        }

        let min = samples[0];
        let max = samples[0];
        for (const v of samples) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
        const minLabel = Number.isFinite(min) ? min : 0;
        const maxLabel = Number.isFinite(max) ? max : 0;

        const path = buildPlotPath(samples, width, height);
        return `
        <section class="bb-plot">
          <header class="bb-plot-header">${name}<br /><span class="bb-plot-range">min: ${minLabel}</span><span class="bb-plot-range">max: ${maxLabel}</span></header>
          <svg viewBox="0 0 ${width} ${height}" class="bb-plot-svg" role="img" aria-label="Plot of ${name}">
            <path d="${path}" />
          </svg>
        </section>`;
      })
      .join('');

  plotsContainer.innerHTML = svgBlocks;
}

let currentPlotConfig: PlotConfig | null = null;
let plotAnimationId: number | null = null;
let lastPlotSampleRate = 8000;
let plotStartMs = performance.now();

function updatePlotConfigFromCode(targetSampleRate: number) {
  const code = getEditorValue();
  currentPlotConfig = buildPlotConfig(code);
  lastPlotSampleRate = targetSampleRate;
  plotStartMs = performance.now();
}

function realtimePlotLoop() {
  plotAnimationId = null;
  if (!currentPlotConfig) {
    plotAnimationId = window.requestAnimationFrame(realtimePlotLoop);
    return;
  }

  const {evalFn, windowSize, plotNames} = currentPlotConfig;
  const series: Record<string, number[]> = {sample: []};
  const plotSeries: number[][] = [];

  const now = performance.now();
  const elapsedSeconds = (now - plotStartMs) / 1000;
  const baseT = Math.max(
      0,
      Math.floor(elapsedSeconds * lastPlotSampleRate) - windowSize + 1,
  );

  try {
    const isFloat = !!floatCheckbox?.checked;
    for (let i = 0; i < windowSize; i += 1) {
      const t = baseT + i;
      const tArg = isFloat ? t / lastPlotSampleRate : t;
      const {sample, plots} = evalFn(tArg);
      if (isFloat) {
        const s = Number(sample) || 0;
        series.sample.push(s);
      } else {
        const sampleByte = (Number(sample) || 0) & 0xff;
        series.sample.push(sampleByte);
      }
      for (let idx = 0; idx < plots.length; idx += 1) {
        if (!plotSeries[idx]) plotSeries[idx] = [];
        plotSeries[idx].push(Number(plots[idx]) || 0);
      }
    }
  } catch (error) {
    console.error('Error during realtime plotting', error);
    if (plotAnimationId !== null) {
      window.cancelAnimationFrame(plotAnimationId);
      plotAnimationId = null;
    }
    return;
  }

  plotSeries.forEach((values, idx) => {
    const name = plotNames[idx] ?? `plot ${idx + 1}`;
    series[name] = values;
  });

  renderPlots(series);

  plotAnimationId = window.requestAnimationFrame(realtimePlotLoop);
}

async function handlePlayClick() {
  setError(null);

  const params = getAudioParams();
  if (!params) return;

  const {expression, targetSampleRate, classic, float} = params;

  try {
    await ensureAudioGraph(expression, targetSampleRate, classic, float);
    if (!audioContext) return;

    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    if (bytebeatNode) {
      bytebeatNode.port.postMessage({type: 'reset'});
    }

    updatePlotConfigFromCode(targetSampleRate);

    if (!plotAnimationId && audioContext.state === 'running') {
      plotAnimationId = window.requestAnimationFrame(realtimePlotLoop);
    }

    if (playButton) {
      playButton.textContent = 'Stop';
      playButton.classList.add('bb-play-button--active');
    }
  } catch (error) {
    setError('Failed to start audio playback.');
    console.error('Failed to start audio playback', error);
  }
}

async function handleStopClick() {
  if (!audioContext) return;
  try {
    await audioContext.suspend();
  } catch (error) {
    // ignore
  }

  if (plotAnimationId !== null) {
    window.cancelAnimationFrame(plotAnimationId);
    plotAnimationId = null;
  }

  if (playButton) {
    playButton.textContent = 'Play';
    playButton.classList.remove('bb-play-button--active');
  }
}

if (playButton) {
  playButton.addEventListener('click', () => {
    const isRunning = !!audioContext && audioContext.state === 'running';
    if (isRunning) {
      void handleStopClick();
    } else {
      void handlePlayClick();
    }
  });
}

if (sampleRateInput) {
  sampleRateInput.addEventListener('change', () => {
    updateUrlPatchFromUi();
    scheduleAudioUpdate();
  });
}

if (classicCheckbox) {
  classicCheckbox.addEventListener('change', () => {
    updateUrlPatchFromUi();
    scheduleAudioUpdate();
  });
}

if (gainInput) {
  gainInput.addEventListener('input', () => {
    const raw = gainInput.value;
    const parsed = raw ? Number(raw) : Number.NaN;

    if (gainValueSpan) {
      let gainPercent = Math.floor(parsed * 100);
      gainValueSpan.textContent = `${gainPercent}%`;
    }

    if (gainNode) {
      gainNode.gain.value = parsed * parsed;
    }
  });
}

window.addEventListener('keydown', (event: KeyboardEvent) => {
  if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
  if (!(event.code === 'Space' || event.key === ' ')) return;

  event.preventDefault();

  const isRunning = !!audioContext && audioContext.state === 'running';
  if (isRunning) {
    void handleStopClick();
  } else {
    void handlePlayClick();
  }
});
