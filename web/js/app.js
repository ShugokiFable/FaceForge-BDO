import { apiGet, apiPost, hasToken, setToken } from './api.js';
import { analyzeFaceImage, weightsFromProfiles } from './face-analysis.js';
import {
  calibrationMerge,
  createInitialState,
  mergeSuggestedWeights,
  recipeFromState,
  saveCalibration
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
  ['home', 'Home', 'home'],
  ['photo', 'Face from Photo', 'image'],
  ['merge', 'Merge Presets', 'merge'],
  ['library', 'Preset Library', 'folder'],
  ['advanced', 'Advanced Tools', 'tools'],
  ['settings', 'Settings', 'settings']
];

const icons = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10.5V20h14v-9.5"/></svg>',
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
const confidenceLabel = (value) => value >= .75 ? 'high' : value >= .35 ? 'medium' : 'low';

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

function viewHeader(title, description, actions = '') {
  return `<div class="view-header"><div class="view-title"><h1>${escapeHTML(title)}</h1><p>${escapeHTML(description)}</p></div><div class="header-actions">${actions}</div></div>`;
}

function panelLink(title, body, view, buttonLabel = 'Open') {
  return `<div class="panel home-card"><div class="panel-body stack"><div class="home-card-copy"><h3>${escapeHTML(title)}</h3><p>${escapeHTML(body)}</p></div><button class="button primary" data-nav="${escapeHTML(view)}">${escapeHTML(buttonLabel)}</button></div></div>`;
}

function workflowSteps(items) {
  return `<div class="step-list">${items.map((item, index) => `<div class="step-item"><div class="step-number">${index + 1}</div><div><strong>${escapeHTML(item.title)}</strong><span>${escapeHTML(item.text)}</span></div></div>`).join('')}</div>`;
}

function presetCard(slot, title, subtitle) {
  const item = state.presets[slot];
  return `<div class="panel">
    <div class="panel-header"><div><div class="panel-title">${escapeHTML(title)}</div><div class="panel-subtitle">${escapeHTML(subtitle)}</div></div>${item ? `<button class="button ghost compact" data-clear-preset="${slot}">Clear</button>` : ''}</div>
    <div class="panel-body">
      <label class="dropzone" data-drop-preset="${slot}">
        <input type="file" data-preset-input="${slot}">
        ${item ? `<div class="file-card"><div class="file-glyph">BDO</div><div class="file-meta"><strong>${escapeHTML(item.name)}</strong><span>v${item.inspect.version} · ${shortHash(item.inspect.sha256)} · ${escapeHTML(item.inspect.classFingerprint)}</span></div><span class="muted">Replace</span></div>` : `<div><strong>Drop a BDO preset here</strong><small>Or click to choose a 924-byte customization file</small></div>`}
      </label>
    </div>
  </div>`;
}

function portraitPanel(slot, title, subtitle) {
  const portrait = state.portraits[slot];
  const metrics = portrait?.analysis?.measurements?.normalized;
  return `<div class="panel">
    <div class="panel-header"><div><div class="panel-title">${escapeHTML(title)}</div><div class="panel-subtitle">${escapeHTML(subtitle)}</div></div>${portrait ? `<button class="button ghost compact" data-clear-portrait="${slot}">Clear</button>` : ''}</div>
    <div class="panel-body stack">
      <label class="portrait-box" data-drop-portrait="${slot}">
        <input class="hidden" type="file" accept="image/*" data-portrait-input="${slot}">
        ${portrait ? `<img src="${portrait.preview}" alt="Analyzed portrait"><span class="portrait-badge">${portrait.loading ? 'Analyzing locally…' : portrait.error ? escapeHTML(portrait.error) : `${Math.round((portrait.analysis?.measurements?.quality?.symmetry ?? 0) * 100)}% symmetry · ${portrait.analysis?.candidates ?? 0} face${portrait.analysis?.candidates === 1 ? '' : 's'}`}</span>` : `<div class="portrait-empty"><strong>Choose an image</strong><br>Front-facing, neutral expression, full face visible</div>`}
      </label>
      ${metrics ? metricGrid(metrics) : ''}
    </div>
  </div>`;
}

function metricGrid(metrics) {
  const labels = {
    faceAspect: 'Face aspect', eyeSpacing: 'Eye spacing', eyeOpenness: 'Eye openness',
    noseWidth: 'Nose width', mouthWidth: 'Mouth width', jawWidth: 'Jaw width', lowerFace: 'Lower face'
  };
  return `<div class="metric-grid">${Object.entries(metrics).map(([key, value]) => `<div class="metric"><div class="metric-head"><span class="metric-name">${labels[key] ?? key}</span><span class="metric-value">${Math.round(value * 100)}%</span></div><div class="meter"><span style="width:${Math.round(value * 100)}%"></span></div></div>`).join('')}</div>`;
}

function suggestionRows(groups) {
  const editable = (state.status.groups ?? []).filter((group) => !group.protected);
  return editable.map((group) => {
    const suggestion = groups[group.id] ?? { weight: 50, confidence: 0 };
    return `<div class="slider-row"><div class="slider-label"><strong>${escapeHTML(group.name)}</strong><span>${confidenceLabel(suggestion.confidence)} confidence</span></div><div class="meter"><span style="width:${Math.round(suggestion.weight)}%"></span></div><div class="slider-value">${Math.round(suggestion.weight)}%</div></div>`;
  }).join('');
}

function renderHome() {
  const loaded = [state.presets.base, state.presets.donor, state.presets.labLeft, state.presets.labRight].filter(Boolean).length;
  return `<section class="view">
    ${viewHeader('FaceForge BDO', 'A simpler offline workflow for Black Desert presets: start from a photo, merge two presets, or inspect preset files.', '')}
    <div class="grid three home-grid">
      ${panelLink('Make a Face from a Photo', 'Pick a target photo, choose a starting preset, and let FaceForge suggest merge weights in plain language.', 'photo', 'Start photo workflow')}
      ${panelLink('Merge Two Presets', 'Blend two existing presets together. This is now a separate workflow, so you can merge without touching the photo tools.', 'merge', 'Start merging')}
      ${panelLink('Preset Library', 'Scan your BDO customization folder and load presets into the photo, merge, or advanced tools workflows.', 'library', 'Open library')}
    </div>
    <div class="spacer"></div>
    <div class="grid two">
      <div class="panel"><div class="panel-header"><div><div class="panel-title">Recommended order</div><div class="panel-subtitle">Normal users can ignore the advanced reverse-engineering tools</div></div></div><div class="panel-body stack">
        ${workflowSteps([
          { title: 'Face from Photo', text: 'Use this if you want to approximate a real or fictional face.' },
          { title: 'Merge Presets', text: 'Use this if you simply want to combine two existing BDO presets.' },
          { title: 'Advanced Tools', text: 'Use the Laboratory and Calibration only if you are mapping encrypted preset blocks.' }
        ])}
      </div></div>
      <div class="panel"><div class="panel-header"><div><div class="panel-title">Session overview</div><div class="panel-subtitle">Current workspace status</div></div></div><div class="panel-body">
        <div class="summary-strip"><div class="summary-stat"><span>Loaded presets</span><strong>${loaded}</strong></div><div class="summary-stat"><span>Library items</span><strong>${state.library.items.length}</strong></div><div class="summary-stat"><span>Calibration mappings</span><strong>${Object.keys(state.calibration?.observations ?? {}).length}</strong></div><div class="summary-stat"><span>Detected folder</span><strong title="${escapeHTML(state.settings.customizationDir)}">${escapeHTML(state.settings.customizationDir || 'Not set')}</strong></div></div>
        <div class="callout success">Preset merging is fully separate now. Use <strong>Merge Presets</strong> if you just want to combine two preset files.</div>
      </div></div>
    </div>
    <div class="spacer"></div>
    <div class="panel"><div class="panel-header"><div><div class="panel-title">Need the reverse-engineering tools?</div><div class="panel-subtitle">Laboratory and Calibration are still available, just moved out of the main path</div></div><button class="button" data-nav="advanced">Open advanced tools</button></div></div>
  </section>`;
}

function renderPhoto() {
  const targetReady = state.portraits.target?.analysis;
  const startPreset = state.presets.base;
  const startPortrait = state.portraits.base?.analysis;
  const helperPreset = state.presets.donor;
  const helperPortrait = state.portraits.donor?.analysis;
  const suggestions = state.blend.suggestions;
  const canSuggest = targetReady && startPortrait && helperPortrait;
  return `<section class="view">
    ${viewHeader('Face from Photo', 'Choose the face you want to match, then give FaceForge a starting preset. A second preset is optional, but recommended if you want automatic merge suggestions.', `${suggestions ? `<button class="button primary" data-action="apply-suggestions">Send suggestions to Merge Presets</button>` : ''}`)}
    <div class="callout">This workflow is for <strong>photo matching</strong>. If you just want to combine two existing presets, use <strong>Merge Presets</strong> instead.</div>
    <div class="spacer"></div>
    ${workflowSteps([
      { title: 'Target photo', text: 'The real or fictional face you want to approximate.' },
      { title: 'Starting preset', text: 'The app keeps this preset’s class identity and protected metadata.' },
      { title: 'Optional helper preset', text: 'Add a second preset only if you want FaceForge to suggest merge weights automatically.' }
    ])}
    <div class="spacer"></div>
    <div class="grid two">
      ${portraitPanel('target', '1 · Target photo', 'Your reference face')}
      ${portraitPanel('base', '2 · Starting preset screenshot', 'Optional but recommended: a screenshot of your starting preset in BDO')}
    </div>
    <div class="spacer"></div>
    <div class="grid two">
      ${presetCard('base', 'Starting preset file', 'Required. FaceForge keeps this preset’s class identity and protected metadata.')}
      <div class="panel"><div class="panel-header"><div><div class="panel-title">Optional helper preset</div><div class="panel-subtitle">Only needed for automatic suggestions</div></div></div><div class="panel-body stack">
        ${presetCard('donor', 'Helper preset file', 'Optional. FaceForge can borrow feature blocks from this file.')}
        <div class="mini-panel">${portraitPanel('donor', 'Helper preset screenshot', 'Optional: screenshot of the helper preset in BDO')}</div>
      </div></div>
    </div>
    <div class="spacer"></div>
    <div class="panel">
      <div class="panel-header"><div><div class="panel-title">Automatic photo suggestions</div><div class="panel-subtitle">FaceForge compares the target photo to the starting and helper preset screenshots</div></div><button class="button" data-action="recalculate-weights" ${canSuggest ? '' : 'disabled'}>Analyze suggestions</button></div>
      <div class="panel-body stack">
        ${suggestions ? suggestionRows(suggestions.groups) : '<div class="empty-state">To get automatic suggestions, add a target photo, a starting preset screenshot, and a helper preset screenshot. If you do not have a helper preset, you can still continue manually in Merge Presets.</div>'}
        ${!startPreset ? '<div class="callout warning">You still need to load a <strong>Starting preset file</strong>. That file anchors the class identity and makes the final preset usable in BDO.</div>' : ''}
        ${suggestions?.warnings?.map((warning) => `<div class="callout warning">${escapeHTML(warning)}</div>`).join('') ?? ''}
      </div>
      <div class="panel-footer inline"><button class="button primary" data-nav="merge">Open Merge Presets</button><span class="help">Use Merge Presets to fine-tune or generate the final preset. Automatic suggestions simply prefill the merge weights.</span></div>
    </div>
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
  return `<section class="view">
    ${viewHeader('Merge Presets', 'Combine two existing presets together. This workflow is separate from photo matching and can be used on its own.', `<button class="button primary" data-action="generate" ${ready ? '' : 'disabled'}>Create merged preset</button>`)}
    <div class="callout success">This is the place to merge two presets. The photo workflow only helps suggest weights; it no longer replaces this screen.</div>
    <div class="spacer"></div>
    ${workflowSteps([
      { title: 'Starting preset', text: 'This is the preset you keep as the base. Its class identity and protected metadata stay intact.' },
      { title: 'Preset to borrow from', text: 'This is the preset FaceForge copies feature blocks from.' },
      { title: 'Choose how much to borrow', text: 'Use quick mix buttons or fine-tune each feature group below.' }
    ])}
    <div class="spacer"></div>
    <div class="grid two">
      ${presetCard('base', 'Starting preset', 'Required. Protected class and metadata stay from this file.')}
      ${presetCard('donor', 'Preset to borrow from', 'Required. FaceForge copies feature blocks from this file.')}
    </div>
    <div class="spacer"></div>
    <div class="grid sidebar-main">
      <div class="panel"><div class="panel-header"><div><div class="panel-title">Merge controls</div><div class="panel-subtitle">Start simple, then open the detailed sliders if needed</div></div></div><div class="panel-body stack">
        <div class="field"><label for="blend-seed">Deterministic seed</label><input id="blend-seed" class="input" data-setting="blend-seed" value="${escapeHTML(state.blend.seed)}"><div class="help">Same files, weights, and seed always produce the same binary output.</div></div>
        <div class="field"><label>Quick mixes</label>${renderQuickMixButtons()}<div class="help">Quick mixes set every feature group at once. You can still fine-tune individual groups afterwards.</div></div>
        <label class="toggle"><input type="checkbox" data-setting="cross-class" ${state.blend.allowCrossClass ? 'checked' : ''}><span>Enable experimental cross-class transplanting</span></label>
        <div class="callout warning">Cross-class results may deform or fail in-game because classes use different face geometry and assets. The class identity block still stays with the starting preset.</div>
      </div></div>
      <div class="panel"><div class="panel-header"><div><div class="panel-title">Feature weights</div><div class="panel-subtitle">0% keeps the starting preset. 100% copies the borrowed feature blocks.</div></div><button class="button compact" data-action="reset-weights">Reset 50/50</button></div><div class="panel-body">
        ${groups.map((group) => `<div class="slider-row"><div class="slider-label"><strong>${escapeHTML(group.name)}</strong><span>${escapeHTML(group.description)}</span></div><input class="slider" type="range" min="0" max="100" step="1" value="${state.blend.weights[group.id] ?? 50}" data-weight="${group.id}"><div class="slider-value">${Math.round(state.blend.weights[group.id] ?? 50)}%</div></div>`).join('')}
      </div></div>
    </div>
    ${result ? `<div class="spacer"></div>${resultPanel(result)}` : ''}
  </section>`;
}

function resultPanel(result) {
  return `<div class="panel"><div class="panel-header"><div><div class="panel-title">Generated preset</div><div class="panel-subtitle">Valid version 20 binary · ${result.changedBlocks.length} blocks changed</div></div><div class="inline"><button class="button" data-action="download-sidecar">Download report</button><button class="button primary" data-action="download-result">Download preset</button></div></div><div class="panel-body">
    <div class="summary-strip"><div class="summary-stat"><span>SHA-256</span><strong title="${escapeHTML(result.sha256)}">${shortHash(result.sha256)}</strong></div><div class="summary-stat"><span>Changed blocks</span><strong>${result.changedBlocks.length}</strong></div><div class="summary-stat"><span>Starting class</span><strong>${escapeHTML(state.presets.base?.inspect?.classFingerprint ?? 'Unknown')}</strong></div><div class="summary-stat"><span>Safety</span><strong>${state.blend.allowCrossClass ? 'Experimental' : 'Same class'}</strong></div></div>
    ${result.warnings?.map((warning) => `<div class="callout warning">${escapeHTML(warning)}</div>`).join('') ?? '<div class="callout success">Protected metadata and class identity were preserved from the starting preset.</div>'}
    <div class="spacer"></div>
    <div class="inline"><input class="input" style="max-width:360px" data-setting="output-filename" value="${escapeHTML(state.settings.outputFilename)}"><button class="button primary" data-action="save-result">Save into BDO folder</button></div>
  </div></div>`;
}

function renderAdvanced() {
  return `<section class="view">
    ${viewHeader('Advanced Tools', 'These tools are for reverse-engineering and troubleshooting. Normal photo matching and preset merging do not require them.', '')}
    <div class="grid two">
      ${panelLink('Preset Laboratory', 'Inspect the 115 encrypted blocks, compare two presets, and see which regions changed.', 'lab', 'Open Laboratory')}
      ${panelLink('Calibration', 'Build a local mapping database by comparing controlled before/after presets.', 'calibration', 'Open Calibration')}
    </div>
    <div class="spacer"></div>
    <div class="callout warning">These tools are intentionally separated from the main workflow so the normal app stays simpler. Use them only if you want to map controls, compare binaries, or research the preset format.</div>
  </section>`;
}

function renderLab() {
  const left = state.presets.labLeft;
  const right = state.presets.labRight;
  const changed = new Set(state.compare?.changedBlocks ?? []);
  const selected = selectedBlock == null ? null : left?.inspect?.blocks?.[selectedBlock];
  return `<section class="view">
    ${viewHeader('Preset Laboratory', 'Inspect all 115 encrypted blocks, compare presets, and identify which runs changed.', `<button class="button primary" data-action="compare" ${left && right ? '' : 'disabled'}>Compare presets</button>`)}
    <div class="grid two">${presetCard('labLeft', 'Left preset', 'Reference or before file')}${presetCard('labRight', 'Right preset', 'Comparison or after file')}</div>
    <div class="spacer"></div>
    <div class="grid sidebar-main">
      <div class="panel"><div class="panel-header"><div><div class="panel-title">Block inspector</div><div class="panel-subtitle">Click any square to inspect its ciphertext and mapped region</div></div></div><div class="panel-body">
        ${selected ? `<div class="summary-strip" style="grid-template-columns:1fr 1fr"><div class="summary-stat"><span>Block</span><strong>#${selected.index}</strong></div><div class="summary-stat"><span>Group</span><strong>${escapeHTML(selected.groupName || 'Unknown')}</strong></div></div><div class="field"><label>Ciphertext</label><input class="input mono" readonly value="${escapeHTML(selected.hex)}"></div><div class="callout ${selected.protected ? 'warning' : ''}">${selected.protected ? 'Protected and preserved from the starting preset by default.' : `${escapeHTML(selected.confidence || 'unknown')} mapping confidence.`}</div>` : '<div class="empty-state">Load a left preset and select a block.</div>'}
      </div></div>
      <div class="panel"><div class="panel-header"><div><div class="panel-title">115-block map</div><div class="panel-subtitle">Amber blocks differ from the right preset. Purple outlines are protected.</div></div>${state.compare ? `<span class="status-chip">${state.compare.changedBlocks.length} changed</span>` : ''}</div><div class="panel-body">
        ${left ? `<div class="block-heatmap">${left.inspect.blocks.map((block) => `<button class="block ${block.isDefault ? 'default' : ''} ${block.protected ? 'protected' : ''} ${changed.has(block.index) ? 'changed' : ''} ${selectedBlock === block.index ? 'selected' : ''}" data-block="${block.index}" title="#${block.index} · ${escapeHTML(block.groupName || 'Unknown')} · ${block.hex}"></button>`).join('')}</div>` : '<div class="empty-state">Load a left preset to reveal its fixed block map.</div>'}
        ${state.compare?.runs?.length ? `<div class="spacer"></div><div class="callout">Changed runs: ${state.compare.runs.map((run) => run.start === run.end ? `#${run.start}` : `#${run.start}–${run.end}`).join(', ')}</div>` : ''}
      </div></div>
    </div>
  </section>`;
}

function renderCalibration() {
  const observations = Object.values(state.calibration?.observations ?? {});
  return `<section class="view">
    ${viewHeader('Calibration', 'Create controlled before-and-after presets in BDO, change one control only, then record which encrypted blocks moved.', `<button class="button" data-action="export-calibration">Export database</button>`)}
    <div class="grid two">
      ${presetCard('calBefore', 'Before preset', 'Save the untouched or minimum state')}
      ${presetCard('calAfter', 'After preset', 'Change exactly one BDO customization control')}
    </div>
    <div class="spacer"></div>
    <div class="panel"><div class="panel-header"><div><div class="panel-title">Record observation</div><div class="panel-subtitle">Precise labels make the database useful across repeated experiments</div></div></div><div class="panel-body"><div class="inline"><input class="input" style="max-width:460px" id="calibration-label" placeholder="Example: Lahn nose width maximum"><button class="button primary" data-action="observe-calibration" ${state.presets.calBefore && state.presets.calAfter ? '' : 'disabled'}>Analyze changed blocks</button><label class="button"><input class="hidden" type="file" accept="application/json,.json" data-import-calibration>Import JSON</label></div></div></div>
    <div class="spacer"></div>
    <div class="panel"><div class="panel-header"><div><div class="panel-title">Learned observations</div><div class="panel-subtitle">Intersection means blocks changed in every sample; union means blocks changed at least once</div></div><span class="status-chip">${observations.length} mappings</span></div><div class="panel-body"><div class="data-list">${observations.length ? observations.sort((a,b) => a.label.localeCompare(b.label)).map((item) => `<div class="data-row"><div class="data-main"><strong>${escapeHTML(item.label)}</strong><span>${item.samples} sample${item.samples === 1 ? '' : 's'} · intersection [${item.intersection.join(', ')}] · union [${item.union.join(', ')}]</span></div><button class="button compact danger" data-delete-calibration="${escapeHTML(item.label)}">Remove</button></div>`).join('') : '<div class="empty-state">No observations yet. The calibration database stays local and can be exported as JSON.</div>'}</div></div></div>
  </section>`;
}

function renderLibrary() {
  const items = state.library.items;
  return `<section class="view">
    ${viewHeader('Preset Library', 'Scan the Black Desert customization folder, inspect valid version 20 files, and send any preset directly into the simplified workflows.', `<button class="button primary" data-action="scan-library">${state.library.loading ? 'Scanning…' : 'Scan folder'}</button>`)}
    <div class="panel"><div class="panel-header"><div><div class="panel-title">${escapeHTML(state.settings.customizationDir || 'Customization folder not configured')}</div><div class="panel-subtitle">${items.length} valid preset${items.length === 1 ? '' : 's'} found</div></div></div><div class="panel-body"><div class="data-list">
      ${items.length ? items.map((item) => `<div class="data-row"><div class="data-main"><strong>${escapeHTML(item.name)}</strong><span>v${item.version} · class ${escapeHTML(item.classFingerprint)} · ${shortHash(item.sha256)} · ${new Date(item.modifiedAt).toLocaleString()}</span></div><div class="row-actions wrap"><button class="button compact" data-library-load="${escapeHTML(item.path)}" data-library-slot="base" data-library-view="photo">Photo start</button><button class="button compact" data-library-load="${escapeHTML(item.path)}" data-library-slot="donor" data-library-view="photo">Photo helper</button><button class="button compact" data-library-load="${escapeHTML(item.path)}" data-library-slot="base" data-library-view="merge">Merge start</button><button class="button compact" data-library-load="${escapeHTML(item.path)}" data-library-slot="donor" data-library-view="merge">Merge borrow</button><button class="button compact" data-library-load="${escapeHTML(item.path)}" data-library-slot="labLeft" data-library-view="lab">Compare left</button><button class="button compact" data-library-load="${escapeHTML(item.path)}" data-library-slot="labRight" data-library-view="lab">Compare right</button></div></div>`).join('') : '<div class="empty-state">Scan the detected folder or change the path in Settings.</div>'}
    </div>${state.library.warnings.map((warning) => `<div class="callout warning">${escapeHTML(warning)}</div>`).join('')}</div></div>
  </section>`;
}

function renderSettings() {
  return `<section class="view">
    ${viewHeader('Settings', 'FaceForge BDO runs as a private token-protected loopback service. It reads and writes standalone preset files only.', '')}
    <div class="grid two">
      <div class="panel"><div class="panel-header"><div><div class="panel-title">Black Desert paths</div><div class="panel-subtitle">Override detection for OneDrive or custom Documents layouts</div></div></div><div class="panel-body"><div class="field"><label>Customization directory</label><input class="input" data-setting="customization-dir" value="${escapeHTML(state.settings.customizationDir)}"><div class="help">Typical location: Documents\Black Desert\Customization</div></div><div class="field"><label>Default output filename</label><input class="input" data-setting="output-filename" value="${escapeHTML(state.settings.outputFilename)}"></div><button class="button" data-action="scan-library">Verify folder</button></div></div>
      <div class="panel"><div class="panel-header"><div><div class="panel-title">Local service</div><div class="panel-subtitle">Version ${escapeHTML(state.status.version)} · schema ${escapeHTML(state.status.schemaName)}</div></div></div><div class="panel-body stack"><div class="callout success">Connected through a per-launch secret token. API requests without it are rejected.</div><div class="callout">No process injection, memory reading, keyboard automation, or game-client modification is used.</div><button class="button danger" data-action="shutdown">${icons.power} Exit FaceForge BDO</button></div></div>
    </div>
    <div class="spacer"></div>
    <div class="panel"><div class="panel-header"><div><div class="panel-title">Recent activity</div><div class="panel-subtitle">Current session only</div></div></div><div class="panel-body"><div class="data-list">${state.activity.length ? state.activity.map((item) => `<div class="data-row"><div class="data-main"><strong>${escapeHTML(item.message)}</strong><span>${new Date(item.at).toLocaleTimeString()}</span></div></div>`).join('') : '<div class="empty-state">No operations yet.</div>'}</div></div></div>
  </section>`;
}

function renderShell() {
  const renderView = {
    home: renderHome,
    photo: renderPhoto,
    merge: renderMerge,
    library: renderLibrary,
    advanced: renderAdvanced,
    lab: renderLab,
    calibration: renderCalibration,
    settings: renderSettings
  }[state.activeView] ?? renderHome;
  root.className = '';
  root.innerHTML = `<div class="app-shell">
    <header class="topbar"><div class="brand"><div class="brand-mark">FF</div><div class="brand-copy"><strong>FaceForge BDO</strong><span>Offline BDO preset workshop</span></div></div><div class="topbar-spacer"></div><div class="status-chip" title="${escapeHTML(state.settings.customizationDir)}"><span class="status-dot"></span>${escapeHTML(state.settings.customizationDir || 'Local service connected')}</div></header>
    <aside class="sidebar"><div class="nav-label">Workspaces</div>${nav.map(([id, label, icon]) => `<button class="nav-button ${state.activeView === id ? 'active' : ''}" data-nav="${id}"><span class="nav-icon">${icons[icon]}</span>${escapeHTML(label)}</button>`).join('')}<div class="sidebar-footer">Preset format v${state.status.presetVersion}<br>${state.status.groups?.length ?? 0} mapped regions<br>Photo and merge workflows separated</div></aside>
    <main class="main">${renderView()}</main>
  </div>`;
}

async function loadPreset(slot, fileOrData) {
  try {
    const item = fileOrData.data ? fileOrData : await readPresetFile(fileOrData);
    const inspect = await apiPost('/api/inspect', { name: item.name, data: item.data });
    state.presets[slot] = { ...item, inspect };
    if (slot === 'labLeft' || slot === 'labRight') state.compare = null;
    if (slot === 'base' || slot === 'donor') state.blend.result = null;
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
    addActivity(`Analyzed ${file.name} locally.`);
    recalculateSuggestions(false);
    toast(`${file.name} analyzed locally.`, 'success');
  } catch (error) {
    state.portraits[slot] = { name: file.name, preview, loading: false, analysis: null, error: error.message };
    toast(error.message, 'error');
  }
  renderShell();
}

function recalculateSuggestions(showToast = true) {
  const target = state.portraits.target?.analysis?.measurements?.normalized;
  const base = state.portraits.base?.analysis?.measurements?.normalized;
  const donor = state.portraits.donor?.analysis?.measurements?.normalized;
  if (!target || !base || !donor) return;
  state.blend.suggestions = weightsFromProfiles(target, base, donor);
  if (showToast) toast('Photo-based merge suggestions updated.', 'success');
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
    state.presets.generated = { name: safeFilename(state.settings.outputFilename), data: result.data };
    addActivity(`Created ${state.settings.outputFilename} with ${result.changedBlocks.length} changed blocks.`);
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

async function saveResult() {
  if (!state.blend.result) return;
  try {
    const result = await apiPost('/api/save', {
      directory: state.settings.customizationDir,
      filename: safeFilename(state.settings.outputFilename),
      data: state.blend.result.data
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
    case 'apply-suggestions':
      state.blend.weights = mergeSuggestedWeights(state.blend.weights, state.blend.suggestions?.groups, .35);
      state.activeView = 'merge';
      toast('Suggested merge weights applied.', 'success');
      renderShell();
      break;
    case 'recalculate-weights':
      recalculateSuggestions();
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
      downloadBytes(base64ToBytes(state.blend.result.data), safeFilename(state.settings.outputFilename));
      break;
    case 'download-sidecar':
      downloadText(state.blend.result.sidecar, `${safeFilename(state.settings.outputFilename)}.faceforge-bdo.json`);
      break;
    case 'save-result':
      await saveResult();
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
    renderShell();
    return;
  }
  const clearPortrait = event.target.closest('[data-clear-portrait]');
  if (clearPortrait) {
    const item = state.portraits[clearPortrait.dataset.clearPortrait];
    if (item?.preview) URL.revokeObjectURL(item.preview);
    state.portraits[clearPortrait.dataset.clearPortrait] = null;
    state.blend.suggestions = null;
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
  const weight = event.target.closest('[data-weight]');
  if (weight) {
    state.blend.weights[weight.dataset.weight] = Number(weight.value);
    renderShell();
    return;
  }
  const setting = event.target.closest('[data-setting]');
  if (setting) {
    if (setting.dataset.setting === 'cross-class') state.blend.allowCrossClass = setting.checked;
    else if (setting.dataset.setting === 'blend-seed') state.blend.seed = setting.value;
    else if (setting.dataset.setting === 'customization-dir') state.settings.customizationDir = setting.value;
    else if (setting.dataset.setting === 'output-filename') state.settings.outputFilename = setting.value;
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
