const REFERENCE_CATALOG_KEY = 'faceforge-bdo-reference-catalog-v1';
const CALIBRATION_KEY = 'faceforge-bdo-calibration-v1';

export function createInitialState(status = {}) {
  const groups = Array.isArray(status.groups) ? status.groups : [];
  const weights = {};
  for (const group of groups) {
    if (!group.protected) weights[group.id] = 50;
  }
  return {
    activeView: 'create',
    status,
    settings: {
      customizationDir: status.customizationDir ?? '',
      outputFilename: 'FaceForge BDO Preset',
      autoApplyImageWeights: true,
      librarySearch: '',
      libraryProfiledOnly: false
    },
    presets: { base: null, donor: null, labLeft: null, labRight: null, generated: null, calBefore: null, calAfter: null },
    portraits: { target: null, base: null, donor: null },
    blend: {
      weights,
      seed: 'faceforge-bdo',
      allowCrossClass: false,
      suggestions: null,
      result: null
    },
    createFace: {
      stage: 'input',
      processingStep: '',
      result: null,
      autoPlan: null,
      candidates: [],
      warnings: [],
      adjustmentsOpen: false,
      referenceNeeded: null
    },
    library: { items: [], warnings: [], loading: false },
    referenceCatalog: loadReferenceCatalog(),
    calibration: loadCalibration(),
    compare: null,
    activity: []
  };
}

export function recipeFromState(state, groups) {
  return {
    name: state.settings.outputFilename,
    seed: state.blend.seed,
    allowCrossClass: Boolean(state.blend.allowCrossClass),
    allowProtected: false,
    groups: groups
      .filter((group) => !group.protected && Object.hasOwn(state.blend.weights, group.id))
      .map((group) => ({
        groupId: group.id,
        donorId: 'donor',
        weight: Number(state.blend.weights[group.id])
      }))
  };
}

export function mergeSuggestedWeights(current, suggested, minimumConfidence = 0.35) {
  const next = { ...current };
  for (const [groupId, result] of Object.entries(suggested ?? {})) {
    if (Object.hasOwn(next, groupId) && Number(result?.confidence) >= minimumConfidence) {
      next[groupId] = Math.max(0, Math.min(100, Number(result.weight)));
    }
  }
  return next;
}

const uniqueSorted = (values) => [...new Set(values.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
const intersect = (left, right) => {
  const set = new Set(right);
  return left.filter((value) => set.has(value));
};

export function calibrationMerge(database, observation) {
  const label = String(observation?.label ?? '').trim();
  if (!label) throw new Error('Calibration label is required.');
  const changed = uniqueSorted(observation.changedBlocks ?? []);
  const next = database && typeof database === 'object'
    ? structuredClone(database)
    : { version: 1, updatedAt: new Date().toISOString(), observations: {} };
  next.version = 1;
  next.observations ??= {};
  const existing = next.observations[label];
  next.observations[label] = existing
    ? {
        label,
        samples: existing.samples + 1,
        union: uniqueSorted([...existing.union, ...changed]),
        intersection: intersect(existing.intersection, changed),
        lastChangedBlocks: changed
      }
    : {
        label,
        samples: 1,
        union: changed,
        intersection: changed,
        lastChangedBlocks: changed
      };
  next.updatedAt = new Date().toISOString();
  return next;
}

export function saveCalibration(database) {
  try {
    localStorage.setItem(CALIBRATION_KEY, JSON.stringify(database));
  } catch {
    // Storage may be blocked in a hardened browser. The in-memory database still works.
  }
}

export function loadCalibration() {
  try {
    const raw = localStorage.getItem(CALIBRATION_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Invalid or inaccessible local state is safely ignored.
  }
  return { version: 1, updatedAt: null, observations: {} };
}

export function saveReferenceCatalog(database) {
  try {
    localStorage.setItem(REFERENCE_CATALOG_KEY, JSON.stringify(database));
  } catch {
    // Storage may be unavailable; in-memory state still works this session.
  }
}

export function loadReferenceCatalog() {
  try {
    const raw = localStorage.getItem(REFERENCE_CATALOG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && typeof parsed.profiles === 'object') {
        return { version: 1, updatedAt: parsed.updatedAt ?? null, profiles: parsed.profiles ?? {} };
      }
    }
  } catch {
    // Invalid or inaccessible local state is safely ignored.
  }
  return { version: 1, updatedAt: null, profiles: {} };
}

export function upsertReferenceProfile(database, profile) {
  const sha256 = String(profile?.sha256 ?? '').trim().toLowerCase();
  if (!sha256) throw new Error('Reference profile SHA-256 is required.');
  const next = database && typeof database === 'object'
    ? structuredClone(database)
    : { version: 1, updatedAt: null, profiles: {} };
  next.version = 1;
  next.profiles ??= {};
  next.profiles[sha256] = {
    ...next.profiles[sha256],
    ...profile,
    sha256,
    profiledAt: new Date().toISOString()
  };
  next.updatedAt = new Date().toISOString();
  return next;
}

export function removeReferenceProfile(database, sha256) {
  const normalized = String(sha256 ?? '').trim().toLowerCase();
  const next = database && typeof database === 'object'
    ? structuredClone(database)
    : { version: 1, updatedAt: null, profiles: {} };
  next.version = 1;
  next.profiles ??= {};
  delete next.profiles[normalized];
  next.updatedAt = new Date().toISOString();
  return next;
}
