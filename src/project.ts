import type {BbProject} from './github-gist-storage.ts';
import {getEditorValue, setEditorValue} from './editor.ts';

const sampleRateInput =
    document.querySelector<HTMLInputElement>('#bb-sample-rate');
const classicCheckbox = document.querySelector<HTMLInputElement>('#bb-classic');
const floatCheckbox = document.querySelector<HTMLInputElement>('#bb-float');

export function getCurrentProject(): BbProject {
  const code = getEditorValue();
  const srRaw = sampleRateInput?.value ?? '8000';
  const sampleRate = Number(srRaw) || 8000;
  const classic = !!classicCheckbox?.checked;
  const float = !!floatCheckbox?.checked;
  return {code, sampleRate, classic, float};
}

export function applyProject(project: BbProject) {
  setEditorValue(project.code);
  if (sampleRateInput) sampleRateInput.value = String(project.sampleRate);
  if (classicCheckbox) classicCheckbox.checked = project.classic;
  if (floatCheckbox) floatCheckbox.checked = project.float;
  void updateAudioParams();
}
