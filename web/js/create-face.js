import { clamp01, weightsFromProfiles } from './face-analysis.js';

export const SUPPORTED_GROUPS = ['face_geometry', 'eyes_brows'];
export const UNSUPPORTED_GROUPS = ['hair', 'body', 'makeup_detail', 'skin_finish', 'extended'];

const GROUP_METRICS = {
  face_geometry: ['faceAspect', 'noseWidth', 'mouthWidth', 'jawWidth', 'lowerFace'],
  eyes_brows: ['eyeSpacing', 'eyeOpenness']
};

export function metricDistance(target, donor, metricNames) {
  const deltas = [];
  for (const metric of metricNames) {
    const left = Number(target?.[metric]);
    const right = Number(donor?.[metric]);
    if (Number.isFinite(left) && Number.isFinite(right)) deltas.push(Math.abs(left - right));
  }
  if (deltas.length === 0) return 1;
  return deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
}

export function rankReferenceCandidates(targetMetrics, candidates = []) {
  return [...candidates]
    .map((candidate) => {
      const metrics = candidate?.metrics ?? candidate?.analysis?.measurements?.normalized;
      return {
        ...candidate,
        metrics,
        overallDistance: metricDistance(targetMetrics, metrics, [...GROUP_METRICS.face_geometry, ...GROUP_METRICS.eyes_brows]),
        groupDistances: Object.fromEntries(Object.entries(GROUP_METRICS).map(([groupId, names]) => [groupId, metricDistance(targetMetrics, metrics, names)]))
      };
    })
    .sort((left, right) => {
      if (left.overallDistance !== right.overallDistance) return left.overallDistance - right.overallDistance;
      return String(left.name ?? '').localeCompare(String(right.name ?? ''));
    });
}

function automaticBorrowWeight(distance, quality = 1) {
  const closeness = clamp01(1 - distance / 0.35);
  return Math.round((0.70 + 0.30 * closeness * quality) * 100);
}

function qualityForCandidate(candidate) {
  return clamp01(candidate?.analysis?.measurements?.quality?.symmetry ?? 1);
}

function donorForGroup(ranked, groupId) {
  return [...ranked].sort((left, right) => {
    if (left.groupDistances[groupId] !== right.groupDistances[groupId]) {
      return left.groupDistances[groupId] - right.groupDistances[groupId];
    }
    return left.overallDistance - right.overallDistance;
  })[0] ?? null;
}

export function buildAutomaticPlan({ targetMetrics, baseMetrics = null, candidates = [] }) {
  if (!targetMetrics) throw new Error('A target face profile is required.');
  const ranked = rankReferenceCandidates(targetMetrics, candidates);
  if (ranked.length === 0) {
    return {
      ranked: [],
      selected: [],
      recipeGroups: [],
      groups: {},
      warnings: ['FaceForge needs at least one screenshot-profiled same-class preset before it can match a photo honestly.'],
      confidence: 0,
      summary: 'No compatible references found.'
    };
  }

  const selected = ranked.slice(0, 3);
  const top = selected[0];
  const groups = {};
  const recipeGroups = [];
  const warnings = [];

  for (const groupId of SUPPORTED_GROUPS) {
    const donor = donorForGroup(selected, groupId) ?? top;
    let weight = 100;
    let confidence = clamp01(1 - donor.groupDistances[groupId] / 0.35) * qualityForCandidate(donor);

    if (baseMetrics) {
      const weighted = weightsFromProfiles(targetMetrics, baseMetrics, donor.metrics).groups[groupId];
      weight = Math.max(0, Math.min(100, Math.round(weighted?.weight ?? 50)));
      confidence = Math.max(confidence, Number(weighted?.confidence ?? 0));
      if (!Number.isFinite(weight) || weight < 0 || weight > 100) weight = 50;
    } else {
      weight = automaticBorrowWeight(donor.groupDistances[groupId], qualityForCandidate(donor));
    }

    groups[groupId] = {
      donorId: donor.id,
      donorName: donor.name,
      weight,
      confidence,
      distance: donor.groupDistances[groupId]
    };
    recipeGroups.push({ groupId, donorId: donor.id, weight });
  }

  if (!baseMetrics) {
    warnings.push('The starting preset has no screenshot profile, so FaceForge fully borrows the supported facial groups from the closest same-class references.');
  }

  for (const groupId of UNSUPPORTED_GROUPS) {
    groups[groupId] = {
      donorId: top.id,
      donorName: top.name,
      weight: 0,
      confidence: 0,
      distance: top.overallDistance
    };
  }

  const confidence = clamp01(SUPPORTED_GROUPS
    .map((groupId) => Number(groups[groupId]?.confidence ?? 0))
    .reduce((sum, value) => sum + value, 0) / SUPPORTED_GROUPS.length || 0);

  let summary = 'Low confidence';
  if (confidence >= 0.75) summary = 'High confidence';
  else if (confidence >= 0.4) summary = 'Medium confidence';

  return { ranked, selected, recipeGroups, groups, warnings, confidence, summary };
}
