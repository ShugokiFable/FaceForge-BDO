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

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      switch (key) {
        case 'class':
        case 'className':
          node.className = value;
          break;
        case 'text':
          node.textContent = value;
          break;
        case 'src':
          node.src = value;
          break;
        case 'title':
          node.title = value;
          break;
        case 'value':
          node.value = value;
          break;
        case 'disabled':
          node.disabled = Boolean(value);
          break;
        case 'selected':
          node.selected = Boolean(value);
          break;
        case 'checked':
          node.checked = Boolean(value);
          break;
        case 'htmlFor':
        case 'for':
          node.htmlFor = value;
          break;
        case 'style':
          if (typeof value === 'string') node.style.cssText = value;
          else Object.assign(node.style, value);
          break;
        default:
          node.setAttribute(key, String(value));
      }
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      node.append(document.createTextNode(String(child)));
    } else {
      node.append(child);
    }
  }
  return node;
}

function bootScreen(message) {
  root.className = 'boot-screen';
  root.replaceChildren(
    el('div', { className: 'boot-mark' }, 'FF'),
    el('h1', {}, 'FaceForge BDO'),
    el('p', {}, message)
  );
}

// ---------------------------------------------------------------- rendering

function toastStack() {
  if (state.toasts.length === 0) return null;
  return el(
    'div',
    { className: 'toast-stack' },
    state.toasts.map((item) => el(
      'div',
      { className: `toast${item.type === 'error' ? ' error' : item.type === 'success' ? ' success' : ''}` },
      item.message
    ))
  );
}

function photoPanel() {
  const photo = state.photo;
  let badge = '';
  if (photo?.loading) badge = 'Analyzing on this PC…';
  else if (photo?.error) badge = photo.error;
  else if (photo) badge = `${percent(photo.measurements.quality.symmetry)} symmetry`;

  const dropContents = photo
    ? el('div', { className: 'portrait-box' },
      el('img', { src: photo.preview, alt: 'Target face' }),
      el('span', { className: 'portrait-badge' }, badge))
    : el('div', { className: 'portrait-empty' },
      el('strong', {}, 'Choose a photo'),
      el('br'),
      'or drag one onto this box');

  return el('div', { className: 'panel' },
    el('div', { className: 'panel-header' },
      el('div', {},
        el('div', { className: 'panel-title' }, '1 · Target photo'),
        el('div', { className: 'panel-subtitle' }, 'Front-facing, neutral expression, whole face visible')),
      photo ? el('button', { className: 'button ghost compact', 'data-action': 'clear-photo' }, 'Clear') : null),
    el('div', { className: 'panel-body stack compact-gap' },
      el('label', { className: 'dropzone compact-drop' },
        el('input', { type: 'file', accept: 'image/*', className: 'hidden', 'data-input': 'photo' }),
        dropContents),
      photo?.measurements ? measurementList(photo.measurements) : null));
}

function measurementList(measurements) {
  const rows = controls().map((control) => {
    const value = measurements.normalized[control.metric];
    if (!Number.isFinite(value)) return null;
    return el('div', { className: 'slider-row' },
      el('span', { className: 'slider-label' }, control.label),
      el('div', { className: 'meter' }, el('span', { style: `width:${Math.round(value * 100)}%` })),
      el('span', { className: 'slider-value mono' }, String(Math.round(value * 100))));
  });
  return el('details', { className: 'details-card' },
    el('summary', {}, 'Measured proportions'),
    el('div', { className: 'stack compact-gap' }, rows));
}

function presetOption(item) {
  const selected = state.base?.path === item.path;
  const who = item.characterName ? ` — ${item.characterName}` : '';
  return el('option', { value: item.path, selected }, `${item.name}${who} (class ${item.classId})`);
}

function basePanel() {
  const { presets, loading, warnings } = state.library;
  return el('div', { className: 'panel' },
    el('div', { className: 'panel-header' },
      el('div', {},
        el('div', { className: 'panel-title' }, '2 · Starting preset'),
        el('div', { className: 'panel-subtitle' }, 'A preset that already works in game. Its class, hair, makeup and colours are kept.')),
      el('button', { className: 'button ghost compact', 'data-action': 'scan-library' }, loading ? 'Scanning…' : 'Rescan')),
    el('div', { className: 'panel-body stack compact-gap' },
      el('div', { className: 'field' },
        el('label', {}, 'From your Black Desert folder'),
        el('select', { className: 'input', 'data-input': 'base-select' },
          el('option', { value: '' }, presets.length ? 'Choose a preset…' : 'No presets found in that folder'),
          presets.map(presetOption))),
      el('label', { className: 'button ghost' },
        el('input', { type: 'file', className: 'hidden', 'data-input': 'base-file' }),
        'Or pick a preset file…'),
      state.base
        ? el('div', { className: 'file-card' },
          el('div', { className: 'file-glyph' }, 'BD'),
          el('div', { className: 'file-meta' },
            el('strong', {}, state.base.name),
            el('span', {}, `class ${state.base.classId}${state.base.characterName ? ` · saved as ${state.base.characterName}` : ''}`)))
        : null,
      warnings.length
        ? el('details', { className: 'details-card' },
          el('summary', {}, `${warnings.length} file(s) skipped`),
          el('div', { className: 'stack compact-gap mono faint' },
            warnings.flatMap((line, index) => (index ? [el('br'), line] : [line]))))
        : null));
}

function calibrationBanner() {
  const done = calibratedCount();
  const total = controls().length;
  if (done === 0) {
    return el('div', { className: 'callout warning' },
      el('strong', {}, 'Photo matching needs calibration first. '),
      `None of the ${total} sliders are mapped yet, so FaceForge does not know which byte in a BDO preset is the nose width. Teach it once — about five minutes in the character creator — and it stays mapped.`,
      el('div', { className: 'row-actions' },
        el('button', { className: 'button primary', 'data-action': 'open-calibrate' }, 'Calibrate sliders')));
  }
  if (done < total) {
    return el('div', { className: 'callout' },
      el('strong', {}, `${done} of ${total} sliders calibrated. `),
      `The photo drives those ${done}; the rest are copied from the starting preset untouched.`,
      el('div', { className: 'row-actions' },
        el('button', { className: 'button compact', 'data-action': 'open-calibrate' }, 'Calibrate the rest')));
  }
  return el('div', { className: 'callout success' },
    el('strong', {}, `All ${total} sliders calibrated. `),
    'The photo drives every mapped facial proportion.');
}

function actionPanel() {
  const ready = Boolean(state.photo?.measurements) && Boolean(state.base) && calibratedCount() > 0;
  const reasons = [];
  if (!state.photo?.measurements) reasons.push('an analyzed photo');
  if (!state.base) reasons.push('a starting preset');
  if (calibratedCount() === 0) reasons.push('at least one calibrated slider');

  return el('div', { className: 'panel action-panel' },
    el('div', { className: 'panel-body stack compact-gap' },
      el('div', { className: 'field' },
        el('label', {}, `Match strength — how far to move toward the photo (${state.strength}%)`),
        el('input', { type: 'range', className: 'slider', min: '0', max: '100', value: String(state.strength), 'data-input': 'strength' }),
        el('div', { className: 'help' }, '100% lands exactly on the measured proportions. 60–80% usually looks more like a BDO character.')),
      el('div', { className: 'field' },
        el('label', {}, 'Save as'),
        el('input', { className: 'input', 'data-input': 'output-name', value: state.outputName })),
      el('button', { className: 'button primary large-action', 'data-action': 'generate', disabled: !ready }, 'Create Preset'),
      ready ? null : el('div', { className: 'help' }, `Still needs ${reasons.join(', ')}.`)));
}

function resultPanel() {
  const result = state.result;
  if (!result) {
    return el('div', { className: 'panel' },
      el('div', { className: 'panel-header' },
        el('div', {},
          el('div', { className: 'panel-title' }, 'Result'),
          el('div', { className: 'panel-subtitle' }, 'Appears here once you create a preset'))),
      el('div', { className: 'panel-body' },
        el('div', { className: 'empty-state' },
          'Add a photo and a starting preset, then click ',
          el('strong', {}, 'Create Preset'),
          '.')));
  }
  const applied = result.applied ?? [];
  const skipped = result.skipped ?? [];
  const rows = applied.map((item) => el('div', { className: 'data-row' },
    el('div', { className: 'data-main' },
      el('strong', {}, item.label),
      el('span', {}, `byte ${item.offset} · photo said ${Math.round(item.metricValue * 100)} · slider ${item.from} → ${item.to}`))));

  return el('div', { className: 'panel' },
    el('div', { className: 'panel-header' },
      el('div', {},
        el('div', { className: 'panel-title' }, 'Result'),
        el('div', { className: 'panel-subtitle' }, `Validated version 20 preset · ${applied.length} slider(s) driven from the photo`)),
      el('div', { className: 'inline' },
        el('button', { className: 'button primary', 'data-action': 'save-result' }, 'Save into Black Desert'),
        el('button', { className: 'button', 'data-action': 'download-result' }, 'Download'))),
    el('div', { className: 'panel-body stack' },
      (result.warnings ?? []).map((line) => el('div', { className: 'callout warning' }, line)),
      el('div', { className: 'data-list compact-list' }, rows),
      skipped.length
        ? el('details', { className: 'details-card' },
          el('summary', {}, `${skipped.length} slider(s) left untouched`),
          el('div', { className: 'data-list compact-list' },
            skipped.map((item) => el('div', { className: 'data-row' },
              el('div', { className: 'data-main' },
                el('strong', {}, item.label),
                el('span', {}, item.reason))))))
        : null,
      el('div', { className: 'help' },
        'In Black Desert: character creation → Load File → pick ',
        el('strong', {}, safeFilename(state.outputName)),
        ', then fine-tune by hand.')));
}

function calibratePanel() {
  if (state.panel !== 'calibrate') {
    return el('button', { className: 'button ghost', 'data-action': 'open-calibrate' },
      `Calibrate sliders (${calibratedCount()} of ${controls().length} done)`);
  }
  const rows = controls().map((control) => {
    const calibration = calibrationFor(control.id);
    const busy = state.calibrate.busy === control.id;
    return el('div', { className: 'data-row' },
      el('div', { className: 'data-main' },
        el('strong', {}, control.label),
        el('span', {}, `${control.section} · ${control.instruction}`),
        el('span', { className: calibration ? 'mono' : 'warning-text' },
          calibration ? `mapped to byte ${calibration.offset} (class ${calibration.classId})` : 'not calibrated')),
      el('div', { className: 'row-actions wrap' },
        el('label', { className: `button compact${state.calibrate.base ? '' : ' ghost'}` },
          el('input', {
            type: 'file',
            className: 'hidden',
            'data-learn': control.id,
            disabled: !(state.calibrate.base && !busy)
          }),
          busy ? 'Reading…' : calibration ? 'Redo' : 'Pick maxed save'),
        calibration
          ? el('button', { className: 'button ghost compact', 'data-action': 'forget', 'data-control': control.id }, 'Forget')
          : null));
  });

  return el('div', { className: 'panel' },
    el('div', { className: 'panel-header' },
      el('div', {},
        el('div', { className: 'panel-title' }, 'Calibrate sliders'),
        el('div', { className: 'panel-subtitle' }, 'Teach FaceForge which byte each slider lives in. Once per install.')),
      el('button', { className: 'button ghost compact', 'data-action': 'close-panel' }, 'Close')),
    el('div', { className: 'panel-body stack' },
      el('div', { className: 'step-list compact' },
        el('div', { className: 'step-item' },
          el('div', { className: 'step-number' }, '1'),
          el('div', {}, el('strong', {}, 'Save a base preset. '), 'In BDO\'s character creator, save your character as ', el('span', { className: 'mono' }, 'cal base'), ' without changing anything.')),
        el('div', { className: 'step-item' },
          el('div', { className: 'step-number' }, '2'),
          el('div', {}, el('strong', {}, 'Load that base preset below.'))),
        el('div', { className: 'step-item' },
          el('div', { className: 'step-number' }, '3'),
          el('div', {}, el('strong', {}, 'For one slider: '), 'reload ', el('span', { className: 'mono' }, 'cal base'), ' in game, drag only that slider to its maximum, save under a new name, then pick that file here.')),
        el('div', { className: 'step-item' },
          el('div', { className: 'step-number' }, '4'),
          el('div', {}, el('strong', {}, 'Repeat'), ' for each slider you care about. Always start from the base again so only one slider differs.'))),
      el('div', { className: 'field' },
        el('label', {}, 'Base preset (unchanged save)'),
        el('label', { className: `button${state.calibrate.base ? ' ghost' : ' primary'}` },
          el('input', { type: 'file', className: 'hidden', 'data-input': 'calibrate-base' }),
          state.calibrate.base ? `Loaded: ${state.calibrate.base.name} — change` : 'Choose the base preset file…')),
      state.calibrate.error ? el('div', { className: 'callout danger' }, state.calibrate.error) : null,
      state.calibrate.lastLearned ? el('div', { className: 'callout success' }, state.calibrate.lastLearned) : null,
      state.calibrate.base ? null : el('div', { className: 'callout' }, 'Load the base preset first — every calibration is a diff against it.'),
      el('div', { className: 'data-list' }, rows)));
}

function mergePanel() {
  if (state.panel !== 'merge') {
    return el('button', { className: 'button ghost', 'data-action': 'open-merge' }, 'Merge two presets');
  }
  const result = state.merge.result;
  return el('div', { className: 'panel' },
    el('div', { className: 'panel-header' },
      el('div', {},
        el('div', { className: 'panel-title' }, 'Merge two presets'),
        el('div', { className: 'panel-subtitle' }, 'Mixes only the face and body sliders. Needs no calibration.')),
      el('button', { className: 'button ghost compact', 'data-action': 'close-panel' }, 'Close')),
    el('div', { className: 'panel-body stack compact-gap' },
      el('div', { className: 'help' },
        state.base
          ? ['Base is the starting preset chosen above: ', el('strong', {}, state.base.name)]
          : 'Base is the starting preset chosen above — pick one first.'),
      el('label', { className: 'button ghost' },
        el('input', { type: 'file', className: 'hidden', 'data-input': 'donor-file' }),
        state.merge.donor ? `Donor: ${state.merge.donor.name} — change` : 'Choose the donor preset file…'),
      el('div', { className: 'field' },
        el('label', {}, `Donor weight (${state.merge.weight}%)`),
        el('input', { type: 'range', className: 'slider', min: '0', max: '100', value: String(state.merge.weight), 'data-input': 'merge-weight' })),
      el('button', { className: 'button primary', 'data-action': 'merge', disabled: !(state.base && state.merge.donor) }, 'Merge'),
      result
        ? [
          el('div', { className: 'callout success' }, `${result.changedBytes} slider byte(s) changed.`),
          el('div', { className: 'inline' },
            el('button', { className: 'button primary', 'data-action': 'save-merge' }, 'Save into Black Desert'),
            el('button', { className: 'button', 'data-action': 'download-merge' }, 'Download'))
        ]
        : null));
}

function render() {
  if (!state.status) {
    bootScreen('Opening the local preset forge…');
    return;
  }
  root.className = 'app-shell';
  const dir = state.status.customizationDir || 'Local service connected';
  root.replaceChildren(
    el('header', { className: 'topbar' },
      el('div', { className: 'brand' },
        el('div', { className: 'brand-mark' }, 'FF'),
        el('div', { className: 'brand-copy' },
          el('strong', {}, 'FaceForge BDO'),
          el('span', {}, 'Photo to Black Desert preset, offline'))),
      el('div', { className: 'topbar-spacer' }),
      el('div', { className: 'status-chip', title: dir },
        el('span', { className: 'status-dot' }),
        dir),
      el('button', { className: 'button ghost compact', 'data-action': 'shutdown' }, 'Exit')),
    el('main', { className: 'main' },
      el('section', { className: 'view compact-view' },
        calibrationBanner(),
        el('div', { className: 'grid two' }, photoPanel(), basePanel()),
        actionPanel(),
        resultPanel(),
        el('div', { className: 'stack compact-gap' }, calibratePanel(), mergePanel()))),
    toastStack()
  );
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
    bootScreen('Launch FaceForge BDO from its EXE so it can hand this window its session token.');
    return;
  }
  try {
    await refreshStatus();
    render();
    await scanLibrary();
  } catch (error) {
    bootScreen(error.message);
  }
}

void start();
