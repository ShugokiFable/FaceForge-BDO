import { apiGet, apiPost, hasToken, setToken } from './api.js';
import { analyzeFaceImage } from './face-analysis.js';
import { buildAutomaticPlan } from './create-face.js';
import {
  calibrationMerge,
  createInitialState,
  recipeFromState,
  saveCalibration,
  saveReferenceCatalog,
  upsertReferenceProfile,
  removeReferenceProfile
} from './state.js';
import {
  base64ToBytes,
  downloadBytes,
  downloadText,
  readPresetFile,
  safeFilename
} from './file-utils.js';

const root = document.querySelector('#app');
let state;
let selectedBlock = null;
let toastCounter = 0;

const nav = [
  ['create', 'Create Face', 'image'],
  ['library', 'Preset Library', 'folder'],
  ['tools', 'More Tools', 'tools'],
  ['settings', 'Settings', 'settings']
];

const icons = {
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 4.5-4.5 3 3 2-2 6.5 6.5"/></svg>',
  merge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8 6h5a4 4 0 0 1 0 8H8"/><path d="M16 18H11a4 4 0 0 1 0-8h5"/><path d="M10 12h4"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"/></svg>',
  tools: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14.7 6.3a4 4 0 1 0 3 3l3.8 3.8-2.6 2.6-3.8-3.8a4 4 0 0 0-5.4-5.4l2.1 2.1-2.2 2.2-2.1-2.1a4 4 0 0 0 5.4 5.4"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.07A1.7 1.7 0 0 0 9 19.37a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15 1.7 1.7 0 0 0 3.07 14H3v-4h.07A1.7 1.7 0 0 0 4.63 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63 1.7 1.7 0 0 0 10 3.07V3h4v.07A1.7 1.7 0 0 0 15 4.63a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9 1.7 1.7 0 0 0 20.93 10H21v4h-.07A1.7 1.7 0 0 0 19.4 15z"/></svg>',
  power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2v10M6.3 5.8a8 8 0 1 0 11.4 0"/></svg>',
  inspect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M10 4H4v6"/><path d="M14 20h6v-6"/><path d="M20 10V4h-6"/><path d="M4 14v6h6"/><path d="m9 9 6 6"/></svg>'
};

const escapeHTML = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const shortHash = (hash) => hash ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : 'Unknown';
const confidenceLabel = (value) => value >= .75 ? 'High' : value >= .35 ? 'Medium' : 'Low';

function toast(message, type = 'info') {
  const stack = document.querySelector('.toast-stack') ?? (() => {
    const node = document.createElement('div');
    node.className = 'toast-stack';
    document.body.append(node);
    return node;
  })();
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.dataset.toastId = String(++toastCounter);
  item.textContent = message;
  stack.append(item);
  setTimeout(() => item.remove(), 4800);
}

function addActivity(message, type = 'info') {
  state.activity.unshift({ message, type, at: new Date().toISOString() });
  state.activity = state.activity.slice(0, 20);
}

function activeSidebarView() {
  return ['merge', 'lab', 'calibration'].includes(state.activeView) ? 'tools' : state.activeView;
}

function viewHeader(title, description, actions = '') {
  return `<div class="view-header"><div class="view-title"><h1>${escapeHTML(title)}</h1><p>${escapeHTML(description)}</p></div><div class="header-actions">${actions}</div></div>`;
}

function panelLink(title, body, view, buttonLabel = 'Open') {
  return `<div class="panel home-card"><div class="panel-body stack"><div class="home-card-copy"><h3>${escapeHTML(title)}</h3><p>${escapeHTML(body)}</p></div><button class="button primary" data-nav="${escapeHTML(view)}">${escapeHTML(buttonLabel)}</button></div></div>`;
}

function workflowSteps(items) {
  return `<div class="step-list compact">${items.map((item, index) => `<div class="step-item"><div class="step-number">${index + 1}</div><div><strong>${escapeHTML(item.title)}</strong><span>${escapeHTML(item.text)}</span></div></div>`).join('')}</div>`;
}

function compactProgress(stage) {
  const order = ['input', 'processing', 'result'];
  const currentIndex = order.indexOf(stage === 'reference-required' ? 'input' : stage);
  const labels = [
    ['input', 'Photo'],
    ['processing', 'Preset'],
    ['result', 'Result']
  ];
  return `<div class="progress-strip">${labels.map(([id, label], index) => {
    const isActive = stage === id || (id === 'input' && stage === 'reference-required');
    const isComplete = currentIndex > index;
    return `<div class="progress-pill ${isActive ? 'active' : ''} ${isComplete ? 'complete' : ''}"><span>${index + 1}</span>${escapeHTML(label)}</div>`;
  }).join('')}</div>`;
}

function metricGrid(metrics) {
  const labels = {
    faceAspect: 'Face aspect', eyeSpacing: 'Eye spacing', eyeOpenness: 'Eye openness',
    noseWidth: 'Nose width', mouthWidth: 'Mouth width', jawWidth: 'Jaw width', lowerFace: 'Lower face'
  };
  return `<div class="metric-grid">${Object.entries(metrics).map(([key, value]) => `<div class="metric"><div class="metric-head"><span class="metric-name">${labels[key] ?? key}</span><span class="metric-value">${Math.round(value * 100)}%</span></div><div class="meter"><span style="width:${Math.round(value * 100)}%"></span></div></div>`).join('')}</div>`;
}

function portraitPanel(slot, title, subtitle, detailsCollapsed = true) {
  const portrait = state.portraits[slot];
  const metrics = portrait?.analysis?.measurements?.normalized;
  return `<div class="panel">
    <div class="panel-header"><div><div class="panel-title">${escapeHTML(title)}</div><div class="panel-subtitle">${escapeHTML(subtitle)}</div></div>${portrait ? `<button class="button ghost compact" data-clear-portrait="${slot}">Clear</button>` : ''}</div>
    <div class="panel-body stack compact-gap">
      <label class="portrait-box" data-drop-portrait="${slot}">
        <input class="hidden" type="file" accept="image/*" data-portrait-input="${slot}">
        ${portrait ? `<img src="${portrait.preview}" alt="Analyzed portrait"><span class="portrait-badge">${portrait.loading ? 'Analyzing locally…' : portrait.error ? escapeHTML(portrait.error) : `${Math.round((portrait.analysis?.measurements?.quality?.symmetry ?? 0) * 100)}% symmetry`}</span>` : `<div class="portrait-empty"><strong>Choose an image</strong><br>Front-facing, neutral expression, full face visible</div>`}
      </label>
      ${metrics ? (detailsCollapsed ? `<details class="details-card"><summary>Image details</summary>${metricGrid(metrics)}</details>` : metricGrid(metrics)) : ''}
    </div>
  </div>`;
}

function presetCard(slot, title, subtitle) {
  const item = state.presets[slot];
  return `<div class="panel">
    <div class="panel-header"><div><div class="panel-title">${escapeHTML(title)}</div><div class="panel-subtitle">${escapeHTML(subtitle)}</div></div>${item ? `<button class="button ghost compact" data-clear-preset="${slot}">Clear</button>` : ''}</div>
    <div class="panel-body">
      <label class="dropzone compact-drop" data-drop-preset="${slot}">
        <input type="file" data-preset-input="${slot}">
        ${item ? `<div class="file-card"><div class="file-glyph">BDO</div><div class="file-meta"><strong>${escapeHTML(item.name)}</strong><span>${renderPresetSummary(item)}</span></div><span class="muted">Change</span></div>` : `<div><strong>Drop a BDO preset here</strong><small>Or click to choose a 924-byte customization file</small></div>`}
      </label>
    </div>
  </div>`;
}

function renderPresetSummary(item) {
  const profile = getProfileForPreset(item);
  const classLabel = item.inspect?.classFingerprint ? shortHash(item.inspect.classFingerprint) : 'Unknown class';
  const profiled = profile ? '· library profile ready' : '· no screenshot profile';
  return `v${item.inspect?.version ?? '?'} · ${classLabel} ${profiled}`;
}

function outputFileName() {
  return safeFilename(state.settings.outputFilename || state.createFace.result?.name || 'FaceForge BDO Preset');
}

function createDisabledReason() {
  if (!state.portraits.target?.analysis) return 'Add a target photo.';
  if (!state.presets.base) return 'Add a starting preset.';
  return '';
}

function createResultPanel() {
  const flow = state.createFace;
  const result = flow.result;
  if (!result) return '';
  const plan = flow.autoPlan;
  const warnings = [...(result.warnings ?? []), ...(flow.warnings ?? [])];
  return `<div class="panel">
    <div class="panel-header"><div><div class="panel-title">Generated result</div><div class="panel-subtitle">Validated version 20 preset · ${result.changedBlocks.length} blocks changed</div></div><div class="inline"><button class="button primary" data-action="save-create-result">Save to BDO</button><button class="button" data-action="download-create-result">Download Preset</button></div></div>
    <div class="panel-body stack">
      <div class="summary-strip triple"><div class="summary-stat"><span>Confidence</span><strong>${escapeHTML(plan?.summary ?? 'Unknown')}</strong></div><div class="summary-stat"><span>References used</span><strong>${flow.candidates.length}</strong></div><div class="summary-stat"><span>Changed groups</span><strong>${Object.entries(plan?.groups ?? {}).filter(([, group]) => Number(group.weight) > 0).length}</strong></div></div>
      ${warnings.length ? warnings.map((warning) => `<div class="callout warning">${escapeHTML(warning)}</div>`).join('') : '<div class="callout success">Same-class automatic blending completed and the result passed binary validation.</div>'}
      <div class="panel panel-flat"><div class="panel-header"><div><div class="panel-title">References selected</div><div class="panel-subtitle">Closest profiled presets from your local library</div></div></div><div class="panel-body"><div class="data-list compact-list">${flow.candidates.map((candidate, index) => `<div class="data-row"><div class="data-main"><strong>${index + 1}. ${escapeHTML(candidate.name)}</strong><span>${shortHash(candidate.sha256)} · overall distance ${candidate.overallDistance.toFixed(3)}</span></div></div>`).join('')}</div></div></div>
      <div class="inline"><button class="button" data-action="toggle-adjustments">${flow.adjustmentsOpen ? 'Hide Adjust Result' : 'Adjust Result'}</button><button class="button ghost" data-action="start-over-create">Start over</button></div>
      ${flow.adjustmentsOpen ? renderAdjustmentsPanel() : ''}
    </div>
  </div>`;
}

function renderAdjustmentsPanel() {
  const groups = (state.status.groups ?? []).filter((group) => !group.protected);
  const plan = state.createFace.autoPlan;
  return `<div class="panel panel-flat"><div class="panel-header"><div><div class="panel-title">Adjust result</div><div class="panel-subtitle">Unsupported groups stay at 0% until you change them.</div></div><button class="button compact" data-action="rebuild-create-result">Rebuild Result</button></div><div class="panel-body">${groups.map((group) => {
    const suggestion = plan?.groups?.[group.id] ?? { weight: 0, donorName: 'Reference 1', confidence: 0 };
    return `<div class="slider-row"><div class="slider-label"><strong>${escapeHTML(group.name)}</strong><span>${escapeHTML(suggestion.donorName ?? 'Reference')} · ${confidenceLabel(suggestion.confidence ?? 0)} confidence</span></div><input class="slider" type="range" min="0" max="100" step="1" value="${Math.round(suggestion.weight ?? 0)}" data-create-weight="${group.id}"><div class="slider-value">${Math.round(suggestion.weight ?? 0)}%</div></div>`;
  }).join('')}</div></div>`;
}

function renderReferenceRequiredPanel() {
  const reason = state.createFace.referenceNeeded ?? 'FaceForge needs at least one screenshot-linked preset for this class before it can match a photo honestly.';
  return `<div class="panel"><div class="panel-header"><div><div class="panel-title">Reference screenshot needed</div><div class="panel-subtitle">One quick setup step unlocks automatic photo matching for this class</div></div></div><div class="panel-body stack"><div class="callout warning">${escapeHTML(reason)}</div><div class="inline"><button class="button primary" data-action="open-library-profile-help">Open Preset Library</button><button class="button" data-nav="merge">Use Manual Merge</button></div></div></div>`;
}

function renderCreateFace() {
  const disabledReason = createDisabledReason();
  return `<section class="view compact-view">
    ${viewHeader('Create Face', 'Choose a target face photo and a starting preset, then let FaceForge generate a same-class result from your profiled local library.', '')}
    ${compactProgress(state.createFace.stage)}
    <div class="spacer"></div>
    <div class="callout">Normal path: <strong>photo + starting preset → Create Face Preset → Save to BDO</strong>. Manual preset mixing still lives under <strong>More Tools</strong>.</div>
    <div class="spacer"></div>
    <div class="grid compact-create-grid">
      ${portraitPanel('target', 'Target photo', 'The real or fictional face you want to approximate.', true)}
      ${presetCard('base', 'Starting preset', 'Required. The class identity and protected metadata stay from this file.')}
    </div>
    <div class="spacer"></div>
    <div class="panel"><div class="panel-body inline grow-between"><div class="stack compact-gap"><strong>Create a result</strong><span class="help">Only the target photo and starting preset are required.</span>${disabledReason ? `<span class="help warning-text">${escapeHTML(disabledReason)}</span>` : ''}</div><button class="button primary large-action" data-action="create-face" ${disabledReason ? 'disabled' : ''}>Create Face Preset</button></div></div>
    ${state.createFace.stage === 'processing' ? `<div class="spacer"></div><div class="panel"><div class="panel-body">${workflowSteps([{ title: 'Analyze target face', text: 'Profile facial proportions from the target photo.' }, { title: 'Scan compatible references', text: 'Search your same-class profiled local presets.' }, { title: 'Choose reference blend', text: 'Pick the best per-group references.' }, { title: 'Build and validate preset', text: 'Generate a valid version 20 BDO preset.' }])}<div class="spacer"></div><div class="callout">${escapeHTML(state.createFace.processingStep || 'Working...')}</div></div></div>` : ''}
    ${state.createFace.stage === 'reference-required' ? `<div class="spacer"></div>${renderReferenceRequiredPanel()}` : ''}
    ${state.createFace.stage === 'result' ? `<div class="spacer"></div>${createResultPanel()}` : ''}
  </section>`;
}

function renderQuickMixButtons() {
  const values = [0, 25, 50, 75, 100];
  return `<div class="inline quick-mix">${values.map((value) => `<button class="button compact" data-action="mix-${value}">${value === 0 ? 'Keep start' : value === 100 ? 'Use borrow' : `${value}/${100 - value}`}</button>`).join('')}</div>`;
}

function renderMerge() {
  const groups = (state.status.groups ?? []).filter((group) => !group.protected);
  const ready = state.presets.base && state.presets.donor;
  const result = state.blend.result;
  return `<section class="view compact-view">
    ${viewHeader('Merge Presets', 'Combine two existing presets together. This remains a separate manual workflow.', `<button class="button primary" data-action="generate" ${ready ? '' : 'disabled'}>Create merged preset</button>`)}
    <div class="callout success">Use this when you want full manual control. Create Face is now the simpler photo workflow.</div>
    <div class="spacer"></div>
    <div class="grid two">${presetCard('base', 'Starting preset', 'Required. Protected class and metadata stay from this file.')} ${presetCard('donor', 'Preset to borrow from', 'Required. FaceForge copies feature blocks from this file.')}</div>
    <div class="spacer"></div>
    <div class="grid sidebar-main"><div class="panel"><div class="panel-header"><div><div class="panel-title">Merge controls</div><div class="panel-subtitle">Start simple, then fine-tune if needed</div></div></div><div class="panel-body stack"><div class="field"><label for="blend-seed">Deterministic seed</label><input id="blend-seed" class="input" data-setting="blend-seed" value="${escapeHTML(state.blend.seed)}"><div class="help">Same files, weights, and seed always produce the same binary output.</div></div><div class="field"><label>Quick mixes</label>${renderQuickMixButtons()}</div><label class="toggle"><input type="checkbox" data-setting="cross-class" ${state.blend.allowCrossClass ? 'checked' : ''}><span>Enable experimental cross-class transplanting</span></label><div class="callout warning">Cross-class results may deform or fail in-game. The class identity block still stays with the starting preset.</div></div></div><div class="panel"><div class="panel-header"><div><div class="panel-title">Feature weights</div><div class="panel-subtitle">0% keeps the starting preset. 100% copies the borrowed feature blocks.</div></div><button class="button compact" data-action="reset-weights">Reset 50/50</button></div><div class="panel-body">${groups.map((group) => `<div class="slider-row"><div class="slider-label"><strong>${escapeHTML(group.name)}</strong><span>${escapeHTML(group.description)}</span></div><input class="slider" type="range" min="0" max="100" step="1" value="${state.blend.weights[group.id] ?? 50}" data-weight="${group.id}"><div class="slider-value">${Math.round(state.blend.weights[group.id] ?? 50)}%</div></div>`).join('')}</div></div></div>
    ${result ? `<div class="spacer"></div>${resultPanel(result, 'merge')}` : ''}
  </section>`;
}

function resultPanel(result, mode = 'merge') {
  const saveAction = mode === 'create' ? 'save-create-result' : 'save-result';
  const downloadAction = mode === 'create' ? 'download-create-result' : 'download-result';
  return `<div class="panel"><div class="panel-header"><div><div class="panel-title">Generated preset</div><div class="panel-subtitle">Valid version 20 binary · ${result.changedBlocks.length} blocks changed</div></div><div class="inline"><button class="button" data-action="download-sidecar">Download report</button><button class="button primary" data-action="${downloadAction}">Download preset</button></div></div><div class="panel-body"><div class="summary-strip"><div class="summary-stat"><span>SHA-256</span><strong title="${escapeHTML(result.sha256)}">${shortHash(result.sha256)}</strong></div><div class="summary-stat"><span>Changed blocks</span><strong>${result.changedBlocks.length}</strong></div><div class="summary-stat"><span>Starting class</span><strong>${escapeHTML(state.presets.base?.inspect?.classFingerprint ?? 'Unknown')}</strong></div><div class="summary-stat"><span>Safety</span><strong>${state.blend.allowCrossClass ? 'Experimental' : 'Same class'}</strong></div></div>${result.warnings?.length ? result.warnings.map((warning) => `<div class="callout warning">${escapeHTML(warning)}</div>`).join('') : '<div class="callout success">Protected metadata and class identity were preserved from the starting preset.</div>'}<div class="spacer"></div><div class="inline"><input class="input" style="max-width:360px" data-setting="output-filename" value="${escapeHTML(state.settings.outputFilename)}"><button class="button primary" data-action="${saveAction}">Save into BDO folder</button></div></div></div>`;
}

function renderTools() {
  return `<section class="view compact-view">
    ${viewHeader('More Tools', 'Manual and diagnostic workflows stay available, but they no longer interrupt the normal Create Face path.', '')}
    <div class="grid three home-grid">${panelLink('Merge Presets', 'Blend two preset files manually and fine-tune each feature group.', 'merge', 'Open Merge')} ${panelLink('Preset Laboratory', 'Inspect block changes and compare encrypted preset regions.', 'lab', 'Open Laboratory')} ${panelLink('Calibration', 'Record controlled before/after experiments to map slider effects.', 'calibration', 'Open Calibration')}</div>
  </section>`;
}

function renderLab() {
  const left = state.presets.labLeft;
  const right = state.presets.labRight;
  const changed = new Set(state.compare?.changedBlocks ?? []);
  const detail = left?.inspect?.blocks?.find((block) => block.index === selectedBlock);
  return `<section class="view compact-view">
    ${viewHeader('Preset Laboratory', 'Inspect and compare encrypted block regions.', `<button class="button primary" data-action="compare" ${left && right ? '' : 'disabled'}>Compare presets</button>`)}
    <div class="grid two">${presetCard('labLeft', 'Left preset', 'The reference preset to inspect and compare')} ${presetCard('labRight', 'Right preset', 'Optional second preset for comparison')}</div>
    <div class="spacer"></div>
    <div class="grid sidebar-main"><div class="panel"><div class="panel-header"><div><div class="panel-title">Block detail</div><div class="panel-subtitle">Selected encrypted region</div></div></div><div class="panel-body">${detail ? `<div class="stack"><div class="summary-strip triple"><div class="summary-stat"><span>Block</span><strong>#${detail.index}</strong></div><div class="summary-stat"><span>Group</span><strong>${escapeHTML(detail.groupName || 'Unknown')}</strong></div><div class="summary-stat"><span>Protected</span><strong>${detail.protected ? 'Yes' : 'No'}</strong></div></div><div class="callout">${escapeHTML(detail.hex)}</div></div>` : '<div class="empty-state">Select a block from the heatmap.</div>'}</div></div><div class="panel"><div class="panel-header"><div><div class="panel-title">Block heatmap</div><div class="panel-subtitle">115 fixed-size encrypted blocks</div></div>${state.compare ? `<span class="status-chip">${state.compare.changedBlocks.length} changed</span>` : ''}</div><div class="panel-body">${left ? `<div class="block-heatmap">${left.inspect.blocks.map((block) => `<button class="block ${block.isDefault ? 'default' : ''} ${block.protected ? 'protected' : ''} ${changed.has(block.index) ? 'changed' : ''} ${selectedBlock === block.index ? 'selected' : ''}" data-block="${block.index}" title="#${block.index} · ${escapeHTML(block.groupName || 'Unknown')} · ${block.hex}"></button>`).join('')}</div>` : '<div class="empty-state">Load a left preset to reveal the block map.</div>'}</div></div></div>
  </section>`;
}

function renderCalibration() {
  const observations = Object.values(state.calibration?.observations ?? {});
  return `<section class="view compact-view">
    ${viewHeader('Calibration', 'Create before-and-after presets, change one control only, then record which encrypted blocks moved.', `<button class="button" data-action="export-calibration">Export database</button>`)}
    <div class="grid two">${presetCard('calBefore', 'Before preset', 'Save the untouched or minimum state')} ${presetCard('calAfter', 'After preset', 'Change exactly one BDO customization control')}</div>
    <div class="spacer"></div>
    <div class="panel"><div class="panel-header"><div><div class="panel-title">Record observation</div><div class="panel-subtitle">Precise labels make the database useful</div></div></div><div class="panel-body"><div class="inline"><input class="input" style="max-width:460px" id="calibration-label" placeholder="Example: Lahn nose width maximum"><button class="button primary" data-action="observe-calibration" ${state.presets.calBefore && state.presets.calAfter ? '' : 'disabled'}>Analyze changed blocks</button><label class="button"><input class="hidden" type="file" accept="application/json,.json" data-import-calibration>Import JSON</label></div></div></div>
    <div class="spacer"></div>
    <div class="panel"><div class="panel-header"><div><div class="panel-title">Learned observations</div><div class="panel-subtitle">Intersection means blocks changed in every sample</div></div><span class="status-chip">${observations.length} mappings</span></div><div class="panel-body"><div class="data-list">${observations.length ? observations.sort((a, b) => a.label.localeCompare(b.label)).map((item) => `<div class="data-row"><div class="data-main"><strong>${escapeHTML(item.label)}</strong><span>${item.samples} sample${item.samples === 1 ? '' : 's'} · intersection [${item.intersection.join(', ')}] · union [${item.union.join(', ')}]</span></div><button class="button compact danger" data-delete-calibration="${escapeHTML(item.label)}">Remove</button></div>`).join('') : '<div class="empty-state">No observations yet. The calibration database stays local.</div>'}</div></div></div>
  </section>`;
}

function filteredLibraryItems() {
  const search = state.settings.librarySearch.trim().toLowerCase();
  const profiledOnly = state.settings.libraryProfiledOnly;
  return state.library.items.filter((item) => {
    const profile = getProfileForPreset(item);
    if (profiledOnly && !profile) return false;
    if (!search) return true;
    return item.name.toLowerCase().includes(search) || item.sha256.toLowerCase().includes(search) || item.classFingerprint.toLowerCase().includes(search);
  });
}

function renderLibrary() {
  const items = filteredLibraryItems();
  return `<section class="view compact-view">
    ${viewHeader('Preset Library', 'Scan your Black Desert customization folder, profile screenshots locally, and send presets straight into Create Face or Merge.', `<button class="button primary" data-action="scan-library">${state.library.loading ? 'Scanning…' : 'Scan folder'}</button>`)}
    <div class="panel"><div class="panel-header"><div><div class="panel-title">${escapeHTML(state.settings.customizationDir || 'Customization folder not configured')}</div><div class="panel-subtitle">${state.library.items.length} valid preset${state.library.items.length === 1 ? '' : 's'} found</div></div></div><div class="panel-body stack"><div class="inline"><input class="input" placeholder="Search filename or hash" value="${escapeHTML(state.settings.librarySearch)}" data-setting="library-search"><label class="toggle"><input type="checkbox" data-setting="library-profiled-only" ${state.settings.libraryProfiledOnly ? 'checked' : ''}><span>Profiled only</span></label></div><div class="data-list compact-list">${items.length ? items.map(renderLibraryRow).join('') : '<div class="empty-state">Scan the detected folder or change the path in Settings.</div>'}</div>${state.library.warnings.map((warning) => `<div class="callout warning">${escapeHTML(warning)}</div>`).join('')}</div></div>
  </section>`;
}

function renderLibraryRow(item) {
  const profile = getProfileForPreset(item);
  return `<div class="data-row library-row"><div class="data-main"><strong>${escapeHTML(item.name)}</strong><span>${shortHash(item.sha256)} · class ${shortHash(item.classFingerprint)} · ${profile ? `Profiled ${new Date(profile.profiledAt).toLocaleDateString()}` : 'Needs screenshot'}</span></div><div class="row-actions wrap"><button class="button compact" data-library-load="${escapeHTML(item.path)}" data-library-slot="base" data-library-view="create">Use as Starting Preset</button><label class="button compact"><input class="hidden" type="file" accept="image/*" data-profile-input="${escapeHTML(item.sha256)}">${profile ? 'Replace Screenshot' : 'Add Screenshot'}</label><button class="button compact" data-library-load="${escapeHTML(item.path)}" data-library-slot="base" data-library-view="merge">Manual Merge</button>${profile ? `<button class="button compact danger" data-remove-profile="${escapeHTML(item.sha256)}">Remove Profile</button>` : ''}</div></div>`;
}

function renderSettings() {
  return `<section class="view compact-view">
    ${viewHeader('Settings', 'FaceForge BDO runs as a private token-protected loopback service. It reads and writes standalone preset files only.', '')}
    <div class="grid two"><div class="panel"><div class="panel-header"><div><div class="panel-title">Black Desert paths</div><div class="panel-subtitle">Override detection for OneDrive or custom Documents layouts</div></div></div><div class="panel-body"><div class="field"><label>Customization directory</label><input class="input" data-setting="customization-dir" value="${escapeHTML(state.settings.customizationDir)}"><div class="help">Typical location: Documents\Black Desert\Customization</div></div><div class="field"><label>Default output filename</label><input class="input" data-setting="output-filename" value="${escapeHTML(state.settings.outputFilename)}"></div><button class="button" data-action="scan-library">Verify folder</button></div></div><div class="panel"><div class="panel-header"><div><div class="panel-title">Local service</div><div class="panel-subtitle">Version ${escapeHTML(state.status.version)} · schema ${escapeHTML(state.status.schemaName)}</div></div></div><div class="panel-body stack"><div class="callout success">Connected through a per-launch secret token. API requests without it are rejected.</div><div class="callout">No process injection, memory reading, keyboard automation, or game-client modification is used.</div><button class="button danger" data-action="shutdown">${icons.power} Exit FaceForge BDO</button></div></div></div>
    <div class="spacer"></div>
    <div class="panel"><div class="panel-header"><div><div class="panel-title">Recent activity</div><div class="panel-subtitle">Current session only</div></div></div><div class="panel-body"><div class="data-list">${state.activity.length ? state.activity.map((item) => `<div class="data-row"><div class="data-main"><strong>${escapeHTML(item.message)}</strong><span>${new Date(item.at).toLocaleTimeString()}</span></div></div>`).join('') : '<div class="empty-state">No operations yet.</div>'}</div></div></div>
  </section>`;
}

function renderShell() {
  const renderView = {
    create: renderCreateFace,
    library: renderLibrary,
    tools: renderTools,
    merge: renderMerge,
    lab: renderLab,
    calibration: renderCalibration,
    settings: renderSettings
  }[state.activeView] ?? renderCreateFace;
  root.className = '';
  root.innerHTML = `<div class="app-shell">
    <header class="topbar"><div class="brand"><div class="brand-mark">FF</div><div class="brand-copy"><strong>FaceForge BDO</strong><span>Offline BDO preset workshop</span></div></div><div class="topbar-spacer"></div><div class="status-chip" title="${escapeHTML(state.settings.customizationDir)}"><span class="status-dot"></span>${escapeHTML(state.settings.customizationDir || 'Local service connected')}</div></header>
    <aside class="sidebar"><div class="nav-label">Workspaces</div>${nav.map(([id, label, icon]) => `<button class="nav-button ${activeSidebarView() === id ? 'active' : ''}" data-nav="${id}"><span class="nav-icon">${icons[icon]}</span>${escapeHTML(label)}</button>`).join('')}<div class="sidebar-footer">Preset format v${state.status.presetVersion}<br>${state.status.groups?.length ?? 0} mapped regions<br>Photo workflow streamlined for 0.4.0</div></aside>
    <main class="main">${renderView()}</main>
  </div>`;
}

function resetCreateFaceFlow(preserveInputs = true) {
  state.createFace = {
    stage: 'input',
    processingStep: '',
    result: null,
    autoPlan: null,
    candidates: [],
    warnings: [],
    adjustmentsOpen: false,
    referenceNeeded: null
  };
  if (!preserveInputs) {
    if (state.portraits.target?.preview) URL.revokeObjectURL(state.portraits.target.preview);
    state.portraits.target = null;
    state.presets.base = null;
  }
}

function getProfileForPreset(presetLike) {
  const sha = String(presetLike?.inspect?.sha256 ?? presetLike?.sha256 ?? '').trim().toLowerCase();
  return sha ? state.referenceCatalog.profiles?.[sha] ?? null : null;
}

function libraryItemBySha(sha) {
  return state.library.items.find((item) => item.sha256.toLowerCase() === String(sha).toLowerCase()) ?? null;
}

async function loadPreset(slot, fileOrData) {
  try {
    const item = fileOrData.data ? fileOrData : await readPresetFile(fileOrData);
    const inspect = await apiPost('/api/inspect', { name: item.name, data: item.data });
    state.presets[slot] = { ...item, inspect };
    if (slot === 'labLeft' || slot === 'labRight') state.compare = null;
    if (slot === 'base' || slot === 'donor') {
      state.blend.result = null;
      if (slot === 'base') resetCreateFaceFlow(true);
    }
    selectedBlock = null;
    addActivity(`Loaded ${item.name} into ${slot}.`);
    toast(`${item.name} loaded and validated.`, 'success');
    renderShell();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function loadPortrait(slot, file) {
  const previousPreview = state.portraits[slot]?.preview;
  if (previousPreview) URL.revokeObjectURL(previousPreview);
  const preview = URL.createObjectURL(file);
  state.portraits[slot] = { name: file.name, preview, loading: true, analysis: null, error: null };
  renderShell();
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = preview;
    await image.decode();
    const analysis = await analyzeFaceImage(image);
    state.portraits[slot] = { name: file.name, preview, loading: false, analysis, error: null };
    resetCreateFaceFlow(true);
    addActivity(`Analyzed ${file.name} locally.`);
    toast(`${file.name} analyzed locally.`, 'success');
  } catch (error) {
    state.portraits[slot] = { name: file.name, preview, loading: false, analysis: null, error: error.message };
    toast(error.message, 'error');
  }
  renderShell();
}

async function scanLibrary() {
  state.library.loading = true;
  renderShell();
  try {
    const path = encodeURIComponent(state.settings.customizationDir);
    const result = await apiGet(`/api/folder/scan?path=${path}`);
    state.settings.customizationDir = result.directory;
    state.library.items = result.presets ?? [];
    state.library.warnings = result.warnings ?? [];
    addActivity(`Scanned ${result.directory}: ${state.library.items.length} valid presets.`);
    toast(`${state.library.items.length} valid presets found.`, 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
  state.library.loading = false;
  renderShell();
}

async function loadLibraryPreset(path, slot, targetView) {
  try {
    const result = await apiPost('/api/folder/read', { path });
    await loadPreset(slot, { name: result.name, data: result.data, path: result.path });
    if (targetView) state.activeView = targetView;
    renderShell();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function attachReferenceScreenshot(sha, file) {
  const item = libraryItemBySha(sha);
  if (!item) {
    toast('Could not find that preset in the current library scan.', 'error');
    return;
  }
  try {
    toast(`Analyzing ${file.name} for ${item.name}...`, 'info');
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    const analysis = await analyzeFaceImage(image);
    URL.revokeObjectURL(url);
    state.referenceCatalog = upsertReferenceProfile(state.referenceCatalog, {
      sha256: item.sha256,
      name: item.name,
      classFingerprint: item.classFingerprint,
      imageName: file.name,
      metrics: analysis.measurements.normalized,
      quality: analysis.measurements.quality
    });
    saveReferenceCatalog(state.referenceCatalog);
    addActivity(`Profiled screenshot for ${item.name}.`);
    toast(`Screenshot linked to ${item.name}.`, 'success');
    renderShell();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function automaticRecipeFromPlan(plan) {
  return {
    name: outputFileName(),
    seed: state.blend.seed,
    allowCrossClass: false,
    allowProtected: false,
    groups: Object.entries(plan.groups ?? {})
      .filter(([, value]) => Number(value.weight) > 0)
      .map(([groupId, value]) => ({ groupId, donorId: value.donorId, weight: Number(value.weight) }))
  };
}

async function readCandidatePresets(candidates) {
  const donors = {};
  for (const candidate of candidates) {
    const loaded = await apiPost('/api/folder/read', { path: candidate.path });
    donors[candidate.id] = loaded.data;
  }
  return donors;
}

async function createFacePreset() {
  if (!state.portraits.target?.analysis || !state.presets.base) return;
  try {
    state.createFace.stage = 'processing';
    state.createFace.processingStep = 'Analyzing target face...';
    renderShell();

    const targetMetrics = state.portraits.target.analysis.measurements.normalized;
    const baseClass = state.presets.base.inspect.classFingerprint;
    const baseSha = state.presets.base.inspect.sha256.toLowerCase();

    state.createFace.processingStep = 'Scanning compatible profiled references...';
    renderShell();

    const candidates = state.library.items
      .filter((item) => item.classFingerprint === baseClass && item.sha256.toLowerCase() !== baseSha)
      .map((item) => ({ ...item, ...(getProfileForPreset(item) ? { analysis: { measurements: { normalized: getProfileForPreset(item).metrics, quality: getProfileForPreset(item).quality } } } : {}) }))
      .filter((item) => item.analysis?.measurements?.normalized)
      .map((item, index) => ({
        id: `ref${index + 1}`,
        path: item.path,
        name: item.name,
        sha256: item.sha256,
        classFingerprint: item.classFingerprint,
        analysis: item.analysis,
        metrics: item.analysis.measurements.normalized
      }));

    const baseProfile = getProfileForPreset(state.presets.base);
    const plan = buildAutomaticPlan({ targetMetrics, baseMetrics: baseProfile?.metrics ?? null, candidates });

    if (!plan.selected.length) {
      state.createFace.stage = 'reference-required';
      state.createFace.referenceNeeded = plan.warnings[0];
      state.createFace.autoPlan = null;
      state.createFace.result = null;
      state.createFace.candidates = [];
      state.createFace.warnings = plan.warnings;
      renderShell();
      return;
    }

    state.createFace.processingStep = 'Loading selected reference presets...';
    renderShell();
    const selected = plan.selected.map((item, index) => ({ ...item, id: item.id || `ref${index + 1}` }));
    const donors = await readCandidatePresets(selected);

    state.createFace.processingStep = 'Building and validating the preset...';
    renderShell();
    const recipe = automaticRecipeFromPlan(plan);
    const result = await apiPost('/api/blend', {
      base: state.presets.base.data,
      donors,
      recipe
    });

    state.createFace.stage = 'result';
    state.createFace.result = result;
    state.createFace.autoPlan = plan;
    state.createFace.candidates = selected;
    state.createFace.warnings = plan.warnings;
    state.presets.generated = { name: outputFileName(), data: result.data };
    state.settings.outputFilename = outputFileName();
    addActivity(`Created ${outputFileName()} from photo workflow.`);
    toast('Face preset created and binary-validated.', 'success');
  } catch (error) {
    state.createFace.stage = 'input';
    toast(error.message, 'error');
  }
  renderShell();
}

async function rebuildCreateFaceResult() {
  const plan = state.createFace.autoPlan;
  if (!plan || !state.presets.base) return;
  try {
    state.createFace.stage = 'processing';
    state.createFace.processingStep = 'Rebuilding the result with your adjustments...';
    renderShell();
    const donors = await readCandidatePresets(state.createFace.candidates);
    const recipe = automaticRecipeFromPlan(plan);
    const result = await apiPost('/api/blend', {
      base: state.presets.base.data,
      donors,
      recipe
    });
    state.createFace.result = result;
    state.createFace.stage = 'result';
    state.presets.generated = { name: outputFileName(), data: result.data };
    addActivity(`Rebuilt ${outputFileName()} after adjustments.`);
    toast('Adjusted result rebuilt and validated.', 'success');
  } catch (error) {
    state.createFace.stage = 'result';
    toast(error.message, 'error');
  }
  renderShell();
}

async function generateBlend() {
  if (!state.presets.base || !state.presets.donor) return;
  try {
    const recipe = recipeFromState(state, state.status.groups);
    const result = await apiPost('/api/blend', {
      base: state.presets.base.data,
      donors: { donor: state.presets.donor.data },
      recipe
    });
    state.blend.result = result;
    state.presets.generated = { name: outputFileName(), data: result.data };
    addActivity(`Created ${outputFileName()} with ${result.changedBlocks.length} changed blocks.`);
    toast('Merged preset created and binary-validated.', 'success');
    renderShell();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function comparePresets() {
  try {
    state.compare = await apiPost('/api/compare', { left: state.presets.labLeft.data, right: state.presets.labRight.data });
    addActivity(`Compared presets: ${state.compare.changedBlocks.length} blocks differ.`);
    toast(`${state.compare.changedBlocks.length} changed blocks found.`, 'success');
    renderShell();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function observeCalibration() {
  const label = document.querySelector('#calibration-label')?.value.trim();
  if (!label) return toast('Enter a precise calibration label.', 'error');
  try {
    const observation = await apiPost('/api/calibration/observe', {
      before: state.presets.calBefore.data,
      after: state.presets.calAfter.data,
      label
    });
    state.calibration = calibrationMerge(state.calibration, observation);
    saveCalibration(state.calibration);
    addActivity(`Recorded calibration “${label}”: ${observation.changedBlocks.length} blocks.`);
    toast(`Calibration recorded: ${observation.changedBlocks.length} changed blocks.`, 'success');
    renderShell();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function savePresetResult(encodedData) {
  try {
    const result = await apiPost('/api/save', {
      directory: state.settings.customizationDir,
      filename: outputFileName(),
      data: encodedData
    });
    addActivity(`Saved generated preset to ${result.path}.`);
    toast(result.backupPath ? 'Saved. Previous file backed up automatically.' : `Saved to ${result.path}.`, 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function setAllWeights(value) {
  for (const group of state.status.groups.filter((item) => !item.protected)) {
    state.blend.weights[group.id] = value;
  }
}

async function handleAction(action) {
  if (action.startsWith('mix-')) {
    setAllWeights(Number(action.slice(4)));
    renderShell();
    return;
  }
  switch (action) {
    case 'create-face':
      await createFacePreset();
      break;
    case 'rebuild-create-result':
      await rebuildCreateFaceResult();
      break;
    case 'toggle-adjustments':
      state.createFace.adjustmentsOpen = !state.createFace.adjustmentsOpen;
      renderShell();
      break;
    case 'start-over-create':
      resetCreateFaceFlow(false);
      renderShell();
      break;
    case 'open-library-profile-help':
      state.activeView = 'library';
      renderShell();
      break;
    case 'generate':
      await generateBlend();
      break;
    case 'compare':
      await comparePresets();
      break;
    case 'reset-weights':
      setAllWeights(50);
      renderShell();
      break;
    case 'scan-library':
      await scanLibrary();
      break;
    case 'observe-calibration':
      await observeCalibration();
      break;
    case 'download-result':
      if (state.blend.result) downloadBytes(base64ToBytes(state.blend.result.data), outputFileName());
      break;
    case 'download-create-result':
      if (state.createFace.result) downloadBytes(base64ToBytes(state.createFace.result.data), outputFileName());
      break;
    case 'download-sidecar': {
      const sidecar = state.createFace.result?.sidecar ?? state.blend.result?.sidecar;
      if (sidecar) downloadText(sidecar, `${outputFileName()}.faceforge-bdo.json`);
      break;
    }
    case 'save-result':
      if (state.blend.result) await savePresetResult(state.blend.result.data);
      break;
    case 'save-create-result':
      if (state.createFace.result) await savePresetResult(state.createFace.result.data);
      break;
    case 'export-calibration':
      downloadText(JSON.stringify(state.calibration, null, 2), 'FaceForge-BDO-Calibration.json');
      break;
    case 'shutdown':
      try { await apiPost('/api/shutdown'); } catch { /* service may close before response is consumed */ }
      root.innerHTML = '<div class="boot-screen"><div class="boot-mark">FF</div><h1>FaceForge BDO closed</h1><p>The desktop window will close automatically.</p></div>';
      break;
  }
}

root.addEventListener('click', async (event) => {
  const navTarget = event.target.closest('[data-nav]');
  if (navTarget) {
    state.activeView = navTarget.dataset.nav;
    renderShell();
    return;
  }
  const action = event.target.closest('[data-action]');
  if (action) {
    await handleAction(action.dataset.action);
    return;
  }
  const clearPreset = event.target.closest('[data-clear-preset]');
  if (clearPreset) {
    state.presets[clearPreset.dataset.clearPreset] = null;
    state.compare = null;
    state.blend.result = null;
    if (clearPreset.dataset.clearPreset === 'base') resetCreateFaceFlow(true);
    renderShell();
    return;
  }
  const clearPortrait = event.target.closest('[data-clear-portrait]');
  if (clearPortrait) {
    const item = state.portraits[clearPortrait.dataset.clearPortrait];
    if (item?.preview) URL.revokeObjectURL(item.preview);
    state.portraits[clearPortrait.dataset.clearPortrait] = null;
    if (clearPortrait.dataset.clearPortrait === 'target') resetCreateFaceFlow(true);
    renderShell();
    return;
  }
  const block = event.target.closest('[data-block]');
  if (block) {
    selectedBlock = Number(block.dataset.block);
    renderShell();
    return;
  }
  const library = event.target.closest('[data-library-load]');
  if (library) {
    await loadLibraryPreset(library.dataset.libraryLoad, library.dataset.librarySlot, library.dataset.libraryView);
    return;
  }
  const deletion = event.target.closest('[data-delete-calibration]');
  if (deletion) {
    delete state.calibration.observations[deletion.dataset.deleteCalibration];
    saveCalibration(state.calibration);
    renderShell();
    return;
  }
  const removeProfile = event.target.closest('[data-remove-profile]');
  if (removeProfile) {
    state.referenceCatalog = removeReferenceProfile(state.referenceCatalog, removeProfile.dataset.removeProfile);
    saveReferenceCatalog(state.referenceCatalog);
    toast('Reference profile removed.', 'success');
    renderShell();
  }
});

root.addEventListener('change', async (event) => {
  const presetInput = event.target.closest('[data-preset-input]');
  if (presetInput?.files?.[0]) {
    await loadPreset(presetInput.dataset.presetInput, presetInput.files[0]);
    return;
  }
  const portraitInput = event.target.closest('[data-portrait-input]');
  if (portraitInput?.files?.[0]) {
    await loadPortrait(portraitInput.dataset.portraitInput, portraitInput.files[0]);
    return;
  }
  const profileInput = event.target.closest('[data-profile-input]');
  if (profileInput?.files?.[0]) {
    await attachReferenceScreenshot(profileInput.dataset.profileInput, profileInput.files[0]);
    return;
  }
  const weight = event.target.closest('[data-weight]');
  if (weight) {
    state.blend.weights[weight.dataset.weight] = Number(weight.value);
    renderShell();
    return;
  }
  const createWeight = event.target.closest('[data-create-weight]');
  if (createWeight) {
    if (state.createFace.autoPlan?.groups?.[createWeight.dataset.createWeight]) {
      state.createFace.autoPlan.groups[createWeight.dataset.createWeight].weight = Number(createWeight.value);
    }
    renderShell();
    return;
  }
  const setting = event.target.closest('[data-setting]');
  if (setting) {
    if (setting.dataset.setting === 'cross-class') state.blend.allowCrossClass = setting.checked;
    else if (setting.dataset.setting === 'blend-seed') state.blend.seed = setting.value;
    else if (setting.dataset.setting === 'customization-dir') state.settings.customizationDir = setting.value;
    else if (setting.dataset.setting === 'output-filename') state.settings.outputFilename = setting.value;
    else if (setting.dataset.setting === 'library-search') state.settings.librarySearch = setting.value;
    else if (setting.dataset.setting === 'library-profiled-only') state.settings.libraryProfiledOnly = setting.checked;
    renderShell();
    return;
  }
  const importInput = event.target.closest('[data-import-calibration]');
  if (importInput?.files?.[0]) {
    try {
      const parsed = JSON.parse(await importInput.files[0].text());
      if (!parsed || typeof parsed.observations !== 'object') throw new Error('Not a FaceForge BDO calibration database.');
      state.calibration = parsed;
      saveCalibration(parsed);
      toast('Calibration database imported.', 'success');
      renderShell();
    } catch (error) {
      toast(error.message, 'error');
    }
  }
});

root.addEventListener('input', (event) => {
  const weight = event.target.closest('[data-weight]');
  if (weight) {
    state.blend.weights[weight.dataset.weight] = Number(weight.value);
    const display = weight.parentElement.querySelector('.slider-value');
    if (display) display.textContent = `${weight.value}%`;
  }
  const createWeight = event.target.closest('[data-create-weight]');
  if (createWeight) {
    if (state.createFace.autoPlan?.groups?.[createWeight.dataset.createWeight]) {
      state.createFace.autoPlan.groups[createWeight.dataset.createWeight].weight = Number(createWeight.value);
    }
    const display = createWeight.parentElement.querySelector('.slider-value');
    if (display) display.textContent = `${createWeight.value}%`;
  }
});

for (const type of ['dragenter', 'dragover']) {
  root.addEventListener(type, (event) => {
    const zone = event.target.closest('[data-drop-preset], [data-drop-portrait]');
    if (!zone) return;
    event.preventDefault();
    zone.classList.add('dragging');
  });
}
for (const type of ['dragleave', 'drop']) {
  root.addEventListener(type, async (event) => {
    const zone = event.target.closest('[data-drop-preset], [data-drop-portrait]');
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove('dragging');
    if (type !== 'drop' || !event.dataTransfer?.files?.[0]) return;
    if (zone.dataset.dropPreset) await loadPreset(zone.dataset.dropPreset, event.dataTransfer.files[0]);
    else await loadPortrait(zone.dataset.dropPortrait, event.dataTransfer.files[0]);
  });
}

async function start() {
  if (!hasToken()) {
    root.className = 'boot-screen';
    root.innerHTML = `<div class="boot-mark">FF</div><h1>Launch token missing</h1><p>Open FaceForge BDO from its EXE, not by opening this page directly.</p><div class="field" style="width:360px;margin:10px auto 0"><input id="manual-token" class="input" placeholder="Developer token"><button class="button" id="manual-connect">Connect</button></div>`;
    document.querySelector('#manual-connect')?.addEventListener('click', async () => {
      setToken(document.querySelector('#manual-token').value.trim());
      await start();
    }, { once: true });
    return;
  }
  try {
    const status = await apiGet('/api/status');
    state = createInitialState(status);
    addActivity(`Connected to FaceForge BDO ${status.version}.`);
    renderShell();
    scanLibrary();
  } catch (error) {
    root.className = 'boot-screen';
    root.innerHTML = `<div class="boot-mark">FF</div><h1>Could not connect</h1><p>${escapeHTML(error.message)}</p>`;
  }
}

start();
