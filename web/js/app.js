import { apiGet, apiPost, api, hasToken } from './api.js';
import { analyzeFaceImage } from './face-analysis.js';
import { base64ToBytes, readPresetFile, downloadBytes, safeFilename } from './file-utils.js';

const root = document.getElementById('app');

const state = {
  status: null,
  library: { presets: [], warnings: [], loading: false },
  photo: null,       // { preview, loading, error, measurements }
  base: null,        // { name, data, classId, characterName }
  strength: 70,
  outputName: 'FaceForge Face',
  result: null,      // { data, applied, skipped, warnings, sha256 }
  panel: null,       // 'calibrate' | 'merge' | null
  calibrate: { base: null, busy: '', error: '', lastLearned: null },
  merge: { donor: null, weight: 50, result: null },
  toasts: []
};

const escapeHTML = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const percent = (value) => `${Math.round(Number(value ?? 0) * 100)}%`;

let toastSequence = 0;

function toast(message, type = 'info') {
  const entry = { id: (toastSequence += 1), message, type };
  state.toasts.push(entry);
  render();
  setTimeout(() => {
    state.toasts = state.toasts.filter((item) => item.id !== entry.id);
    render();
  }, 5200);
}

const controls = () => state.status?.controls ?? [];
const calibrations = () => state.status?.calibrations ?? [];
const calibrationFor = (id) => calibrations().find((entry) => entry.controlId === id) ?? null;
const calibratedCount = () => calibrations().length;

// ---------------------------------------------------------------- rendering

function toastStack() {
  if (state.toasts.length === 0) return '';
  return `<div class="toast-stack">${state.toasts
    .map((item) => `<div class="toast ${item.type === 'error' ? 'error' : item.type === 'success' ? 'success' : ''}">${escapeHTML(item.message)}</div>`)
    .join('')}</div>`;
}

function photoPanel() {
  const photo = state.photo;
  let badge = '';
  if (photo?.loading) badge = 'Analyzing on this PC…';
  else if (photo?.error) badge = photo.error;
  else if (photo) badge = `${percent(photo.measurements.quality.symmetry)} symmetry`;

  return `<div class="panel">
    <div class="panel-header">
      <div><div class="panel-title">1 · Target photo</div><div class="panel-subtitle">Front-facing, neutral expression, whole face visible</div></div>
      ${photo ? '<button class="button ghost compact" data-action="clear-photo">Clear</button>' : ''}
    </div>
    <div class="panel-body stack compact-gap">
      <label class="dropzone compact-drop">
        <input type="file" accept="image/*" class="hidden" data-input="photo">
        ${photo
          ? `<div class="portrait-box"><img src="${photo.preview}" alt="Target face"><span class="portrait-badge">${escapeHTML(badge)}</span></div>`
          : '<div class="portrait-empty"><strong>Choose a photo</strong><br>or drag one onto this box</div>'}
      </label>
      ${photo?.measurements ? measurementList(photo.measurements) : ''}
    </div>
  </div>`;
}

function measurementList(measurements) {
  const rows = controls().map((control) => {
    const value = measurements.normalized[control.metric];
    if (!Number.isFinite(value)) return '';
    return `<div class="slider-row">
      <span class="slider-label">${escapeHTML(control.label)}</span>
      <div class="meter"><span style="width:${Math.round(value * 100)}%"></span></div>
      <span class="slider-value mono">${Math.round(value * 100)}</span>
    </div>`;
  }).join('');
  return `<details class="details-card"><summary>Measured proportions</summary><div class="stack compact-gap">${rows}</div></details>`;
}

function presetOption(item) {
  const selected = state.base?.path === item.path ? ' selected' : '';
  const who = item.characterName ? ` — ${item.characterName}` : '';
  return `<option value="${escapeHTML(item.path)}"${selected}>${escapeHTML(item.name)}${escapeHTML(who)} (class ${item.classId})</option>`;
}

function basePanel() {
  const { presets, loading, warnings } = state.library;
  return `<div class="panel">
    <div class="panel-header">
      <div><div class="panel-title">2 · Starting preset</div><div class="panel-subtitle">A preset that already works in game. Its class, hair, makeup and colours are kept.</div></div>
      <button class="button ghost compact" data-action="scan-library">${loading ? 'Scanning…' : 'Rescan'}</button>
    </div>
    <div class="panel-body stack compact-gap">
      <div class="field">
        <label>From your Black Desert folder</label>
        <select class="input" data-input="base-select">
          <option value="">${presets.length ? 'Choose a preset…' : 'No presets found in that folder'}</option>
          ${presets.map(presetOption).join('')}
        </select>
      </div>
      <label class="button ghost">
        <input type="file" class="hidden" data-input="base-file">Or pick a preset file…
      </label>
      ${state.base
        ? `<div class="file-card"><div class="file-glyph">BD</div><div class="file-meta"><strong>${escapeHTML(state.base.name)}</strong><span>class ${state.base.classId}${state.base.characterName ? ` · saved as ${escapeHTML(state.base.characterName)}` : ''}</span></div></div>`
        : ''}
      ${warnings.length ? `<details class="details-card"><summary>${warnings.length} file(s) skipped</summary><div class="stack compact-gap mono faint">${warnings.map((line) => escapeHTML(line)).join('<br>')}</div></details>` : ''}
    </div>
  </div>`;
}

// calibrationBanner is the app's honesty surface: it must always say exactly how
// many sliders FaceForge can actually drive, never imply more.
function calibrationBanner() {
  const done = calibratedCount();
  const total = controls().length;
  if (done === 0) {
    return `<div class="callout warning">
      <strong>Photo matching needs calibration first.</strong> None of the ${total} sliders are mapped yet, so FaceForge does not know which byte in a BDO preset is the nose width.
      Teach it once — about five minutes in the character creator — and it stays mapped.
      <div class="row-actions"><button class="button primary" data-action="open-calibrate">Calibrate sliders</button></div>
    </div>`;
  }
  if (done < total) {
    return `<div class="callout">
      <strong>${done} of ${total} sliders calibrated.</strong> The photo drives those ${done}; the rest are copied from the starting preset untouched.
      <div class="row-actions"><button class="button compact" data-action="open-calibrate">Calibrate the rest</button></div>
    </div>`;
  }
  return `<div class="callout success"><strong>All ${total} sliders calibrated.</strong> The photo drives every mapped facial proportion.</div>`;
}

function actionPanel() {
  const ready = Boolean(state.photo?.measurements) && Boolean(state.base) && calibratedCount() > 0;
  const reasons = [];
  if (!state.photo?.measurements) reasons.push('an analyzed photo');
  if (!state.base) reasons.push('a starting preset');
  if (calibratedCount() === 0) reasons.push('at least one calibrated slider');

  return `<div class="panel action-panel">
    <div class="panel-body stack compact-gap">
      <div class="field">
        <label>Match strength — how far to move toward the photo (${state.strength}%)</label>
        <input type="range" class="slider" min="0" max="100" value="${state.strength}" data-input="strength">
        <div class="help">100% lands exactly on the measured proportions. 60–80% usually looks more like a BDO character.</div>
      </div>
      <div class="field">
        <label>Save as</label>
        <input class="input" data-input="output-name" value="${escapeHTML(state.outputName)}">
      </div>
      <button class="button primary large-action" data-action="generate"${ready ? '' : ' disabled'}>Create Preset</button>
      ${ready ? '' : `<div class="help">Still needs ${escapeHTML(reasons.join(', '))}.</div>`}
    </div>
  </div>`;
}

function resultPanel() {
  const result = state.result;
  if (!result) {
    return `<div class="panel"><div class="panel-header"><div><div class="panel-title">Result</div><div class="panel-subtitle">Appears here once you create a preset</div></div></div>
      <div class="panel-body"><div class="empty-state">Add a photo and a starting preset, then click <strong>Create Preset</strong>.</div></div></div>`;
  }
  const applied = result.applied ?? [];
  const skipped = result.skipped ?? [];
  const rows = applied.map((item) => `<div class="data-row">
      <div class="data-main"><strong>${escapeHTML(item.label)}</strong><span>byte ${item.offset} · photo said ${Math.round(item.metricValue * 100)} · slider ${item.from} → ${item.to}</span></div>
    </div>`).join('');

  return `<div class="panel">
    <div class="panel-header">
      <div><div class="panel-title">Result</div><div class="panel-subtitle">Validated version 20 preset · ${applied.length} slider(s) driven from the photo</div></div>
      <div class="inline">
        <button class="button primary" data-action="save-result">Save into Black Desert</button>
        <button class="button" data-action="download-result">Download</button>
      </div>
    </div>
    <div class="panel-body stack">
      ${(result.warnings ?? []).map((line) => `<div class="callout warning">${escapeHTML(line)}</div>`).join('')}
      <div class="data-list compact-list">${rows}</div>
      ${skipped.length ? `<details class="details-card"><summary>${skipped.length} slider(s) left untouched</summary><div class="data-list compact-list">${skipped
        .map((item) => `<div class="data-row"><div class="data-main"><strong>${escapeHTML(item.label)}</strong><span>${escapeHTML(item.reason)}</span></div></div>`)
        .join('')}</div></details>` : ''}
      <div class="help">In Black Desert: character creation → Load File → pick <strong>${escapeHTML(safeFilename(state.outputName))}</strong>, then fine-tune by hand.</div>
    </div>
  </div>`;
}

function calibratePanel() {
  if (state.panel !== 'calibrate') {
    return `<button class="button ghost" data-action="open-calibrate">Calibrate sliders (${calibratedCount()} of ${controls().length} done)</button>`;
  }
  const rows = controls().map((control) => {
    const calibration = calibrationFor(control.id);
    const busy = state.calibrate.busy === control.id;
    return `<div class="data-row">
      <div class="data-main">
        <strong>${escapeHTML(control.label)}</strong>
        <span>${escapeHTML(control.section)} · ${escapeHTML(control.instruction)}</span>
        <span class="${calibration ? 'mono' : 'warning-text'}">${calibration
          ? `mapped to byte ${calibration.offset} (class ${calibration.classId})`
          : 'not calibrated'}</span>
      </div>
      <div class="row-actions wrap">
        <label class="button compact${state.calibrate.base ? '' : ' ghost'}">
          <input type="file" class="hidden" data-learn="${escapeHTML(control.id)}"${state.calibrate.base && !busy ? '' : ' disabled'}>
          ${busy ? 'Reading…' : calibration ? 'Redo' : 'Pick maxed save'}
        </label>
        ${calibration ? `<button class="button ghost compact" data-action="forget" data-control="${escapeHTML(control.id)}">Forget</button>` : ''}
      </div>
    </div>`;
  }).join('');

  return `<div class="panel">
    <div class="panel-header">
      <div><div class="panel-title">Calibrate sliders</div><div class="panel-subtitle">Teach FaceForge which byte each slider lives in. Once per install.</div></div>
      <button class="button ghost compact" data-action="close-panel">Close</button>
    </div>
    <div class="panel-body stack">
      <div class="step-list compact">
        <div class="step-item"><div class="step-number">1</div><div><strong>Save a base preset.</strong> In BDO's character creator, save your character as <span class="mono">cal base</span> without changing anything.</div></div>
        <div class="step-item"><div class="step-number">2</div><div><strong>Load that base preset below.</strong></div></div>
        <div class="step-item"><div class="step-number">3</div><div><strong>For one slider:</strong> reload <span class="mono">cal base</span> in game, drag only that slider to its maximum, save under a new name, then pick that file here.</div></div>
        <div class="step-item"><div class="step-number">4</div><div><strong>Repeat</strong> for each slider you care about. Always start from the base again so only one slider differs.</div></div>
      </div>
      <div class="field">
        <label>Base preset (unchanged save)</label>
        <label class="button${state.calibrate.base ? ' ghost' : ' primary'}">
          <input type="file" class="hidden" data-input="calibrate-base">
          ${state.calibrate.base ? `Loaded: ${escapeHTML(state.calibrate.base.name)} — change` : 'Choose the base preset file…'}
        </label>
      </div>
      ${state.calibrate.error ? `<div class="callout danger">${escapeHTML(state.calibrate.error)}</div>` : ''}
      ${state.calibrate.lastLearned ? `<div class="callout success">${escapeHTML(state.calibrate.lastLearned)}</div>` : ''}
      ${state.calibrate.base ? '' : '<div class="callout">Load the base preset first — every calibration is a diff against it.</div>'}
      <div class="data-list">${rows}</div>
    </div>
  </div>`;
}

function mergePanel() {
  if (state.panel !== 'merge') {
    return '<button class="button ghost" data-action="open-merge">Merge two presets</button>';
  }
  const result = state.merge.result;
  return `<div class="panel">
    <div class="panel-header">
      <div><div class="panel-title">Merge two presets</div><div class="panel-subtitle">Mixes only the face and body sliders. Needs no calibration.</div></div>
      <button class="button ghost compact" data-action="close-panel">Close</button>
    </div>
    <div class="panel-body stack compact-gap">
      <div class="help">Base is the starting preset chosen above${state.base ? `: <strong>${escapeHTML(state.base.name)}</strong>` : ' — pick one first.'}</div>
      <label class="button ghost">
        <input type="file" class="hidden" data-input="donor-file">
        ${state.merge.donor ? `Donor: ${escapeHTML(state.merge.donor.name)} — change` : 'Choose the donor preset file…'}
      </label>
      <div class="field">
        <label>Donor weight (${state.merge.weight}%)</label>
        <input type="range" class="slider" min="0" max="100" value="${state.merge.weight}" data-input="merge-weight">
      </div>
      <button class="button primary" data-action="merge"${state.base && state.merge.donor ? '' : ' disabled'}>Merge</button>
      ${result ? `<div class="callout success">${result.changedBytes} slider byte(s) changed.</div>
        <div class="inline"><button class="button primary" data-action="save-merge">Save into Black Desert</button><button class="button" data-action="download-merge">Download</button></div>` : ''}
    </div>
  </div>`;
}

function render() {
  if (!state.status) {
    root.className = 'boot-screen';
    root.innerHTML = '<div class="boot-mark">FF</div><h1>FaceForge BDO</h1><p>Opening the local preset forge…</p>';
    return;
  }
  root.className = 'app-shell';
  root.innerHTML = `
    <header class="topbar">
      <div class="brand"><div class="brand-mark">FF</div><div class="brand-copy"><strong>FaceForge BDO</strong><span>Photo to Black Desert preset, offline</span></div></div>
      <div class="topbar-spacer"></div>
      <div class="status-chip" title="${escapeHTML(state.status.customizationDir)}"><span class="status-dot"></span>${escapeHTML(state.status.customizationDir || 'Local service connected')}</div>
      <button class="button ghost compact" data-action="shutdown">Exit</button>
    </header>
    <main class="main">
      <section class="view compact-view">
        ${calibrationBanner()}
        <div class="grid two">${photoPanel()}${basePanel()}</div>
        ${actionPanel()}
        ${resultPanel()}
        <div class="stack compact-gap">${calibratePanel()}${mergePanel()}</div>
      </section>
    </main>
    ${toastStack()}`;
}

// ------------------------------------------------------------------ actions

async function scanLibrary() {
  state.library.loading = true;
  render();
  try {
    const result = await apiGet('/api/folder/scan', { timeoutMs: 20000 });
    state.library.presets = result.presets ?? [];
    state.library.warnings = result.warnings ?? [];
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    state.library.loading = false;
    render();
  }
}

async function refreshStatus() {
  state.status = await apiGet('/api/status', { timeoutMs: 15000 });
  if (!state.outputName && state.status.customizationDir) state.outputName = 'FaceForge Face';
}

async function loadPhoto(file) {
  const preview = URL.createObjectURL(file);
  state.photo = { preview, loading: true, error: '', measurements: null };
  render();
  try {
    const image = new Image();
    image.src = preview;
    await image.decode();
    const analysis = await analyzeFaceImage(image);
    state.photo = { preview, loading: false, error: '', measurements: analysis.measurements };
    toast('Face measured on this PC.', 'success');
  } catch (error) {
    state.photo = { preview, loading: false, error: error.message, measurements: null };
    toast(error.message, 'error');
  }
  render();
}

async function loadBaseFromLibrary(path) {
  if (!path) {
    state.base = null;
    render();
    return;
  }
  try {
    state.base = await apiPost('/api/folder/read', { path }, { timeoutMs: 15000 });
  } catch (error) {
    toast(error.message, 'error');
  }
  render();
}

// loadPresetFile round-trips a picked file through the service so it is parsed and
// validated before the UI treats it as a preset.
async function loadPresetFile(file) {
  const local = await readPresetFile(file);
  const parsed = await apiPost('/api/inspect', { name: local.name, data: local.data }, { timeoutMs: 15000 });
  return { name: local.name, data: local.data, classId: parsed.classId, characterName: parsed.characterName };
}

async function generate() {
  try {
    const result = await apiPost('/api/generate', {
      base: state.base.data,
      measurements: state.photo.measurements.normalized,
      strength: state.strength / 100,
      name: state.outputName.slice(0, 16)
    }, { timeoutMs: 20000 });
    state.result = result;
    toast(`Preset built from ${result.applied.length} calibrated slider(s).`, 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
  render();
}

async function saveToGame(data, filename) {
  try {
    const result = await apiPost('/api/save', { filename: safeFilename(filename), data }, { timeoutMs: 20000 });
    toast(`Saved to ${result.path}${result.backupPath ? ' (previous file backed up)' : ''}`, 'success');
    await scanLibrary();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function learn(controlId, file) {
  state.calibrate.busy = controlId;
  state.calibrate.error = '';
  state.calibrate.lastLearned = null;
  render();
  try {
    const maxed = await readPresetFile(file);
    const result = await apiPost('/api/learn', {
      controlId,
      base: state.calibrate.base.data,
      baseName: state.calibrate.base.name,
      maxed: maxed.data,
      maxedName: maxed.name,
      commit: true
    }, { timeoutMs: 15000 });
    const control = controls().find((entry) => entry.id === controlId);
    state.calibrate.lastLearned = `${control?.label ?? controlId} is byte ${result.calibration.offset}.`;
    for (const warning of result.warnings ?? []) toast(warning, 'info');
    await refreshStatus();
  } catch (error) {
    state.calibrate.error = error.message;
  } finally {
    state.calibrate.busy = '';
    render();
  }
}

async function merge() {
  try {
    state.merge.result = await apiPost('/api/blend', {
      base: state.base.data,
      donor: state.merge.donor.data,
      weight: state.merge.weight / 100,
      name: state.outputName.slice(0, 16)
    }, { timeoutMs: 20000 });
    toast('Merged preset built.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
  render();
}

async function handleAction(action, element) {
  switch (action) {
    case 'scan-library': await scanLibrary(); break;
    case 'clear-photo': state.photo = null; render(); break;
    case 'open-calibrate': state.panel = 'calibrate'; render(); break;
    case 'open-merge': state.panel = 'merge'; render(); break;
    case 'close-panel': state.panel = null; render(); break;
    case 'generate': await generate(); break;
    case 'save-result': await saveToGame(state.result.data, state.outputName); break;
    case 'download-result':
      downloadBytes(base64ToBytes(state.result.data), safeFilename(state.outputName));
      break;
    case 'save-merge': await saveToGame(state.merge.result.data, `${state.outputName} merge`); break;
    case 'download-merge':
      downloadBytes(base64ToBytes(state.merge.result.data), safeFilename(`${state.outputName} merge`));
      break;
    case 'forget':
      try {
        await api(`/api/slidermap?controlId=${encodeURIComponent(element.dataset.control)}`, { method: 'DELETE', timeoutMs: 10000 });
        await refreshStatus();
        render();
      } catch (error) { toast(error.message, 'error'); }
      break;
    case 'shutdown':
      try { await apiPost('/api/shutdown'); } catch { /* the service may close before replying */ }
      break;
    default: break;
  }
}

// ------------------------------------------------------------------- events

root.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  void handleAction(target.dataset.action, target);
});

root.addEventListener('change', async (event) => {
  const input = event.target;
  const file = input.files?.[0];

  if (input.dataset.input === 'photo' && file) { await loadPhoto(file); return; }
  if (input.dataset.input === 'base-select') { await loadBaseFromLibrary(input.value); return; }
  if (input.dataset.input === 'base-file' && file) {
    try { state.base = await loadPresetFile(file); render(); }
    catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (input.dataset.input === 'calibrate-base' && file) {
    try {
      state.calibrate.base = await loadPresetFile(file);
      state.calibrate.error = '';
      render();
    } catch (error) { state.calibrate.error = error.message; render(); }
    return;
  }
  if (input.dataset.input === 'donor-file' && file) {
    try { state.merge.donor = await loadPresetFile(file); render(); }
    catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (input.dataset.learn && file) { await learn(input.dataset.learn, file); }
});

root.addEventListener('input', (event) => {
  const input = event.target;
  switch (input.dataset.input) {
    case 'strength': {
      state.strength = Number(input.value);
      const label = input.previousElementSibling;
      if (label) label.textContent = `Match strength — how far to move toward the photo (${state.strength}%)`;
      break;
    }
    case 'merge-weight': {
      state.merge.weight = Number(input.value);
      const label = input.previousElementSibling;
      if (label) label.textContent = `Donor weight (${state.merge.weight}%)`;
      break;
    }
    case 'output-name':
      state.outputName = input.value;
      break;
    default: break;
  }
});

// Drag and drop straight onto the window, so the common case is one gesture.
root.addEventListener('dragover', (event) => { event.preventDefault(); });
root.addEventListener('drop', async (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  if (file.type.startsWith('image/')) { await loadPhoto(file); return; }
  try { state.base = await loadPresetFile(file); render(); }
  catch (error) { toast(error.message, 'error'); }
});

async function start() {
  if (!hasToken()) {
    root.className = 'boot-screen';
    root.innerHTML = '<div class="boot-mark">FF</div><h1>FaceForge BDO</h1><p>Launch FaceForge BDO from its EXE so it can hand this window its session token.</p>';
    return;
  }
  try {
    await refreshStatus();
    render();
    await scanLibrary();
  } catch (error) {
    root.className = 'boot-screen';
    root.innerHTML = `<div class="boot-mark">FF</div><h1>FaceForge BDO</h1><p>${escapeHTML(error.message)}</p>`;
  }
}

void start();
