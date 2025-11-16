import "./style.css";
import * as CodeMirror from "codemirror";
import "codemirror/lib/codemirror.css";
import "codemirror/theme/midnight.css";
import "codemirror/addon/edit/matchbrackets.js";
import "codemirror/mode/javascript/javascript.js";
import { expressionApi } from "./expression-api.js";

import {
  validateGithubToken,
  saveProjectToGist,
  loadProjectFromGist,
  listBbPlotterGists,
} from "./github-gist-storage";

import type { BbProject, BbPlotterGistSummary } from "./github-gist-storage";
import { decodePatchFromBase64, encodePatchToBase64 } from "./path-encoding.js";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Root element #app not found");
}

const EDITOR_STORAGE_KEY = "bb-editor-code";
const PATCH_PARAM_KEY = "p";



app.innerHTML = `
  <main class="bb-root">
    <header class="bb-topbar">
      <div class="bb-topbar-controls">
        <button id="bb-play-button" class="bb-play-button" type="button">Play</button>
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
          Aliasing
        </label>
        <label class="bb-float-label" for="bb-float">
          <input id="bb-float" type="checkbox" class="bb-float-checkbox" />
          Float
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
      <div class="bb-topbar-actions">
        <button
          id="bb-github-connect"
          class="bb-button bb-button--ghost"
          type="button"
        >
          Connect to GitHub
        </button>
        <div id="bb-github-actions" class="bb-github-actions" hidden>
          <button
            id="bb-github-save"
            class="bb-button"
            type="button"
          >
            Save
          </button>
          <button
            id="bb-github-save-as"
            class="bb-button"
            type="button"
          >
            Save as
          </button>
          <button
            id="bb-github-load"
            class="bb-button"
            type="button"
          >
            Load
          </button>
          <button
            id="bb-github-disconnect"
            class="bb-button bb-button--ghost"
            type="button"
          >
            Disconnect
          </button>
        </div>
      </div>
    </header>
    <section class="bb-editor-shell">
      <div class="bb-editor-container">
        <textarea id="bb-editor" name="bb-editor"></textarea>
      </div>
    </section>
    <div id="bb-plots-container" class="bb-plots-floating">
    </div>
    <div id="bb-github-modal" class="bb-modal" aria-hidden="true">
      <div class="bb-modal-backdrop"></div>
      <div
        class="bb-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bb-github-modal-title"
      >
        <h2 id="bb-github-modal-title" class="bb-modal-title">Connect to GitHub</h2>
        <p class="bb-modal-body">
          Create a <strong>fine-grained personal access token</strong> on GitHub with the
          <code>gist</code> permission, then paste it below. The token is only kept in this
          browser tab and is never stored.
        </p>
        <p class="bb-modal-body">
          Open GitHub token settings:
          <a
            href="https://github.com/settings/tokens?type=beta"
            target="_blank"
            rel="noreferrer"
          >
            github.com/settings/tokens
          </a>
        </p>
        <label class="bb-modal-label" for="bb-github-token-input">
          GitHub token
        </label>
        <input
          id="bb-github-token-input"
          class="bb-modal-input"
          type="password"
          autocomplete="off"
          spellcheck="false"
        />
        <label class="bb-modal-label" for="bb-github-remember-session">
          <input
            id="bb-github-remember-session"
            type="checkbox"
            style="margin-right: 0.35rem;"
          />
          Remember for this session
        </label>
        <p id="bb-github-modal-error" class="bb-modal-error" aria-live="polite"></p>
        <div class="bb-modal-actions">
          <button
            id="bb-github-modal-cancel"
            class="bb-button bb-button--ghost"
            type="button"
          >
            Cancel
          </button>
          <button
            id="bb-github-modal-confirm"
            class="bb-button"
            type="button"
          >
            Connect
          </button>
        </div>
      </div>
    </div>
    <div id="bb-github-load-modal" class="bb-modal" aria-hidden="true">
      <div class="bb-modal-backdrop"></div>
      <div
        class="bb-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bb-github-load-modal-title"
      >
        <h2 id="bb-github-load-modal-title" class="bb-modal-title">Load from GitHub</h2>
        <p class="bb-modal-body">
          Select a <code>bb-plotter</code> project from your GitHub gists.
        </p>
        <div id="bb-github-load-list" class="bb-modal-list"></div>
        <p id="bb-github-load-modal-error" class="bb-modal-error" aria-live="polite"></p>
        <div class="bb-modal-actions">
          <button
            id="bb-github-load-modal-cancel"
            class="bb-button bb-button--ghost"
            type="button"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </main>
`;

const editorTextArea =
  document.querySelector<HTMLTextAreaElement>("#bb-editor");

if (!editorTextArea) {
  throw new Error("Editor textarea #bb-editor not found");
}

let initialCode = `a=plot(t>>10&7),
a*t`;
let initialSampleRate: number | null = null;
let initialClassic: boolean | null = null;
let initialFloat: boolean | null = null;

try {
  const params = new URLSearchParams(window.location.search);
  const rawPatch = params.get(PATCH_PARAM_KEY);
  if (rawPatch) {
    const parsed = decodePatchFromBase64(rawPatch) as
      | {
          code?: unknown;
          sr?: unknown;
          classic?: unknown;
          float?: unknown;
        }
      | null;
    if (parsed) {
      if (typeof parsed.code === "string" && parsed.code.trim().length > 0) {
        initialCode = parsed.code;
      }
      if (typeof parsed.sr === "number" && Number.isFinite(parsed.sr)) {
        initialSampleRate = parsed.sr;
      }
      if (typeof parsed.classic === "boolean") {
        initialClassic = parsed.classic;
      }
      if (typeof parsed.float === "boolean") {
        initialFloat = parsed.float;
      }
    }
  }
} catch {
  // ignore malformed URL patches
}

if (!new URLSearchParams(window.location.search).has(PATCH_PARAM_KEY)) {
  try {
    const stored = window.localStorage.getItem(EDITOR_STORAGE_KEY);
    if (stored && typeof stored === "string") {
      initialCode = stored;
    }
  } catch {
    // ignore storage errors (e.g. disabled cookies)
  }
}

editorTextArea.value = initialCode;

const editor = (CodeMirror as any).fromTextArea(editorTextArea, {
  mode: "javascript",
  lineNumbers: true,
  theme: "midnight",
  smartIndent: false,
  electricChars: false,
  matchBrackets: true,
});

const playButton = document.querySelector<HTMLButtonElement>("#bb-play-button");
const sampleRateInput =
  document.querySelector<HTMLInputElement>("#bb-sample-rate");
const classicCheckbox = document.querySelector<HTMLInputElement>("#bb-classic");
const floatCheckbox = document.querySelector<HTMLInputElement>("#bb-float");
const gainInput = document.querySelector<HTMLInputElement>("#bb-gain");
const gainValueSpan = document.querySelector<HTMLSpanElement>("#bb-gain-value");
const errorSpan = document.querySelector<HTMLSpanElement>("#bb-error");
const plotsContainer = document.querySelector<HTMLDivElement>(
  "#bb-plots-container",
);
const githubConnectButton = document.querySelector<HTMLButtonElement>(
  "#bb-github-connect",
);
const githubActionsContainer = document.querySelector<HTMLDivElement>(
  "#bb-github-actions",
);
const githubSaveButton = document.querySelector<HTMLButtonElement>(
  "#bb-github-save",
);
const githubSaveAsButton = document.querySelector<HTMLButtonElement>(
  "#bb-github-save-as",
);
const githubLoadButton = document.querySelector<HTMLButtonElement>(
  "#bb-github-load",
);
const githubDisconnectButton = document.querySelector<HTMLButtonElement>(
  "#bb-github-disconnect",
);
const githubModal = document.querySelector<HTMLDivElement>("#bb-github-modal");
const githubTokenInput = document.querySelector<HTMLInputElement>(
  "#bb-github-token-input",
);
const githubModalError = document.querySelector<HTMLParagraphElement>(
  "#bb-github-modal-error",
);
const githubModalCancelButton = document.querySelector<HTMLButtonElement>(
  "#bb-github-modal-cancel",
);
const githubModalConfirmButton = document.querySelector<HTMLButtonElement>(
  "#bb-github-modal-confirm",
);
const githubLoadModal = document.querySelector<HTMLDivElement>(
  "#bb-github-load-modal",
);
const githubLoadList = document.querySelector<HTMLDivElement>(
  "#bb-github-load-list",
);
const githubLoadModalError = document.querySelector<HTMLParagraphElement>(
  "#bb-github-load-modal-error",
);
const githubLoadModalCancelButton = document.querySelector<HTMLButtonElement>(
  "#bb-github-load-modal-cancel",
);
const githubRememberSessionCheckbox = document.querySelector<HTMLInputElement>(
  "#bb-github-remember-session",
);

let audioContext: AudioContext | null = null;
let bytebeatNode: AudioWorkletNode | null = null;
let gainNode: GainNode | null = null;
let githubToken: string | null = null;
let githubGistId: string | null = null;
let githubLogin: string | null = null;

try {
  const storedToken = window.sessionStorage.getItem("bb-github-token");
  if (storedToken && storedToken.trim()) {
    githubToken = storedToken;
  }
  const storedGistId = window.sessionStorage.getItem("bb-github-gist-id");
  if (storedGistId && storedGistId.trim()) {
    githubGistId = storedGistId;
  }
} catch {
  // ignore sessionStorage errors
}

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

function getCurrentPatchState(): {
  code: string;
  sr: number;
  classic: boolean;
  float: boolean;
} {
  const code = (editor as any).getValue() as string;
  const rawSr = sampleRateInput?.value;
  const parsedSr = rawSr ? Number(rawSr) : Number.NaN;
  let sr = Number.isFinite(parsedSr) ? parsedSr : 8000;
  sr = Math.min(48000, Math.max(500, Math.floor(sr)));
  const classic = !!classicCheckbox?.checked;
  const float = !!floatCheckbox?.checked;
  return { code, sr, classic, float };
}

function updateUrlPatchFromUi() {
  try {
    const { code, sr, classic, float } = getCurrentPatchState();
    const params = new URLSearchParams(window.location.search);
    const payload = { code, sr, classic, float };
    params.set(PATCH_PARAM_KEY, encodePatchToBase64(payload));
    const query = params.toString();
    const newUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", newUrl);
  } catch {
    // ignore URL serialization errors
  }
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
      new URL("./bytebeat-worklet.js", import.meta.url),
    );
    bytebeatNode = new AudioWorkletNode(audioContext, "bytebeat-processor");
    gainNode = audioContext.createGain();

    bytebeatNode.connect(gainNode);
    gainNode.gain.value = 0.25;
    gainNode.connect(audioContext.destination);

    bytebeatNode.port.onmessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; message?: string } | null;
      if (!data || !data.type) return;
      if (data.type === "compileError" || data.type === "runtimeError") {
        setError(data.message || "Error in expression.");
      }
    };
  }

  if (!bytebeatNode) return;

  bytebeatNode.port.postMessage({
    type: "setExpression",
    expression,
    sampleRate: targetSampleRate,
    classic,
    float,
  });
}

if (githubSaveAsButton) {
  githubSaveAsButton.addEventListener("click", async () => {
    if (!githubToken) {
      openGithubModal();
      return;
    }

    const rawName = window.prompt(
      "Enter a name for this project (used in the GitHub Gist description):",
      "my-project",
    );
    if (!rawName) return;

    let name = rawName.trim().toLowerCase();
    name = name.replace(/[^a-z0-9-]+/g, "-");
    name = name.replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!name) name = "project";
    if (name.length > 40) {
      name = name.slice(0, 40);
    }

    const description = `bb-plotter-${name}`;

    try {
      const project = getCurrentProject();
      const result = await saveProjectToGist(githubToken, project, {
        gistId: null,
        description,
        public: false,
      });
      githubGistId = result.gistId;
      try {
        window.sessionStorage.setItem("bb-github-gist-id", githubGistId);
      } catch {
        // ignore
      }
      setError(`Saved project as ${description}.`);
    } catch (error) {
      console.error("Failed to save project to GitHub Gist", error);
      setError("Failed to save project to GitHub.");
    }
  });
}

function setError(message: string | null) {
  if (!errorSpan) return;
  errorSpan.textContent = message ?? "";
}

function updateGithubUi() {
  const isConnected = !!githubToken;
  if (githubConnectButton) {
    githubConnectButton.hidden = isConnected;
  }
  if (githubActionsContainer) {
    githubActionsContainer.hidden = !isConnected;
  }
}

function extractExpressionFromCode(code: string): string {
  return code
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n")
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
  const code = (editor as any).getValue() as string;
  const expression = extractExpressionFromCode(code);

  if (!expression) {
    setError("Expression is empty.");
    return null;
  }

  try {
    void new Function("t", `return Number(${expression}) || 0;`);
  } catch (error) {
    setError("Expression does not compile.");
    console.error(error);
    return null;
  }

  setError("Compiled");

  const rawSr = sampleRateInput?.value;
  const parsedSr = rawSr ? Number(rawSr) : Number.NaN;
  let targetSampleRate = Number.isFinite(parsedSr) ? parsedSr : 8000;
  targetSampleRate = Math.min(
    48000,
    Math.max(500, Math.floor(targetSampleRate)),
  );

  const classic = !!classicCheckbox?.checked;
  const float = !!floatCheckbox?.checked;

  return { expression, targetSampleRate, classic, float };
}

let hotReloadTimer: number | null = null;

function scheduleAudioUpdate() {
  if (!audioContext || audioContext.state !== "running" || !bytebeatNode) {
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

  const { expression, targetSampleRate, classic, float } = params;
  bytebeatNode.port.postMessage({
    type: "setExpression",
    expression,
    sampleRate: targetSampleRate,
    classic,
    float,
  });

  setError("Compiled");

  updatePlotConfigFromCode(targetSampleRate);

  if (!plotAnimationId && audioContext.state === "running") {
    plotAnimationId = window.requestAnimationFrame(realtimePlotLoop);
  }
}

function buildPlotPath(
  samples: number[],
  width: number,
  height: number,
): string {
  if (samples.length === 0) return "";

  let min = samples[0];
  let max = samples[0];
  for (const v of samples) {
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const range = max - min || 1;
  const n = samples.length;
  let path = "";

  samples.forEach((value, index) => {
    const x = (index / Math.max(1, n - 1)) * width;
    const y = height - ((value - min) / range) * height;
    path += `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)} `;
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
      if (expr.startsWith("plot(", i)) {
        let depth = 0;
        const start = i + "plot(".length;
        let end = start;
        for (let j = start; j < expr.length; j += 1) {
          const ch = expr[j];
          if (ch === "(") depth += 1;
          else if (ch === ")") {
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
    inner = new Function("t", "plotState", fnBody) as typeof inner;
  } catch (error) {
    console.error("Failed to compile plot function", error, fnBody);
    return null;
  }

  const evalFn = (t: number) => {
    const state = { values: [] as number[], index: 0 };
    return inner(t, state);
  };

  const DEFAULT_WINDOW = 8000;
  return { evalFn, windowSize: DEFAULT_WINDOW, plotNames };
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
    .join("");

  plotsContainer.innerHTML = svgBlocks;
}

let currentPlotConfig: PlotConfig | null = null;
let plotAnimationId: number | null = null;
let lastPlotSampleRate = 8000;
let plotStartMs = performance.now();

function updatePlotConfigFromCode(targetSampleRate: number) {
  const code = (editor as any).getValue() as string;
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

  const { evalFn, windowSize, plotNames } = currentPlotConfig;
  const series: Record<string, number[]> = { sample: [] };
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
      const { sample, plots } = evalFn(tArg);
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
    console.error("Error during realtime plotting", error);
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

  const { expression, targetSampleRate, classic, float } = params;

  try {
    await ensureAudioGraph(expression, targetSampleRate, classic, float);
    if (!audioContext) return;

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    if (bytebeatNode) {
      bytebeatNode.port.postMessage({ type: "reset" });
    }

    updatePlotConfigFromCode(targetSampleRate);
    
    if (!plotAnimationId && audioContext.state === "running") {
      plotAnimationId = window.requestAnimationFrame(realtimePlotLoop);
    }

    if (playButton) {
      playButton.textContent = "Stop";
      playButton.classList.add("bb-play-button--active");
    }
  } catch (error) {
    setError("Failed to start audio playback.");
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
    playButton.textContent = "Play";
    playButton.classList.remove("bb-play-button--active");
  }
}

if (playButton) {
  playButton.addEventListener("click", () => {
    const isRunning = !!audioContext && audioContext.state === "running";
    if (isRunning) {
      void handleStopClick();
    } else {
      void handlePlayClick();
    }
  });
}

(editor as any).on("change", () => {
  try {
    const code = (editor as any).getValue() as string;
    window.localStorage.setItem(EDITOR_STORAGE_KEY, code);
  } catch {
    // ignore storage errors
  }
  updateUrlPatchFromUi();
  scheduleAudioUpdate();
});

if (sampleRateInput) {
  sampleRateInput.addEventListener("change", () => {
    updateUrlPatchFromUi();
    scheduleAudioUpdate();
  });
}

if (classicCheckbox) {
  classicCheckbox.addEventListener("change", () => {
    updateUrlPatchFromUi();
    scheduleAudioUpdate();
  });
}

if (gainInput) {
  gainInput.addEventListener("input", () => {
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

window.addEventListener("keydown", (event: KeyboardEvent) => {
  if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
  if (!(event.code === "Space" || event.key === " ")) return;

  event.preventDefault();

  const isRunning = !!audioContext && audioContext.state === "running";
  if (isRunning) {
    void handleStopClick();
  } else {
    void handlePlayClick();
  }
});

function getCurrentProject(): BbProject {
  const code = (editor as any).getValue() as string;
  const srRaw = sampleRateInput?.value ?? "8000";
  const sampleRate = Number(srRaw) || 8000;
  const classic = !!classicCheckbox?.checked;
  const float = !!floatCheckbox?.checked;
  return { code, sampleRate, classic, float };
}

function applyProject(project: BbProject) {
  (editor as any).setValue(project.code);
  if (sampleRateInput) sampleRateInput.value = String(project.sampleRate);
  if (classicCheckbox) classicCheckbox.checked = project.classic;
  if (floatCheckbox) floatCheckbox.checked = project.float;
  updateAudioParams();
}

function openGithubModal() {
  if (!githubModal) return;
  githubModal.setAttribute("aria-hidden", "false");
  if (githubModalError) {
    githubModalError.textContent = "";
  }
  if (githubTokenInput) {
    githubTokenInput.value = "";
    githubTokenInput.focus();
  }
}

function closeGithubModal() {
  if (!githubModal) return;
  githubModal.setAttribute("aria-hidden", "true");
}

function openGithubLoadModal() {
  if (!githubLoadModal) return;
  githubLoadModal.setAttribute("aria-hidden", "false");
}

function closeGithubLoadModal() {
  if (!githubLoadModal) return;
  githubLoadModal.setAttribute("aria-hidden", "true");
}

if (githubConnectButton) {
  githubConnectButton.addEventListener("click", () => {
    openGithubModal();
  });
}

if (githubModalCancelButton) {
  githubModalCancelButton.addEventListener("click", () => {
    closeGithubModal();
  });
}

if (githubLoadModalCancelButton) {
  githubLoadModalCancelButton.addEventListener("click", () => {
    closeGithubLoadModal();
  });
}

if (githubModalConfirmButton && githubTokenInput) {
  githubModalConfirmButton.addEventListener("click", async () => {
    const token = githubTokenInput.value.trim();
    if (!token) {
      if (githubModalError) {
        githubModalError.textContent = "Please paste a GitHub token.";
      }
      return;
    }

    if (githubModalError) {
      githubModalError.textContent = "Validating token...";
    }
    githubModalConfirmButton.disabled = true;

    try {
      const result = await validateGithubToken(token);
      if (!result.ok) {
        if (githubModalError) {
          githubModalError.textContent = result.error;
        }
        return;
      }

      githubToken = token;
      githubLogin = result.login || null;

      if (githubRememberSessionCheckbox?.checked) {
        try {
          window.sessionStorage.setItem("bb-github-token", token);
        } catch {
          // ignore
        }
      } else {
        try {
          window.sessionStorage.removeItem("bb-github-token");
        } catch {
          // ignore
        }
      }

      updateGithubUi();
      closeGithubModal();
      setError(
        githubLogin
          ? `Connected to GitHub as ${githubLogin}.`
          : "Connected to GitHub.",
      );
    } catch {
      if (githubModalError) {
        githubModalError.textContent = "Failed to validate token.";
      }
    } finally {
      githubModalConfirmButton.disabled = false;
    }
  });
}

if (githubSaveButton) {
  githubSaveButton.addEventListener("click", async () => {
    if (!githubToken) {
      openGithubModal();
      return;
    }

    try {
      const project = getCurrentProject();
      const result = await saveProjectToGist(githubToken, project, {
        gistId: githubGistId,
        description: "bb-plotter project",
        public: false,
      });
      githubGistId = result.gistId;
      try {
        window.sessionStorage.setItem("bb-github-gist-id", githubGistId);
      } catch {
        // ignore
      }
      setError(`Saved to GitHub Gist (${githubGistId}).`);
    } catch (error) {
      console.error("Failed to save project to GitHub Gist", error);
      setError("Failed to save project to GitHub.");
    }
  });
}

if (githubLoadButton) {
  githubLoadButton.addEventListener("click", async () => {
    if (!githubToken) {
      openGithubModal();
      return;
    }
    if (!githubLoadList || !githubLoadModal) return;

    githubLoadList.innerHTML = "<p class=\"bb-modal-body\">Loading gists...</p>";
    if (githubLoadModalError) {
      githubLoadModalError.textContent = "";
    }
    openGithubLoadModal();

    let gists: BbPlotterGistSummary[] = [];
    try {
      gists = await listBbPlotterGists(githubToken, { perPage: 50 });
    } catch (error) {
      console.error("Failed to list GitHub gists", error);
      if (githubLoadModalError) {
        githubLoadModalError.textContent =
          "Failed to list GitHub gists. Please try again.";
      }
      githubLoadList.innerHTML = "";
      return;
    }

    if (!gists.length) {
      githubLoadList.innerHTML =
        "<p class=\"bb-modal-body\">No bb-plotter gists found. Save a project first.</p>";
      return;
    }

    const itemsMarkup = gists
      .map((gist) => {
        const date = new Date(gist.updatedAt);
        const baseLabel = `${gist.description || "bb-plotter project"} — ${date.toLocaleString()}`;
        const label =
          githubGistId && gist.id === githubGistId
            ? `${baseLabel} (last used)`
            : baseLabel;
        return `<button class=\"bb-button bb-modal-list-item\" type=\"button\" data-gist-id=\"${gist.id}\">${label}</button>`;
      })
      .join("");

    githubLoadList.innerHTML = itemsMarkup;

    githubLoadList.querySelectorAll<HTMLButtonElement>("[data-gist-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!githubToken) {
          openGithubModal();
          return;
        }

        const id = button.dataset.gistId;
        if (!id) return;

        try {
          const project = await loadProjectFromGist(githubToken, id);
          githubGistId = id;
          try {
            window.sessionStorage.setItem("bb-github-gist-id", githubGistId);
          } catch {
            // ignore
          }
          applyProject(project);
          setError(`Loaded project from GitHub Gist.`);
          closeGithubLoadModal();
        } catch (error) {
          console.error("Failed to load project from GitHub Gist", error);
          if (githubLoadModalError) {
            githubLoadModalError.textContent =
              "Failed to load project from GitHub.";
          }
        }
      });
    });
  });
}

if (githubDisconnectButton) {
  githubDisconnectButton.addEventListener("click", () => {
    githubToken = null;
    githubGistId = null;
    githubLogin = null;
    try {
      window.sessionStorage.removeItem("bb-github-token");
    } catch {
      // ignore
    }
    updateGithubUi();
    setError("Disconnected from GitHub.");
  });
}

updateGithubUi();

if (githubToken && githubGistId) {
  (async () => {
    try {
      const project = await loadProjectFromGist(githubToken as string, githubGistId as string);
      applyProject(project);
      setError("Loaded project from last GitHub Gist.");
    } catch {
      githubGistId = null;
      try {
        window.sessionStorage.removeItem("bb-github-gist-id");
      } catch {
      }
    }
    updateGithubUi();
  })();
} else {
  updateGithubUi();
}
