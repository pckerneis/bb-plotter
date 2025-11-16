import "./style.css";
import { expressionApi } from "./expression-api.js";

import {
  validateGithubToken,
  saveProjectToGist,
  loadProjectFromGist,
  listBbPlotterGists,
} from "./github-gist-storage";

import type {
  BbProject,
  BbPlotterGistSummary,
  LoadedProject,
} from "./github-gist-storage";
import { decodePatchFromBase64, encodePatchToBase64 } from "./path-encoding.js";
import { editor, getEditorValue, initialiseEditor } from "./editor.js";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Root element #app not found");
}

const EDITOR_STORAGE_KEY = "bb-editor-code";
const PATCH_PARAM_KEY = "p";


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

initialiseEditor(initialCode);

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
const githubSaveAsModal = document.querySelector<HTMLDivElement>(
  "#bb-github-save-as-modal",
);
const githubSaveAsNameInput = document.querySelector<HTMLInputElement>(
  "#bb-github-save-as-name",
);
const githubSaveAsPublicCheckbox = document.querySelector<HTMLInputElement>(
  "#bb-github-save-as-public",
);
const githubSaveAsModalError = document.querySelector<HTMLParagraphElement>(
  "#bb-github-save-as-modal-error",
);
const githubSaveAsModalCancelButton = document.querySelector<HTMLButtonElement>(
  "#bb-github-save-as-modal-cancel",
);
const githubSaveAsModalConfirmButton = document.querySelector<HTMLButtonElement>(
  "#bb-github-save-as-modal-confirm",
);

let audioContext: AudioContext | null = null;
let bytebeatNode: AudioWorkletNode | null = null;
let gainNode: GainNode | null = null;
let githubToken: string | null = null;
let githubGistId: string | null = null;
let githubLogin: string | null = null;
let githubGistFilename: string | null = null;

try {
  const storedToken = window.sessionStorage.getItem("bb-github-token");
  const storedGistId = window.sessionStorage.getItem("bb-github-gist-id");

  if (storedToken && storedToken.trim()) {
    githubToken = storedToken;
    if (storedGistId && storedGistId.trim()) {
      githubGistId = storedGistId;
    }
  } else {
    githubGistId = null;
    if (storedGistId && storedGistId.trim()) {
      try {
        window.sessionStorage.removeItem("bb-github-gist-id");
      } catch {
        // ignore
      }
    }
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
  const code = getEditorValue();
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
  githubSaveAsButton.addEventListener("click", () => {
    if (!githubToken) {
      openGithubModal();
      return;
    }
    openGithubSaveAsModal();
  });
}

if (githubSaveAsModalConfirmButton && githubSaveAsNameInput) {
  githubSaveAsModalConfirmButton.addEventListener("click", async () => {
    if (!githubToken) {
      openGithubModal();
      return;
    }

    const rawName = githubSaveAsNameInput.value;
    if (!rawName || !rawName.trim()) {
      if (githubSaveAsModalError) {
        githubSaveAsModalError.textContent = "Please enter a name.";
      }
      return;
    }

    let name = rawName.trim().toLowerCase();
    name = name.replace(/[^a-z0-9-]+/g, "-");
    name = name.replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!name) name = "project";
    if (name.length > 40) {
      name = name.slice(0, 40);
    }

    const isPublic = !!githubSaveAsPublicCheckbox?.checked;

    githubSaveAsModalConfirmButton.disabled = true;
    if (githubSaveAsModalError) githubSaveAsModalError.textContent = "Saving...";

    try {
      const project = getCurrentProject();
      const result = await saveProjectToGist(githubToken, project, {
        gistId: null,
        description: rawName,
        public: isPublic,
      });
      githubGistId = result.gistId;
      githubGistFilename = result.filename;
      try {
        window.sessionStorage.setItem("bb-github-gist-id", githubGistId);
      } catch {
        // ignore
      }
      closeGithubSaveAsModal();
      updateGithubUi();
      setInfo(`Saved project as ${rawName}.`);
    } catch (error) {
      console.error("Failed to save project to GitHub Gist", error);
      if (githubSaveAsModalError) {
        githubSaveAsModalError.textContent = "Failed to save project to GitHub.";
      }
    } finally {
      githubSaveAsModalConfirmButton.disabled = false;
    }
  });
}

function setStatus(message: string | null, kind: "error" | "info") {
  if (!errorSpan) return;
  errorSpan.textContent = message ?? "";
  errorSpan.classList.remove("bb-error--error", "bb-error--info");
  if (!message) return;
  if (kind === "error") {
    errorSpan.classList.add("bb-error--error");
  } else {
    errorSpan.classList.add("bb-error--info");
  }
}

function setError(message: string | null) {
  setStatus(message, "error");
}

function setInfo(message: string | null) {
  setStatus(message, "info");
}

function updateGithubUi() {
  const isConnected = !!githubToken;
  const hasGist = !!githubGistId;
  if (githubConnectButton) {
    githubConnectButton.hidden = isConnected;
  }
  if (githubActionsContainer) {
    githubActionsContainer.hidden = !isConnected;
  }
  if (githubSaveButton) {
    githubSaveButton.hidden = !isConnected || !hasGist;
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
  const code = getEditorValue();
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

  setInfo("Compiled");

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

  setInfo("Compiled");

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
    console.error("Failed to start audio playback", error);
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
  const code = getEditorValue();
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

function openGithubSaveAsModal() {
  if (!githubSaveAsModal) return;
  githubSaveAsModal.setAttribute("aria-hidden", "false");
  if (githubSaveAsModalError) githubSaveAsModalError.textContent = "";
  if (githubSaveAsPublicCheckbox) githubSaveAsPublicCheckbox.checked = false;
  if (githubSaveAsNameInput) {
    githubSaveAsNameInput.value = "";
    githubSaveAsNameInput.focus();
  }
}

function closeGithubSaveAsModal() {
  if (!githubSaveAsModal) return;
  githubSaveAsModal.setAttribute("aria-hidden", "true");
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

if (githubSaveAsModalCancelButton) {
  githubSaveAsModalCancelButton.addEventListener("click", () => {
    closeGithubSaveAsModal();
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

      githubGistId = null;
      try {
        window.sessionStorage.removeItem("bb-github-gist-id");
      } catch {
        // ignore
      }

      updateGithubUi();
      closeGithubModal();
      setInfo(
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
        public: false,
        filename: githubGistFilename,
      });
      githubGistId = result.gistId;
      githubGistFilename = result.filename;
      try {
        window.sessionStorage.setItem("bb-github-gist-id", githubGistId);
      } catch {
        // ignore
      }
      setInfo(`Saved to GitHub Gist.`);
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
        "<p class=\"bb-modal-body\">No bytebeat-plotter gists found. Save a project first.</p>";
      return;
    }

    const itemsMarkup = gists
      .map((gist) => {
        const date = new Date(gist.updatedAt);
        const name =
          gist.description && gist.description.trim().length > 0
            ? gist.description
            : "(unnamed project)";
        const baseLabel = `${name} — ${date.toLocaleString()}`;
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
          const loaded: LoadedProject = await loadProjectFromGist(
            githubToken,
            id,
          );
          const project = loaded.project;
          githubGistFilename = loaded.filename;
          githubGistId = id;
          try {
            window.sessionStorage.setItem("bb-github-gist-id", githubGistId);
          } catch {
            // ignore
          }
          applyProject(project);
          setInfo(`Loaded project from GitHub Gist.`);
          updateGithubUi();
          closeGithubLoadModal();
          handleStopClick();
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
    githubGistFilename = null;
    githubLogin = null;
    try {
      window.sessionStorage.removeItem("bb-github-token");
    } catch {
      // ignore
    }
    try {
      window.sessionStorage.removeItem("bb-github-gist-id");
    } catch {
      // ignore
    }
    updateGithubUi();
    setInfo("Disconnected from GitHub.");
  });
}

updateGithubUi();

if (githubToken && githubGistId) {
  (async () => {
    try {
      const loaded: LoadedProject = await loadProjectFromGist(
        githubToken as string,
        githubGistId as string,
      );
      githubGistFilename = loaded.filename;
      applyProject(loaded.project);
      setInfo("Loaded project from last GitHub Gist.");
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
