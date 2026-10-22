import { hasDrivingNumbers } from "./practiceNumbers";
import type { Session } from "../model";
export const VERSION = 1;
export const ALGORITHM = "engineer-4";
export const semantics = [
  "speed",
  "longitudinal",
  "lateral",
  "accelerator",
  "throttle",
  "brakePressure",
  "brakePosition",
  "brakeSwitch",
  "rpm",
  "wheelFL",
  "wheelFR",
  "wheelRL",
  "wheelRR",
] as const;
export type Semantic = (typeof semantics)[number];
export type Mapping = {
  channel: string;
  semantic: Semantic;
  unit: string;
  scale: number;
  offset: number;
  confirmed: boolean;
};
export type Context = {
  vehicle: string;
  setup: string;
  tires: string;
  conditions: "dry" | "wet" | "unknown";
  notes: string;
};
export type Corner = {
  id: string;
  name: string;
  start: number;
  end: number;
  direction: "left" | "right" | "complex";
};
export type EngineerSettings = {
  version: 1;
  contexts: Record<string, Context>;
  mappings: Record<string, Mapping[]>;
  corners: Record<string, Corner[]>;
  reports: Report[];
  crossDay: boolean;
};
export const emptySettings = (): EngineerSettings => ({
  version: 1,
  contexts: {},
  mappings: {},
  corners: {},
  reports: [],
  crossDay: false,
});
export type Quality = {
  intervalMs: number | null;
  coverage: number;
  gaps: number;
  reasons: string[];
};
export type Capability = {
  semantic: Semantic;
  channel: string;
  unit: string;
  source: string;
  quality: Quality;
  confidence: "preset" | "user-confirmed";
};
export type Metric = {
  value: number | null;
  unit: string;
  kind: "observed" | "derived" | "modeled";
  method: string;
  channel: string;
  reasons: string[];
};
export type Evidence = {
  id: string;
  snapshotId: string;
  sessionId: string;
  lapId: string;
  cornerId: string;
  time: [number, number];
  distance: [number, number];
  quality: string[];
  metrics: Record<string, Metric>;
  uncertainty: string;
};
export type Priority = {
  id: string;
  evidenceIds: string[];
  observation: string;
  observedDeltaMs: number;
  potentialGainMs: null;
  support: number;
  contradictions: string[];
  repeatability?: {
    medianMs: number;
    spreadMs: number;
    eligibleLaps: number;
    fasterLaps: number;
  };
  confidence: "low" | "medium";
  experiment: string;
  limitations: string[];
};
export type Report = {
  format: "apex-engineer-report";
  version: 1;
  snapshotId: string;
  sessionIds?: string[];
  cornerReviews?: {
    cornerId: string;
    evidenceIds: string[];
    observation: string;
    possibleMistakes: string;
    advice: string;
    successCheck: string;
    limitations: string;
  }[];
  summary?: string;
  debrief?: {
    headline: string;
    assessment: string;
    findings: {
      kind: "pattern" | "progress" | "strength" | "inconsistency";
      title: string;
      observation: string;
      interpretation: string;
      action: string;
      confidence: "low" | "medium";
      evidenceIds: string[];
      lapIds: string[];
    }[];
    practicePlan: {
      title: string;
      instruction: string;
      successCheck: string;
      evidenceIds: string[];
    }[];
  };
  priorities: {
    evidenceIds: string[];
    observation: string;
    explanation: string;
    experiment: string;
    limitations: string;
    category: "telemetry-comparison";
  }[];
};
export type EnvelopeBin = {
  fromMps: number;
  toMps: number;
  acceleration: number | null;
  braking: number | null;
  lateralLeft: number | null;
  lateralRight: number | null;
  events: number;
  laps: number;
  seconds: number;
  confidence: "low" | "medium";
  spread: number | null;
  axisSupport?: Record<string, { events: number; laps: number }>;
  validation?: {
    heldOutLap: string | null;
    exceedanceFraction: number | null;
    note: string;
  };
};
export type Snapshot = {
  version: 1;
  algorithm: string;
  id: string;
  referenceId: string;
  sessionIds: string[];
  contexts: Record<string, Context>;
  capabilities: Record<string, Capability[]>;
  laps: {
    id: string;
    sessionId: string;
    number: number;
    durationMs: number;
    issues: string[];
    coachingEligible: boolean;
  }[];
  corners: Corner[];
  evidence: Evidence[];
  priorities: Priority[];
  envelope: {
    status: string;
    bins: EnvelopeBin[];
    method: string;
    limitations: string[];
  };
  modeled: { status: string; reasons: string[] };
  warnings: string[];
};
export const unknownContext = (): Context => ({
  vehicle: "",
  setup: "",
  tires: "",
  conditions: "unknown",
  notes: "",
});
export function validateSettings(value: unknown): EngineerSettings {
  const v = value as EngineerSettings;
  if (
    !v ||
    v.version !== 1 ||
    typeof v.crossDay !== "boolean" ||
    !v.contexts ||
    !v.mappings ||
    !v.corners ||
    !Array.isArray(v.reports) ||
    v.reports.length > 100
  )
    throw Error("Invalid Race Engineer settings.");
  for (const c of Object.values(v.contexts))
    if (
      !c ||
      !["dry", "wet", "unknown"].includes(c.conditions) ||
      [c.vehicle, c.setup, c.tires, c.notes].some(
        (x) => typeof x !== "string" || x.length > 2000,
      )
    )
      throw Error("Invalid vehicle/conditions context.");
  for (const maps of Object.values(v.mappings)) {
    if (!Array.isArray(maps) || maps.length > 30)
      throw Error("Invalid channel mappings.");
    const seen = new Set();
    for (const m of maps) {
      if (
        !m ||
        !semantics.includes(m.semantic) ||
        seen.has(m.semantic) ||
        typeof m.channel !== "string" ||
        typeof m.unit !== "string" ||
        !Number.isFinite(m.scale) ||
        !Number.isFinite(m.offset) ||
        typeof m.confirmed !== "boolean"
      )
        throw Error("Invalid or duplicate semantic mapping.");
      seen.add(m.semantic);
    }
  }
  for (const corners of Object.values(v.corners)) validateCorners(corners);
  // Sharing permissions, boundary bytes and caches have no place in portable settings.
  return {
    version: 1,
    contexts: v.contexts,
    mappings: v.mappings,
    corners: v.corners,
    reports: v.reports.map(validateReportShape),
    crossDay: v.crossDay,
  };
}
export function validateCorners(v: unknown, length = Infinity): Corner[] {
  if (!Array.isArray(v) || v.length > 200) throw Error("Invalid corner map.");
  const ids = new Set();
  let end = -1;
  for (const c of v) {
    if (
      !c ||
      typeof c.id !== "string" ||
      c.id.length > 100 ||
      ids.has(c.id) ||
      typeof c.name !== "string" ||
      c.name.length > 100 ||
      !["left", "right", "complex"].includes(c.direction) ||
      !Number.isFinite(c.start) ||
      !Number.isFinite(c.end) ||
      c.start < end ||
      c.start < 0 ||
      c.end <= c.start ||
      c.end > length
    )
      throw Error(
        "Corners must be ordered, non-overlapping ranges within the reference lap.",
      );
    ids.add(c.id);
    end = c.end;
  }
  return v;
}
export function validateReportShape(value: unknown): Report {
  const r = value as Report;
  if (
    !r ||
    r.format !== "apex-engineer-report" ||
    r.version !== 1 ||
    typeof r.snapshotId !== "string" ||
    r.snapshotId.length > 200 ||
    (r.summary !== undefined &&
      (typeof r.summary !== "string" || r.summary.length > 3000)) ||
    (r.sessionIds !== undefined &&
      (!Array.isArray(r.sessionIds) ||
        r.sessionIds.length > 1000 ||
        r.sessionIds.some(
          (id) => typeof id !== "string" || !id || id.length > 200,
        ))) ||
    !Array.isArray(r.priorities) ||
    r.priorities.length > 3
  )
    throw Error("Invalid report format or more than three priorities.");
  for (const p of r.priorities)
    if (
      !p ||
      p.category !== "telemetry-comparison" ||
      !Array.isArray(p.evidenceIds) ||
      !p.evidenceIds.length ||
      p.evidenceIds.length > 20 ||
      p.evidenceIds.some((x) => typeof x !== "string" || x.length > 500) ||
      [p.observation, p.explanation, p.experiment, p.limitations].some(
        (x) => typeof x !== "string" || x.length > 3000,
      )
    )
      throw Error(
        "Invalid report priority. Only evidence-linked telemetry comparisons are supported.",
      );
  if (
    r.cornerReviews !== undefined &&
    (!Array.isArray(r.cornerReviews) ||
      r.cornerReviews.length > 200 ||
      r.cornerReviews.some(
        (c) =>
          !c ||
          typeof c.cornerId !== "string" ||
          c.cornerId.length > 100 ||
          !Array.isArray(c.evidenceIds) ||
          !c.evidenceIds.length ||
          c.evidenceIds.length > 20 ||
          c.evidenceIds.some(
            (id) => typeof id !== "string" || id.length > 500,
          ) ||
          [
            c.observation,
            c.possibleMistakes,
            c.advice,
            c.successCheck,
            c.limitations,
          ].some((t) => typeof t !== "string" || !t.trim() || t.length > 1800),
      ))
  )
    throw Error("Invalid corner review.");
  let debrief: Report["debrief"];
  if (r.debrief !== undefined) {
    const d = r.debrief;
    const text = (s: unknown, max: number) =>
      typeof s === "string" && !!s.trim() && s.length <= max;
    const refs = (v: unknown, max: number) =>
      Array.isArray(v) &&
      v.length <= max &&
      v.every((s) => typeof s === "string" && s.length > 0 && s.length <= 500);
    if (
      !d ||
      !text(d.headline, 180) ||
      !text(d.assessment, 1800) ||
      !Array.isArray(d.findings) ||
      d.findings.length > 6 ||
      !Array.isArray(d.practicePlan) ||
      d.practicePlan.length > 3
    )
      throw Error("Invalid session debrief.");
    for (const f of d.findings) {
      if (
        !f ||
        !["pattern", "progress", "strength", "inconsistency"].includes(
          f.kind,
        ) ||
        !["low", "medium"].includes(f.confidence) ||
        !text(f.title, 180) ||
        !text(f.observation, 1200) ||
        !text(f.interpretation, 1200) ||
        !text(f.action, 1000) ||
        !refs(f.evidenceIds, 20) ||
        !refs(f.lapIds, 20) ||
        (!f.evidenceIds.length &&
          !(f.kind === "progress" && f.lapIds.length >= 2))
      )
        throw Error("Invalid evidence-linked debrief finding.");
    }
    for (const p of d.practicePlan)
      if (
        !p ||
        !text(p.title, 180) ||
        !text(p.instruction, 1200) ||
        !text(p.successCheck, 1000) ||
        !refs(p.evidenceIds, 20)
      )
        throw Error("Invalid practice plan.");
    debrief = {
      headline: d.headline,
      assessment: d.assessment,
      findings: d.findings.map((f) => ({
        kind: f.kind,
        title: f.title,
        observation: f.observation,
        interpretation: f.interpretation,
        action: f.action,
        confidence: f.confidence,
        evidenceIds: [...f.evidenceIds],
        lapIds: [...f.lapIds],
      })),
      practicePlan: d.practicePlan.map((p) => ({
        title: p.title,
        instruction: p.instruction,
        successCheck: p.successCheck,
        evidenceIds: [...p.evidenceIds],
      })),
    };
  }
  return {
    format: r.format,
    version: 1,
    snapshotId: r.snapshotId,
    ...(r.cornerReviews
      ? {
          cornerReviews: r.cornerReviews.map((c) => ({
            cornerId: c.cornerId,
            evidenceIds: [...c.evidenceIds],
            observation: c.observation,
            possibleMistakes: c.possibleMistakes,
            advice: c.advice,
            successCheck: c.successCheck,
            limitations: c.limitations,
          })),
        }
      : {}),
    ...(r.sessionIds ? { sessionIds: [...r.sessionIds] } : {}),
    ...(r.summary !== undefined ? { summary: r.summary } : {}),
    ...(debrief ? { debrief } : {}),
    priorities: r.priorities.map((p) => ({
      category: p.category,
      evidenceIds: p.evidenceIds,
      observation: p.observation,
      explanation: p.explanation,
      experiment: p.experiment,
      limitations: p.limitations,
    })),
  };
}
export function validateReport(value: unknown, snapshot: Snapshot): Report {
  const report = validateReportShape(value);
  if (report.snapshotId !== snapshot.id)
    throw Error("Stale report: recompute or use its original snapshot.");
  if (report.debrief || report.cornerReviews)
    report.sessionIds = [...snapshot.sessionIds];
  const resolve = (id: string) => {
    const index = /^e([1-9]\d*)$/.exec(id);
    const full =
      snapshot.evidence.find((e) => e.id === id)?.id ??
      (index ? snapshot.evidence[Number(index[1]) - 1]?.id : undefined);
    if (!full) throw Error("Unknown or out-of-scope evidence ID.");
    return full;
  };
  const checkTitleScope = (title: string, ids: string[]) => {
    const sections = new Set(
      snapshot.evidence
        .filter((e) => ids.includes(e.id))
        .map(
          (e) =>
            snapshot.corners
              .find((c) => c.id === e.cornerId)
              ?.name.match(/^(?:Review window|Section|Turn)\s+(\d+)\b/i)?.[1],
        )
        .filter(Boolean),
    );
    for (const match of title.matchAll(
      /(?:windows?|sections?)\s+(\d+)\s*[-–]\s*(\d+)/gi,
    )) {
      const first = Number(match[1]),
        last = Number(match[2]);
      if (
        last < first ||
        last - first > 200 ||
        Array.from({ length: last - first + 1 }, (_, i) =>
          String(first + i),
        ).some((n) => !sections.has(n))
      )
        throw Error(
          `A section-range title must cite every included section: ${JSON.stringify(title)}. List non-contiguous sections explicitly instead.`,
        );
    }
  };
  const reviewed = new Set<string>();
  for (const c of report.cornerReviews ?? []) {
    if (
      reviewed.has(c.cornerId) ||
      !snapshot.corners.some((x) => x.id === c.cornerId)
    )
      throw Error("Unknown or duplicate reviewed corner.");
    reviewed.add(c.cornerId);
    c.evidenceIds = [...new Set(c.evidenceIds.map(resolve))];
    if (
      c.evidenceIds.some(
        (id) =>
          snapshot.evidence.find((e) => e.id === id)?.cornerId !== c.cornerId,
      )
    )
      throw Error("Corner advice cites another section.");
    if (
      c.evidenceIds.some(
        (id) => snapshot.evidence.find((e) => e.id === id)?.quality.length,
      )
    )
      throw Error("Corner review cites an unreliable comparison window.");
    const proseIssues: string[] = [];
    if (
      hasDrivingNumbers(c.advice + " " + c.successCheck, snapshot, c.cornerId)
    )
      proseIssues.push(
        "Put measured numeric facts in observation. Advice and successCheck must not contain numerical driving targets, distances, speeds, times, G targets or arbitrary tolerances. Known corner/lap labels and small repetition counts such as 3 clean passes are allowed. Compare against the measured baseline.",
      );
    if (
      /\bm\/s\b/.test(
        [c.observation, c.possibleMistakes, c.advice, c.successCheck].join(" "),
      )
    )
      proseIssues.push(
        "Use the requested dashboard speed units (km/h or mph), not m/s in prose. G comparisons use g.",
      );
    if (
      /(?:brak(?:e|ing)\s+(?:later|harder|deeper)|(?:later|harder|deeper)\s+brak(?:e|ing)|accelerat(?:e|ing)\s+harder|release\s+lateral\s+load)/i.test(
        c.advice,
      )
    )
      proseIssues.push(
        "Do not prescribe increased brake/accelerator effort, later braking or releasing lateral load from speed/G estimates. Use a comfortable existing reference and an instructor-guided repeatability test.",
      );
    if (proseIssues.length)
      throw Error("Corner coaching validation: " + proseIssues.join(" "));
    const best = snapshot.evidence
      .filter(
        (e) =>
          e.cornerId === c.cornerId &&
          !e.quality.length &&
          snapshot.laps.some((l) => l.id === e.lapId && l.coachingEligible) &&
          e.metrics.elapsed?.unit === "ms" &&
          typeof e.metrics.elapsed.value === "number" &&
          Number.isFinite(e.metrics.elapsed.value) &&
          e.metrics.elapsed.value > 0,
      )
      .sort(
        (a, b) =>
          a.metrics.elapsed.value! - b.metrics.elapsed.value! ||
          a.lapId.localeCompare(b.lapId),
      );
    const distinct = best
      .filter((e, i) => best.findIndex((x) => x.lapId === e.lapId) === i)
      .slice(0, 3);
    if (!distinct.length || distinct.some((e) => !c.evidenceIds.includes(e.id)))
      throw Error(
        "Corner review must cite all available top-three passes in this section.",
      );
  }
  for (const p of report.priorities) p.evidenceIds = p.evidenceIds.map(resolve);
  for (const f of report.debrief?.findings ?? []) {
    f.evidenceIds = [...new Set(f.evidenceIds.map(resolve))];
    f.lapIds = f.lapIds.map((id) => {
      const index = /^l([1-9]\d*)$/.exec(id);
      const full =
        snapshot.laps.find((l) => l.id === id)?.id ??
        (index ? snapshot.laps[Number(index[1]) - 1]?.id : undefined);
      if (!full) throw Error("Unknown or out-of-scope lap ID.");
      return full;
    });
    const sources = snapshot.evidence.filter((e) =>
      f.evidenceIds.includes(e.id),
    );
    const laps = new Set([...f.lapIds, ...sources.map((e) => e.lapId)]);
    checkTitleScope(f.title, f.evidenceIds);
    const eligibleSources = sources.filter(
      (e) =>
        !e.quality.length &&
        snapshot.laps.some((l) => l.id === e.lapId && l.coachingEligible) &&
        e.metrics.elapsed?.unit === "ms" &&
        Number.isFinite(e.metrics.elapsed.value),
    );
    const sourceLaps = new Set(eligibleSources.map((e) => e.lapId));
    if (
      f.kind === "pattern" &&
      (sourceLaps.size < 2 ||
        (new Set(eligibleSources.map((e) => e.cornerId)).size < 2 &&
          sourceLaps.size < 3))
    )
      throw Error(
        "A recurring pattern needs multiple laps and repeated section evidence.",
      );
    if (f.kind === "progress") {
      const clean = snapshot.laps.filter(
        (l) => laps.has(l.id) && l.coachingEligible && !l.issues.length,
      );
      if (
        !snapshot.sessionIds.some(
          (id) => clean.filter((l) => l.sessionId === id).length >= 2,
        )
      )
        throw Error(
          "Progress needs at least two clean selected laps from one recording.",
        );
    }
  }
  for (const p of report.debrief?.practicePlan ?? []) {
    p.evidenceIds = p.evidenceIds.map(resolve);
    if (p.evidenceIds.length) checkTitleScope(p.title, p.evidenceIds);
  }
  return report;
}
export function contextFor(s: Session, settings: EngineerSettings) {
  return settings.contexts[s.id] ?? unknownContext();
}
