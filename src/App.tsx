import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronRight,
  Cloud,
  Flag,
  FolderOpen,
  Layers,
  MapPin,
  Play,
  Pause,
  Plus,
  Settings2,
  Video,
  X,
} from "lucide-react";
import type {
  Session,
  Settings,
  SyncFile,
  Trace,
  Binding,
  Comparison,
} from "./model";
import { definitions, lapTime } from "./model";
import {
  align,
  trace,
  optimal,
  virtual,
  interpolate,
  followRange,
  blocksOptimal,
  opportunities,
  optimalWith,
  STEP_MS,
  SHIFT_STEP_FACTOR,
  type Sector,
} from "./analysis";
import {
  load,
  saveSession,
  updateSession,
  removeSession,
  saveState,
  work,
  download,
  exportProject,
  createProject,
  readProject,
  commitProject,
  validateSync,
} from "./storage";
import {
  availableChannels,
  brakingPoints,
  matchBrakePoints,
  type BrakeMarker,
} from "./telemetry";
import { replayWindow, advanceReplay, PLAYBACK_RATES } from "./replay";
import { BrakingComparison } from "./BrakingComparison";
import { TrackView } from "./TrackView";
import { Opportunities } from "./Opportunities";
import { SessionSummary } from "./SessionSummary";
import { RemoveSession } from "./RemoveSession";
import { LapReview } from "./LapReview";
import { ClockInput } from "./ClockInput";
import { lapStatus, STATUS_LABEL } from "./lapStatus";
import { summarize } from "./summary";
import { classifyFile, describeImport } from "./files";
import { applyLine, reconcileVbo, resolveVbo } from "./vboImport";
import { LineEditor } from "./LineEditor";
import { TrackChooser } from "./TrackChooser";
import { assignTrack, knownTracks, summarizeTracks } from "./tracks";
import type { TrackSummary } from "./tracks";
import { TracksMap } from "./TracksMap";
import {
  catalogVenues,
  decodeVenue,
  layoutSourceText,
  searchVenues,
  venueOf,
} from "./venues";
import type { Venue, VenueGeometry, VenueShape } from "./venues";
import {
  groupSessions,
  isSelected,
  toggleSessions,
  onlySessions,
  selectionState,
  opportunityScope,
} from "./groups";
import { Chart } from "./Chart";
import { VideoPanel } from "./Video";
import { ProjectImportDialog } from "./ProjectImportDialog";
import type { ImportDecision } from "./ProjectImportDialog";
import type { LoadedProject } from "./storage";
import { matchProjectVideos, restoredVideoPosition } from "./projectVideos";
import { GoogleDriveDialog } from "./GoogleDriveDialog";
import { useGoogleDrive } from "./useGoogleDrive";
import raceLabLogo from "./assets/racelab-logo-light.svg";
const defaults: Settings = {
  speedUnit: "km/h",
  colors: ["#ff8855", "#8ed4b2"],
  videoHeight: 280,
  a: "",
  b: "",
  charts: [
    { id: "speed", channels: ["speed"], height: 135 },
    { id: "rpm", channels: ["rpm"], height: 110 },
    { id: "throttle", channels: ["throttle"], height: 100 },
  ],
  excluded: [],
  included: [],
  layouts: [],
  mode: "distance",
  mapHeight: 340,
  collection: [],
  group: "track",
  extras: [],
};
// Colors for laps added after lap B. Lap A and B keep the colors from the settings.
const EXTRA_COLORS = ["#c792ea", "#f2d15b", "#7fb2ff", "#ff7a90"];
const emptySync: SyncFile = { format: "apex-sync", version: 1, bindings: [] };
export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]),
    [settings, setSettings] = useState(defaults),
    [sync, setSync] = useState(emptySync),
    [ready, setReady] = useState(false),
    [tab, setTab] = useState("Analyze"),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [cursor, setCursor] = useState(0),
    [range, setRange] = useState<[number, number]>([0, 20000]),
    [playing, setPlaying] = useState(false),
    [files, setFiles] = useState<Record<string, string>>({}),
    [showVideos, setShowVideos] = useState(false),
    [catalog, setCatalog] = useState<Venue[]>([]),
    [catalogFailed, setCatalogFailed] = useState(false),
    [search, setSearch] = useState(""),
    // The Tracks screen: a catalog venue picked by search (else the venue of the track in
    // view), and an OpenStreetMap layout of it (null shows your recorded track instead).
    [venueId, setVenueId] = useState<string | null>(null),
    [osmLayout, setOsmLayout] = useState<number | null>(null),
    [shapes, setShapes] = useState<Record<string, VenueShape | null>>({}),
    [trackView, setTrackView] = useState<number | null>(null),
    [traces, setTraces] = useState<Trace[]>([]),
    [summaryId, setSummaryId] = useState<string | null>(null),
    [reviewId, setReviewId] = useState<string | null>(null),
    [lineFor, setLineFor] = useState<string | null>(null),
    [trackFor, setTrackFor] = useState<string | null>(null),
    // Exact lap A time in ms. Position alone cannot say when, because a stop repeats it.
    [exact, setExact] = useState<number | null>(null),
    [oppDay, setOppDay] = useState<string>(),
    [busyA, setBusyA] = useState(false),
    [busyB, setBusyB] = useState(false);
  const [saving, setSaving] = useState(false);
  const [videoRestore, setVideoRestore] = useState<{
    lapId: string;
    timestamp: number;
  } | null>(null);
  const [sourceFiles, setSourceFiles] = useState<Record<string, File>>({});
  const [driveOpen, setDriveOpen] = useState(false);
  const [projectReview, setProjectReview] = useState<{
    project: LoadedProject;
    name: string;
    decide: (d: ImportDecision | null) => void;
  }>();
  const [removeId, setRemoveId] = useState<string | null>(null),
    [removing, setRemoving] = useState(false),
    [removeError, setRemoveError] = useState("");
  const pendingSave = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [playbackRate, setPlaybackRate] = useState(1),
    [loopSection, setLoopSection] = useState(false),
    [showBrakePoints, setShowBrakePoints] = useState(false);
  const sessionsRef = useRef<Session[]>([]),
    importRef = useRef<(list: File[]) => void>(() => {}),
    [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    abort = useRef<AbortController | null>(null);
  const patch = (p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p }));
  const report = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  useEffect(() => {
    load()
      .then((d) => {
        setSessions(
          d.records.map((r) => r.session).sort((a, b) => a.start - b.start),
        );
        if (d.settings) {
          const legacyPalette =
            d.settings.colors[0] === "#63e5d2" &&
            d.settings.colors[1] === "#f8a36b";
          setSettings({
            ...defaults,
            ...d.settings,
            colors: legacyPalette ? defaults.colors : d.settings.colors,
          });
        }
        if (d.sync) setSync(d.sync);
        setReady(true);
      })
      .catch(report);
    fetch("/tracks.json")
      .then((r) => r.json())
      .then((d) => setCatalog(catalogVenues(d)))
      .catch(() => setCatalogFailed(true));
  }, []);
  useEffect(() => {
    if (!ready || removing) return;
    setSaving(true);
    const t = setTimeout(() => {
      Promise.all([saveState("settings", settings), saveState("sync", sync)])
        .then(() => setSaving(false))
        .catch(report);
    }, 150);
    pendingSave.current = t;
    return () => clearTimeout(t);
  }, [settings, sync, ready, removing]);
  const activeTrack = sessions.find((s) =>
    s.laps.some((l) => l.id === settings.a),
  )?.trackId;
  const reference = useMemo(() => {
    const pool = sessions
      .filter((s) => activeTrack === undefined || s.trackId === activeTrack)
      .flatMap((s) => s.laps);
    return (
      settings.layouts.find((l) => pool.some((p) => p.id === l.referenceId))
        ?.referenceId ||
      [...pool]
        .filter((l) => !l.issues.length)
        .sort((a, b) => a.end - a.start - (b.end - b.start))[0]?.id ||
      pool[0]?.id
    );
  }, [sessions, settings.layouts, activeTrack]);
  useEffect(() => {
    if (!sessions.length) return;
    let live = true;
    work<{ traces: Trace[] }>("analysis", {
      sessions,
      reference,
      ids: [],
      gates: [],
    })
      .then((d) => {
        if (live) setTraces(d.traces);
      })
      .catch(report);
    return () => {
      live = false;
    };
  }, [sessions, reference]);
  const ref = traces.find((t) => t.id === reference);
  const layout = settings.layouts.find((l) => l.referenceId === reference);
  const gates = useMemo(
    () =>
      layout?.gates ||
      (ref
        ? Array.from(
            { length: Math.max(2, Math.round(ref.length / 1000)) + 1 },
            (_, i) =>
              (ref.length * i) / Math.max(2, Math.round(ref.length / 1000)),
          )
        : []),
    [layout, ref],
  );
  // A lap can feed sector times when it aligns to the reference and nobody excluded it.
  const usable = (t: Trace) =>
    !t.issues.some(
      (i) => i.includes("Incompatible") || i.includes("Ambiguous"),
    ) &&
    !settings.excluded.includes(t.id) &&
    (!blocksOptimal(t.issues) || settings.included.includes(t.id));
  const eligible = useMemo(
    () =>
      traces.filter(
        (t) =>
          (!settings.collection.length ||
            settings.collection.includes(t.sessionId)) &&
          usable(t),
      ),
    [traces, settings.excluded, settings.included, settings.collection],
  );
  const sectors = useMemo(() => optimal(eligible, gates), [eligible, gates]);
  const ideal = useMemo(
    () => (sectors.length === gates.length - 1 ? virtual(sectors) : undefined),
    [sectors, gates],
  );
  // Only sessions ticked in the collection reach the pickers, totals and optimal lap.
  const inScope = (sessionId: string) =>
    isSelected(settings.collection, sessionId);
  const scoped = useMemo(
    () => traces.filter((t) => isSelected(settings.collection, t.sessionId)),
    [traces, settings.collection],
  );
  const multiTrack =
    new Set(sessions.filter((x) => inScope(x.id)).map((x) => x.trackId)).size >
    1;
  const a =
      scoped.find((t) => t.id === settings.a) ||
      scoped.find((t) => t.id === reference) ||
      scoped[0] ||
      traces[0],
    b =
      settings.b === "optimal"
        ? ideal
        : scoped.find(
            (t) =>
              t.id === settings.b &&
              !t.issues.some((i) => i.includes("Incompatible")),
          );
  useEffect(() => {
    if (!ready || !traces.length) return;
    const current = traces.find((t) => t.id === settings.a);
    if (current && !inScope(current.sessionId)) {
      const next = scoped.find((t) => t.id === reference) || scoped[0];
      if (next) patch({ a: next.id });
    }
    const other = traces.find((t) => t.id === settings.b);
    if (other && !inScope(other.sessionId)) patch({ b: "" });
  }, [settings.collection, traces]);
  useEffect(() => {
    if (!settings.a && ref) {
      const other = traces.find(
        (t) => t.sessionId !== ref.sessionId && !t.issues.length,
      );
      patch({ a: ref.id, b: other?.id || "" });
    }
  }, [ref, settings.a]);
  // Laps added after B. Slot C is the first, then D, E and F.
  const extraLaps = useMemo(
    () =>
      (settings.extras ?? []).flatMap((e, i) => {
        const trace =
          e.id === "optimal"
            ? ideal
            : scoped.find(
                (t) =>
                  t.id === e.id &&
                  !t.issues.some((x) => x.includes("Incompatible")),
              );
        return trace && trace.id !== a?.id
          ? [{ ...e, tag: String.fromCharCode(67 + i), trace }]
          : [];
      }),
    [settings.extras, scoped, ideal, a?.id],
  );
  const displayTraces = useMemo(
    () =>
      [a, b, ...extraLaps.map((x) => x.trace)].map((t) => {
        if (!t || settings.speedUnit === "km/h") return t;
        return {
          ...t,
          channels: {
            ...t.channels,
            ...Object.fromEntries(
              ["speed", "obdSpeed"]
                .filter((id) => t.channels[id])
                .map((id) => [
                  id,
                  Float64Array.from(t.channels[id], (v) => v / 1.609344),
                ]),
            ),
          },
        };
      }),
    [a, b, extraLaps, settings.speedUnit],
  );
  const channelsWithData = useMemo(
    () => availableChannels(displayTraces),
    [displayTraces],
  );
  const visibleCharts = settings.charts
    .map((chart, index) => ({ chart, index }))
    .filter(
      ({ chart }) =>
        settings.showEmptyCharts ||
        chart.channels.some((id) => channelsWithData.has(id)),
    );
  const emptyChartCount = settings.charts.filter(
    (chart) => !chart.channels.some((id) => channelsWithData.has(id)),
  ).length;
  const brakePairs = useMemo(
    () =>
      a &&
      b &&
      b.sessionId !== "optimal" &&
      ![a, b].some((t) =>
        t.issues.some((issue) => /Ambiguous|Incompatible/.test(issue)),
      )
        ? matchBrakePoints(brakingPoints(a), brakingPoints(b))
        : [],
    [a, b],
  );
  const brakeMarkers = useMemo<BrakeMarker[]>(
    () =>
      !showBrakePoints || !a || !b || b.sessionId === "optimal"
        ? []
        : brakePairs.flatMap((pair, i) => [
            ...(pair.a
              ? [
                  {
                    trace: a,
                    color: settings.colors[0],
                    label: `A${i + 1}`,
                    distance: pair.a.start,
                  },
                ]
              : []),
            ...(pair.b
              ? [
                  {
                    trace: b,
                    color: settings.colors[1],
                    label: `B${i + 1}`,
                    distance: pair.b.start,
                  },
                ]
              : []),
          ]),
    [a, b, brakePairs, showBrakePoints, settings.colors],
  );
  const sectionTimes = useMemo(
    () => (a ? replayWindow(a, range) : undefined),
    [a, range],
  );
  const canLoop = !!a && !!sectionTimes && range[1] - range[0] < a.length - 1;
  useEffect(() => {
    if (!canLoop) setLoopSection(false);
  }, [canLoop]);
  const sa = sessions.find((s) => s.id === a?.sessionId);
  const sb = sessions.find((s) => s.id === b?.sessionId);
  // Opportunities use the ticked sessions, or all sessions of one day by default.
  const scope = useMemo(
    () => opportunityScope(sessions, settings.collection, oppDay, a?.sessionId),
    [sessions, settings.collection, oppDay, a?.sessionId],
  );
  const opp = useMemo(() => {
    const onTrack = (t: Trace) =>
      sessions.find((x) => x.id === t.sessionId)?.trackId === sa?.trackId;
    const inScopeLaps = traces.filter(
      (t) => scope.ids.includes(t.sessionId) && onTrack(t),
    );
    const sectorsHere = optimal(inScopeLaps.filter(usable), gates);
    const fastest = inScopeLaps
      .filter(
        (t) =>
          !t.issues.some(
            (i) =>
              i.includes("Incompatible") ||
              i.includes("Ambiguous") ||
              i.includes("Interrupted") ||
              i.includes("invalid"),
          ),
      )
      .sort((x, y) => x.lap.end - x.lap.start - (y.lap.end - y.lap.start))[0];
    if (!fastest || !gates.length || sectorsHere.length !== gates.length - 1)
      return undefined;
    return {
      fastest,
      list: opportunities(fastest, sectorsHere),
      bestMs: fastest.lap.end - fastest.lap.start,
      optMs: sectorsHere.reduce((n, x) => n + x.time, 0),
    };
  }, [traces, scope, gates, settings.excluded, settings.included, sa?.trackId]);
  // Best sectors of a single session, for the lap summary.
  const sessionOpt = useMemo(() => {
    const out = new Map<string, number>();
    if (gates.length < 2) return out;
    for (const x of sessions) {
      const sec = optimal(
        traces.filter((t) => t.sessionId === x.id && usable(t)),
        gates,
      );
      if (sec.length === gates.length - 1)
        out.set(
          x.id,
          sec.reduce((n, v) => n + v.time, 0),
        );
    }
    return out;
  }, [sessions, traces, gates, settings.excluded, settings.included]);
  const summarySession = sessions.find((x) => x.id === summaryId);
  // The lap under review and what counting it would do. Nothing is applied here.
  const reviewTrace = traces.find((t) => t.id === reviewId);
  const reviewSession = sessions.find((x) => x.id === reviewTrace?.sessionId);
  const reviewStatus = reviewTrace
    ? lapStatus({
        issues: reviewTrace.issues,
        sameTrack: reviewSession?.trackId === sa?.trackId,
        selected: inScope(reviewTrace.sessionId),
        excluded: settings.excluded.includes(reviewTrace.id),
        included: settings.included.includes(reviewTrace.id),
      })
    : "counts";
  const reviewEffect =
    reviewTrace &&
    reviewStatus !== "other-track" &&
    reviewStatus !== "unusable" &&
    gates.length > 1
      ? optimalWith(eligible, reviewTrace, gates)
      : undefined;
  useEffect(() => {
    if (a) {
      setPlaying(false);
      setLoopSection(false);
      setRange([0, a.length]);
      setExact(null);
      setCursor(0);
    }
  }, [a?.id, a?.length]);
  useEffect(() => {
    if (!videoRestore || a?.id !== videoRestore.lapId) return;
    setPlaying(false);
    setExact(videoRestore.timestamp);
    setCursor(interpolate(a.times, a.distance, videoRestore.timestamp));
    setVideoRestore(null);
  }, [videoRestore, a?.id]);
  const at = a ? (exact ?? interpolate(a.distance, a.times, cursor)) : 0;
  // Moving by position forgets the exact time; moving by time keeps it.
  const moveCursor = (d: number) => {
    setExact(null);
    setCursor(d);
  };
  const live = useRef({
    a,
    at,
    range,
    busy: false,
    playbackRate,
    loopSection,
    sectionTimes,
  });
  live.current = {
    a,
    at,
    range,
    busy: busyA || busyB,
    playbackRate,
    loopSection,
    sectionTimes,
  };
  const lastTick = useRef(0);
  const toggle = useRef<() => void>(() => {});
  const goTo = (t: number) => {
    const { a: A } = live.current;
    if (!A) return;
    const time = Math.max(A.times[0], Math.min(A.times[A.times.length - 1], t));
    const d = interpolate(A.times, A.distance, time);
    if (!Number.isFinite(d)) return;
    setExact(time);
    setCursor(d);
    // A zoomed window follows the cursor instead of leaving it behind.
    if (!live.current.loopSection) setRange((r) => followRange(r, d, A.length));
  };
  // Play or pause. From the very end it starts over at the beginning of the lap, with the
  // zoom window moved back to the start.
  const togglePlay = () => {
    const {
      a: A,
      range: r,
      loopSection: loop,
      sectionTimes: section,
    } = live.current;
    if (!A) return;
    if (
      !playing &&
      loop &&
      section &&
      (live.current.at < section[0] || live.current.at >= section[1])
    )
      goTo(section[0]);
    if (!playing && !loop && cursor >= A.length - 1) {
      const width = r[1] - r[0];
      setRange(width >= A.length - 1 ? [0, A.length] : [0, width]);
      moveCursor(0);
    }
    setPlaying(!playing);
  };
  toggle.current = togglePlay;
  const elapsed = a ? at - a.lap.start : 0;
  const bcursor =
    settings.mode === "time" && b
      ? interpolate(b.times, b.distance, b.lap.start + elapsed)
      : cursor;
  const comparisons: Comparison[] = [
    ...(displayTraces[1]
      ? [
          {
            trace: displayTraces[1],
            color: settings.colors[1],
            cursor: bcursor,
            tag: "B",
          },
        ]
      : []),
    ...extraLaps.map((x, i) => ({
      trace: displayTraces[2 + i]!,
      color: x.color,
      cursor:
        settings.mode === "time"
          ? interpolate(
              x.trace.times,
              x.trace.distance,
              x.trace.lap.start + elapsed,
            )
          : cursor,
      tag: x.tag,
    })),
  ];
  const bt = b ? interpolate(b.distance, b.times, bcursor) : 0;
  const delta = b ? elapsed - (bt - b.lap.start) : NaN;
  const optimalSource =
    b?.id === "optimal"
      ? sectors.find((s) => bcursor >= s.start && bcursor <= s.end)
      : undefined;
  const videoSessionB = optimalSource
    ? sessions.find((s) => s.id === optimalSource.source.sessionId)
    : sb;
  const videoStampB = optimalSource
    ? interpolate(
        optimalSource.source.distance,
        optimalSource.source.times,
        bcursor,
      )
    : bt;
  // Left and right arrows move lap A by 0.05 s of lap time; Shift moves 10 times as far.
  useEffect(() => {
    if (!a || (tab !== "Analyze" && tab !== "Video sync")) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (
        el?.isContentEditable ||
        ["INPUT", "SELECT", "TEXTAREA"].includes(el?.tagName || "")
      )
        return;
      e.preventDefault();
      const ms =
        (e.key === "ArrowRight" ? 1 : -1) *
        STEP_MS *
        (e.shiftKey ? SHIFT_STEP_FACTOR : 1);
      // Step by time, so a stop is crossed at the same pace as everything else.
      goTo(live.current.at + ms);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [a, tab]);
  // Space plays and pauses, wherever the focus is except where a space is typed or means
  // something else. A button that was just clicked keeps focus, so Space must not press
  // it again.
  useEffect(() => {
    if (!a || (tab !== "Analyze" && tab !== "Video sync")) return;
    const mine = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return false;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
      if (document.querySelector(".modal-backdrop")) return false;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName ?? "";
      const type = (el as HTMLInputElement | null)?.type;
      if (
        el?.isContentEditable ||
        ["SELECT", "TEXTAREA", "VIDEO", "SUMMARY", "OPTION"].includes(tag) ||
        (tag === "INPUT" && !["range", "color", "button"].includes(type ?? ""))
      )
        return false;
      return true;
    };
    const down = (e: KeyboardEvent) => {
      if (!mine(e)) return;
      e.preventDefault();
      if (!e.repeat) toggle.current();
    };
    // Buttons press on key release, so block that as well.
    const up = (e: KeyboardEvent) => {
      if (mine(e)) e.preventDefault();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [a, tab]);
  // Replay advances the lap clock at the selected speed. Normal playback scrolls
  // the view; looping keeps the selected window fixed and wraps its clock.
  useEffect(() => {
    if (!playing || !a) return;
    lastTick.current = performance.now();
    const timer = setInterval(() => {
      const now = performance.now(),
        dt = now - lastTick.current;
      lastTick.current = now;
      const {
        a: A,
        at: here,
        busy,
        playbackRate: rate,
        loopSection: loop,
        sectionTimes: section,
      } = live.current;
      if (busy || !A) return;
      const bounds: [number, number] =
        loop && section ? section : [A.times[0], A.times.at(-1)!];
      const next = advanceReplay(here, dt, rate, bounds, loop && !!section);
      // Keep the exact clock running through stops and outages.
      setExact(next.time);
      const d = interpolate(A.times, A.distance, next.time);
      if (Number.isFinite(d)) {
        setCursor(d);
        if (!loop) setRange((r) => followRange(r, d, A.length));
      }
      if (next.ended) setPlaying(false);
    }, 80);
    return () => clearInterval(timer);
  }, [playing, a]);
  // Brings VBO sessions into line with the tracks and finish lines that are known now.
  async function reconcile() {
    const fresh = (await load()).records
      .map((r) => r.session)
      .sort((a, b) => a.start - b.start);
    const merged = reconcileVbo(fresh);
    if (merged === fresh) return;
    for (const m of merged) if (!fresh.includes(m)) await updateSession(m);
    setSessions(merged);
  }
  // Sessions, projects and sync files, from the file picker or dropped anywhere on the
  // window. Each file is handled on its own, so one bad file does not stop the rest.
  async function importFiles(list: File[]) {
    if (abort.current) return;
    setError("");
    abort.current = new AbortController();
    const added: Session[] = [],
      failures: string[] = [];
    let projectImported = false;
    let alreadyThere = 0,
      videos = 0;
    // VBO files borrow their finish line from sessions of the same track, so in a mixed
    // batch the RaceChrono sessions go first.
    const isVbo = (f: File) => /\.vbo$/i.test(f.name);
    const ordered = [...list].sort(
      (a, b) => Number(isVbo(a)) - Number(isVbo(b)),
    );
    for (const file of ordered) {
      if (abort.current?.signal.aborted) break;
      try {
        const kind = classifyFile(file.name);
        if (kind === "video") {
          videos++;
        } else if (kind === "unsupported") {
          failures.push(`${file.name}: not a session file (.rcz or .vbo)`);
        } else if (kind === "sync") {
          const imported = validateSync(JSON.parse(await file.text()));
          setSync((st) => ({
            ...st,
            bindings: [
              ...st.bindings.filter(
                (b) =>
                  !imported.bindings.some(
                    (n) => n.session.sha256 === b.session.sha256,
                  ),
              ),
              ...imported.bindings,
            ],
          }));
          setStatus(
            "Synchronization restored. Select missing sessions and videos to relink.",
          );
        } else if (kind === "project") {
          setStatus("Checking project…");
          const p = await readProject(file);
          const decision = await new Promise<ImportDecision | null>((decide) =>
            setProjectReview({ project: p, name: file.name, decide }),
          );
          setProjectReview(undefined);
          if (!decision) {
            setStatus("Import cancelled.");
            continue;
          }
          await commitProject(
            p.records,
            { ...defaults, ...p.manifest.settings },
            p.manifest.sync,
          );
          setSessions((await load()).records.map((r) => r.session));
          setSettings({ ...defaults, ...p.manifest.settings });
          setSync(p.manifest.sync);
          projectImported = true;
          if (decision.openVideos || decision.files.length) {
            setShowVideos(true);
            setTab("Video sync");
          }
          if (decision.files.length) {
            setStatus("Linking local videos…");
            const result = await matchProjectVideos(
              decision.files,
              p.manifest.sync,
              async (f) =>
                (
                  await work<{ sha256: string }>(
                    "hash",
                    { file: f },
                    undefined,
                    abort.current!.signal,
                  )
                ).sha256,
            );
            setFiles((old) => ({
              ...old,
              ...Object.fromEntries(
                Object.entries(result.matched).map(([hash, f]) => [
                  hash,
                  URL.createObjectURL(
                    new Blob([f], {
                      type: /\.(insv|osv)$/i.test(f.name)
                        ? "video/mp4"
                        : f.type || "video/mp4",
                    }),
                  ),
                ]),
              ),
            }));
            setSourceFiles((old) => ({ ...old, ...result.matched }));
            const position = restoredVideoPosition(
              p.records.map((r) => r.session),
              p.manifest.sync,
              Object.keys(result.matched),
              p.manifest.settings.a,
            );
            if (position) {
              setSettings((old) => ({
                ...old,
                a: position.lapId,
                collection:
                  old.collection.length &&
                  !old.collection.includes(position.sessionId)
                    ? [...old.collection, position.sessionId]
                    : old.collection,
              }));
              setVideoRestore(position);
            }
            setStatus(
              `Project restored. ${Object.keys(result.matched).length} original videos linked.`,
            );
            if (result.unmatched.length)
              setError(
                `These files do not match the saved video links: ${result.unmatched.join(", ")}. Choose the original files or use Replace video.`,
              );
          } else
            setStatus(
              "Project restored. Open Video sync to choose or reload a local video.",
            );
        } else {
          setStatus(`Reading ${file.name}`);
          const decoded = await work<Session>(
            "decode",
            { file },
            (p) =>
              setStatus(`Importing ${file.name} · ${Math.round(p * 100)}%`),
            abort.current!.signal,
          );
          // A VBO has no laps of its own. They come from a finish line already known for
          // the same track, which also decides which track the session belongs to.
          // Importing a file again must not undo a track chosen by hand.
          const prior = sessionsRef.current.find(
            (x) => x.id === decoded.id && x.trackEdited,
          );
          const kept: Session = prior
            ? {
                ...decoded,
                track: prior.track,
                trackId: prior.trackId,
                trackEdited: true,
              }
            : decoded;
          const s =
            kept.format === "vbo"
              ? resolveVbo(kept, [
                  ...sessionsRef.current,
                  ...added.filter(
                    (x) => !sessionsRef.current.some((o) => o.id === x.id),
                  ),
                ])
              : kept;
          await saveSession(s, file);
          if (sessionsRef.current.some((x) => x.id === s.id)) alreadyThere++;
          else added.push(s);
          setSessions((old) =>
            old.some((x) => x.id === s.id)
              ? old.map((x) => (x.id === s.id ? s : x))
              : [...old, s],
          );
          setSettings((st) =>
            st.collection.length && !st.collection.includes(s.id)
              ? { ...st, collection: [...st.collection, s.id] }
              : st,
          );
        }
      } catch (e) {
        failures.push(
          `${file.name}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    abort.current = null;
    try {
      await reconcile();
    } catch (e) {
      failures.push(e instanceof Error ? e.message : String(e));
    }
    if (failures.length) setError(failures.join("\n"));
    if (added.length || alreadyThere || videos) {
      // A session on a track that was not in the collection before opens the analyzer
      // on that track, using its fastest lap.
      const before = new Set(sessionsRef.current.map((x) => x.trackId));
      const first = added[0];
      const line = describeImport(
        added.map((x) => ({
          track: x.track,
          laps: x.laps.length,
          newTrack: !before.has(x.trackId),
        })),
        alreadyThere,
        videos,
      );
      if (first && !before.has(first.trackId)) {
        const best = summarize(first).rows.find((r) => r.best);
        if (best) patch({ a: best.id, b: "" });
      }
      if (line) setStatus(line);
    }
    return projectImported;
  }
  const driveRevision = useMemo(
    () =>
      JSON.stringify({
        settings,
        sync,
        sessions: sessions.map((s) => ({
          id: s.id,
          trackId: s.trackId,
          laps: s.laps,
        })),
      }),
    [settings, sync, sessions],
  );
  const drive = useGoogleDrive({
    open: driveOpen,
    ready: ready && !removing && !abort.current,
    revision: driveRevision,
    onCreate: () => createProject(settings, sync),
    onOpen: async (file) => {
      setDriveOpen(false);
      return (await importFiles([file])) === true;
    },
  });
  sessionsRef.current = sessions;
  importRef.current = importFiles;
  // Files can be dropped anywhere on the window. Listening on the window also stops the
  // browser from opening a file that misses the app.
  useEffect(() => {
    let depth = 0;
    const files = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types || []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!files(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (!files(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const leave = (e: DragEvent) => {
      if (!files(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!files(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      importRef.current(Array.from(e.dataTransfer?.files || []));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);
  // Clicking a track in the sidebar: keep the ticked sessions of that track, or take all
  // of them when none is ticked, drop other tracks, and open its fastest lap.
  function analyzeTrack(group: Session[]) {
    const ticked = group.filter((x) => inScope(x.id)),
      chosen = ticked.length ? ticked : group;
    const all = sessions.map((x) => x.id);
    const laps = chosen.flatMap((x) => summarize(x).rows.filter((r) => r.best));
    const fastest = laps.sort((p, q) => p.ms - q.ms)[0];
    const keep = chosen.some((x) => x.laps.some((l) => l.id === settings.a));
    patch({
      collection: onlySessions(
        all,
        chosen.map((x) => x.id),
      ),
      ...(keep || !fastest ? {} : { a: fastest.id, b: "" }),
    });
    setTab("Analyze");
  }
  // Development only: loads the recordings the dev server was pointed at (see README).
  async function examples() {
    try {
      const fs = [];
      for (let i = 0; ; i++) {
        const r = await fetch(`/__private/session/${i}`);
        if (r.status === 404 && i > 0) break;
        if (!r.ok)
          throw Error("Local recordings are unavailable. Use Import sessions.");
        fs.push(new File([await r.blob()], `local-session-${i + 1}.rcz`));
      }
      await importFiles(fs);
    } catch (e) {
      report(e);
    }
  }
  function updateBinding(binding: Binding) {
    setSync((s) => ({
      ...s,
      bindings: [
        ...s.bindings.filter(
          (b) => b.session.sha256 !== binding.session.sha256,
        ),
        binding,
      ],
    }));
  }
  async function deleteSession() {
    const session = sessions.find((s) => s.id === removeId);
    if (!session || removing) return;
    setRemoving(true);
    setRemoveError("");
    // Cancel the pending autosave so it cannot restore references after deletion.
    clearTimeout(pendingSave.current);
    try {
      const next = await removeSession(session, settings, sync);
      setPlaying(false);
      setSessions((old) => old.filter((s) => s.id !== session.id));
      setTraces((old) => old.filter((t) => t.sessionId !== session.id));
      setSettings(next.settings);
      setSync(next.sync);
      const keptFiles = { ...files };
      for (const hash of next.removedVideos) {
        if (keptFiles[hash]) URL.revokeObjectURL(keptFiles[hash]);
        delete keptFiles[hash];
      }
      setFiles(keptFiles);
      setRemoveId(null);
      setStatus(`${session.filename} removed from this browser.`);
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoving(false);
    }
  }
  function saveGates(next: number[]) {
    if (!ref) return;
    if (
      next.length < 2 ||
      next[0] < 0 ||
      next.at(-1)! > ref.length ||
      next.some((n, i) => !Number.isFinite(n) || (i > 0 && n <= next[i - 1]))
    )
      return report(Error("Gates must be increasing and inside the lap."));
    const l = {
      id: layout?.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: sa?.track || "Custom layout",
      referenceId: ref.id,
      gates: next,
      generated: false,
    };
    patch({
      layouts: [...settings.layouts.filter((x) => x.referenceId !== ref.id), l],
    });
  }
  // The Tracks screen: every track in use with its trace and start/finish line.
  const summaries = useMemo(() => summarizeTracks(sessions), [sessions]);
  const shown =
    summaries.find((t) => t.trackId === (trackView ?? sa?.trackId)) ??
    summaries[0];
  const venueByTrack = useMemo(
    () => new Map(summaries.map((t) => [t.trackId, venueOf(t, catalog)])),
    [summaries, catalog],
  );
  const venue =
    (venueId
      ? catalog.find((v) => v.id === venueId)
      : shown && venueByTrack.get(shown.trackId)) ?? null;
  // Your tracks grouped by venue, so the layouts of one circuit sit together.
  const trackGroups = useMemo(() => {
    const out: { venue: Venue | null; tracks: TrackSummary[] }[] = [];
    for (const t of summaries) {
      const v = venueByTrack.get(t.trackId) ?? null;
      const group = v && out.find((g) => g.venue?.id === v.id);
      if (group) group.tracks.push(t);
      else out.push({ venue: v, tracks: [t] });
    }
    return out;
  }, [summaries, venueByTrack]);
  const mineHere = venue
    ? summaries.filter((t) => venueByTrack.get(t.trackId)?.id === venue.id)
    : shown
      ? [shown]
      : [];
  const showMine =
    osmLayout === null && shown && (!venue || mineHere.includes(shown))
      ? shown
      : null;
  const shape = venue ? shapes[venue.id] : null;
  useEffect(() => {
    if (!venue || !venue.cell || venue.id in shapes) return;
    fetch(`/venues/${venue.cell}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((cell: Record<string, VenueGeometry>) =>
        setShapes((m) => {
          const next = { ...m };
          for (const [id, g] of Object.entries(cell))
            if (!(id in next)) next[id] = decodeVenue(g);
          return next;
        }),
      )
      .catch(() => setShapes((m) => ({ ...m, [venue.id]: null })));
  }, [venue, shapes]);
  const openTrack = (t: TrackSummary) => {
    setVenueId(null);
    setOsmLayout(null);
    setTrackView(t.trackId);
  };
  const shownGates =
    a && shown && sa?.trackId === shown.trackId
      ? gates.slice(1, -1).map((d, i) => ({
          lat: interpolate(a.distance, a.lat, d),
          lon: interpolate(a.distance, a.lon, d),
          label: String(i + 1),
        }))
      : [];
  const groupBy = settings.group === "date" ? "date" : "track",
    groups = useMemo(
      () => groupSessions(sessions, groupBy),
      [sessions, groupBy],
    ),
    allIds = sessions.map((x) => x.id);
  const labels = (t: Trace) => {
    const owner = sessions.find((x) => x.id === t.sessionId);
    const time = new Date(owner?.start || 0).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${multiTrack ? `${owner?.track} · ` : ""}${time} · Lap ${t.lap.number} · ${lapTime(t.lap.end - t.lap.start)}`;
  };
  return (
    <div className="app">
      <GoogleDriveDialog
        open={driveOpen}
        onClose={() => setDriveOpen(false)}
        drive={drive}
      />
      {projectReview && (
        <ProjectImportDialog
          project={projectReview.project}
          name={projectReview.name}
          onDecision={projectReview.decide}
        />
      )}
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div>
            Drop RaceChrono files to import
            <small>
              Each session joins your collection under the track named in the
              file
            </small>
          </div>
        </div>
      )}
      <aside className="sidebar">
        <a
          className="brand"
          href="https://mthracelab.com/"
          aria-label="MTH Race Lab home"
        >
          <img
            className="brand-wordmark"
            src={raceLabLogo}
            alt="MTH Race Lab"
            width="415"
            height="68"
          />
          <img
            className="brand-stripes"
            src="/favicon.svg"
            alt=""
            width="80"
            height="80"
          />
        </a>
        <div className="product-name">
          Apex <span>Track analysis studio</span>
        </div>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav>
          {[
            ["Analyze", Activity],
            ["Sessions", FolderOpen],
            ["Optimal lap", Layers],
            ["Tracks", MapPin],
            ["Video sync", Video],
          ].map(([name, Icon]) => (
            <button
              key={String(name)}
              aria-label={String(name)}
              aria-current={tab === name ? "page" : undefined}
              className={tab === name ? "selected" : ""}
              onClick={() => {
                setTab(String(name));
                if (name === "Video sync") setShowVideos(true);
              }}
            >
              {<Icon size={18} />}
              <span>{String(name)}</span>
              {name === "Sessions" && <small>{sessions.length}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <div className="workspace-label">CURRENT COLLECTION</div>
        {sessions.length === 0 && (
          <div className="collection-name">
            <Flag size={16} />
            Your first track day
          </div>
        )}
        {groupSessions(sessions, "track").map((g) => {
          return (
            <div
              className={`track-group${g.sessions.some((x) => x.trackId === sa?.trackId) ? " active" : ""}`}
              key={g.key}
            >
              <button
                className="collection-name"
                aria-pressed={g.sessions.some((x) => x.trackId === sa?.trackId)}
                title={`Analyze ${g.label}`}
                onClick={() => analyzeTrack(g.sessions)}
              >
                <Flag size={16} />
                <span>{g.label}</span>
                <small>{g.sessions.length}</small>
              </button>
              {g.sessions.map((s) => (
                <label className="session-check" key={s.id}>
                  <input
                    type="checkbox"
                    checked={isSelected(settings.collection, s.id)}
                    onChange={(e) =>
                      patch({
                        collection: toggleSessions(
                          sessions.map((x) => x.id),
                          settings.collection,
                          [s.id],
                          e.target.checked,
                        ),
                      })
                    }
                  />
                  <span>
                    {new Date(s.start).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                    })}
                    <small>
                      {new Date(s.start).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · {s.laps.length} laps
                    </small>
                  </span>
                </label>
              ))}
            </div>
          );
        })}
        <button
          className="sidebar-import"
          onClick={() => input.current?.click()}
        >
          <Plus size={16} /> Add session
        </button>
      </aside>
      <main>
        <header>
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} /> {sa?.track || "Track analysis"}{" "}
            <ChevronRight size={13} />
            <span>{tab}</span>
          </div>
          <div className="header-actions">
            <span className="saved">
              <span className="live-dot" />{" "}
              {saving ? "Saving…" : "Saved locally"}
            </span>
            <button onClick={() => exportProject(settings, sync).catch(report)}>
              <ArrowDownToLine size={14} /> Download session file
            </button>
            <div className="drive-header-actions">
              <button onClick={() => setDriveOpen(true)}>
                <Cloud size={14} /> Google Drive
              </button>
              <button
                disabled={drive.busy || !ready}
                className={drive.connected ? "primary" : ""}
                onClick={() => {
                  if (drive.connected && drive.preferences.target)
                    void drive.save();
                  else setDriveOpen(true);
                }}
              >
                <Cloud size={14} />{" "}
                {drive.busy ? "Drive working…" : "Save to Drive"}
              </button>
              <span className="drive-header-status" role="status">
                {drive.error ||
                  (drive.preferences.target
                    ? !drive.connected
                      ? "Reconnect to save"
                      : drive.preferences.autoSave
                        ? drive.dirty
                          ? "Autosave pending"
                          : "Saved to Drive · Auto"
                        : drive.dirty
                          ? "Drive changes pending"
                          : "Saved to Drive"
                    : "")}
              </span>
            </div>
            <button className="primary" onClick={() => input.current?.click()}>
              <Plus size={15} /> Import sessions
            </button>
          </div>
        </header>
        <input
          ref={input}
          hidden
          multiple
          type="file"
          accept=".rcz,.vbo,.json,.zip"
          onChange={(e) => {
            importFiles(Array.from(e.target.files || []));
            e.target.value = "";
          }}
        />
        <div className="content">
          <div className="page-title">
            <div>
              <div className="eyebrow">TRACK ANALYSIS STUDIO</div>
              <h1>
                {tab === "Analyze"
                  ? sa?.track || "Find your next second."
                  : tab}
              </h1>
              <p>
                {tab === "Analyze"
                  ? "Every corner. Every input. A clearer picture of your lap."
                  : tab === "Optimal lap"
                    ? "Your best sectors, brought together across track days."
                    : tab === "Video sync"
                      ? "Match the moment. Save the timing. Keep your original files."
                      : tab === "Tracks"
                        ? "Find a circuit, then define the layout you actually drove."
                        : "Your track days, all in one place."}
              </p>
            </div>
            {sessions.length > 0 && (
              <span className="outline-badge">
                {sessions.filter((x) => inScope(x.id)).length === 1
                  ? "1 SESSION"
                  : `${sessions.filter((x) => inScope(x.id)).length} SESSIONS`}{" "}
                <span> / </span>
                {(() => {
                  const laps = sessions
                    .filter((x) => inScope(x.id))
                    .reduce((n, x) => n + x.laps.length, 0);
                  return `${laps} ${laps === 1 ? "LAP" : "LAPS"}`;
                })()}
              </span>
            )}
          </div>
          {error && (
            <div className="notice error">
              {error}
              <button onClick={() => setError("")}>
                <X size={14} />
              </button>
            </div>
          )}
          {status && (
            <div className="notice">
              {status}
              {abort.current && (
                <button onClick={() => abort.current?.abort()}>Cancel</button>
              )}
              <button onClick={() => setStatus("")}>
                <X size={14} />
              </button>
            </div>
          )}
          {sync.bindings.some(
            (b) => !sessions.some((s) => s.id === b.session.sha256),
          ) && (
            <div className="notice">
              Saved sync references missing sessions. Import the original
              session files; matching hashes restore their bindings.
            </div>
          )}
          {!sessions.length && tab !== "Tracks" ? (
            <div className="welcome">
              <div className="welcome-track">
                <svg viewBox="0 0 500 200">
                  <path d="M65 140 C15 70 100 10 170 45 L230 80 Q260 85 280 40 Q310 5 350 40 L440 125 Q475 190 400 172 L320 135 Q280 110 260 150 Q235 195 185 157 L150 120 Q100 95 65 140Z" />
                </svg>
              </div>
              <span className="eyebrow">LESS GUESSWORK. BETTER LAPS.</span>
              <h2>Your next track day starts here.</h2>
              <p>
                Drop RaceChrono sessions here to explore your racing line,
                <br />
                compare your inputs, and find time in every sector.
              </p>
              <button
                className="primary"
                onClick={() => input.current?.click()}
              >
                <ArrowUpFromLine size={17} /> Import RaceChrono files
              </button>
              {import.meta.env.DEV && (
                <button onClick={examples}>
                  Open local recordings (development)
                </button>
              )}
              <small>
                RaceChrono .rcz and VBO .vbo sessions · Sync files · Project
                archives
                <br />
                Processed in your browser. Nothing uploaded.
              </small>
            </div>
          ) : (
            <>
              {(tab === "Analyze" || tab === "Video sync") && a && (
                <>
                  <div className="stats">
                    <div>
                      <span>BEST RECORDED LAP</span>
                      <strong>
                        {lapTime(
                          Math.min(
                            ...traces
                              .filter(
                                (t) =>
                                  (!settings.collection.length ||
                                    settings.collection.includes(
                                      t.sessionId,
                                    )) &&
                                  sessions.find((x) => x.id === t.sessionId)
                                    ?.trackId === sa?.trackId &&
                                  !t.issues.some(
                                    (i) =>
                                      i.includes("invalid") ||
                                      i.includes("Interrupted"),
                                  ),
                              )
                              .map((t) => t.lap.end - t.lap.start),
                          ),
                        )}
                      </strong>
                      <small>Recorded time · GPS quality shown per lap</small>
                    </div>
                    <div>
                      <span>THEORETICAL OPTIMAL</span>
                      <strong className="cyan">
                        {ideal ? lapTime(ideal.lap.end) : "—"}
                      </strong>
                      <small>
                        {sectors.length} best sectors · {eligible.length}{" "}
                        eligible laps
                      </small>
                    </div>
                    <div>
                      <span>POTENTIAL GAIN</span>
                      <strong>
                        {ideal
                          ? (
                              Math.max(
                                0,
                                Math.min(
                                  ...eligible.map(
                                    (t) => t.lap.end - t.lap.start,
                                  ),
                                ) - ideal.lap.end,
                              ) / 1000
                            ).toFixed(3) + " s"
                          : "—"}
                      </strong>
                      <small>Compared with the best eligible lap</small>
                    </div>
                    <div>
                      <span>TRACK DISTANCE</span>
                      <strong>
                        {(a.length / 1000).toFixed(2)} <em>km</em>
                      </strong>
                      <small>GPS reference · Imported gates preserved</small>
                    </div>
                  </div>
                  <div className="comparison-bar">
                    <div className="lap-picker">
                      <input
                        aria-label="Lap A color"
                        type="color"
                        value={settings.colors[0]}
                        onChange={(e) =>
                          patch({
                            colors: [e.target.value, settings.colors[1]],
                          })
                        }
                      />
                      <select
                        aria-label="Lap A"
                        value={a.id}
                        onChange={(e) => patch({ a: e.target.value })}
                      >
                        {scoped.map((t) => (
                          <option key={t.id} value={t.id}>
                            {labels(t)}
                            {t.issues.length ? " ⚠" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <span className="versus">vs</span>
                    <div className="lap-picker">
                      <input
                        aria-label="Lap B color"
                        type="color"
                        value={settings.colors[1]}
                        onChange={(e) =>
                          patch({
                            colors: [settings.colors[0], e.target.value],
                          })
                        }
                      />
                      <select
                        aria-label="Lap B"
                        value={settings.b}
                        onChange={(e) => patch({ b: e.target.value })}
                      >
                        <option value="">Choose comparison lap</option>
                        {scoped
                          .filter(
                            (t) =>
                              t.id !== a.id &&
                              !t.issues.some((i) => i.includes("Incompatible")),
                          )
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {labels(t)}
                            </option>
                          ))}
                        {ideal && (
                          <option value="optimal">
                            Theoretical optimal · {lapTime(ideal.lap.end)}
                          </option>
                        )}
                      </select>
                    </div>
                    {(settings.extras ?? []).map((e, i) => {
                      const tag = String.fromCharCode(67 + i),
                        set = (next: Partial<typeof e>) =>
                          patch({
                            extras: (settings.extras ?? []).map((x, k) =>
                              k === i ? { ...x, ...next } : x,
                            ),
                          });
                      return (
                        <Fragment key={i}>
                          <span className="versus">vs</span>
                          <div className="lap-picker">
                            <input
                              aria-label={`Lap ${tag} color`}
                              type="color"
                              value={e.color}
                              onChange={(ev) => set({ color: ev.target.value })}
                            />
                            <select
                              aria-label={`Lap ${tag}`}
                              value={e.id}
                              onChange={(ev) => set({ id: ev.target.value })}
                            >
                              <option value="">Choose lap {tag}</option>
                              {scoped
                                .filter(
                                  (t) =>
                                    t.id !== a.id &&
                                    !t.issues.some((x) =>
                                      x.includes("Incompatible"),
                                    ),
                                )
                                .map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {labels(t)}
                                  </option>
                                ))}
                              {ideal && (
                                <option value="optimal">
                                  Theoretical optimal · {lapTime(ideal.lap.end)}
                                </option>
                              )}
                            </select>
                            <button
                              className="remove-lap"
                              aria-label={`Remove lap ${tag}`}
                              title={`Remove lap ${tag}`}
                              onClick={() =>
                                patch({
                                  extras: (settings.extras ?? []).filter(
                                    (_, k) => k !== i,
                                  ),
                                })
                              }
                            >
                              ×
                            </button>
                          </div>
                        </Fragment>
                      );
                    })}
                    {(settings.extras ?? []).length < EXTRA_COLORS.length && (
                      <button
                        className="add-lap"
                        onClick={() =>
                          patch({
                            extras: [
                              ...(settings.extras ?? []),
                              {
                                id: "",
                                color:
                                  EXTRA_COLORS[(settings.extras ?? []).length],
                              },
                            ],
                          })
                        }
                      >
                        + Add lap
                      </button>
                    )}
                    <div className="comparison-actions">
                      <select
                        aria-label="Speed units"
                        value={settings.speedUnit}
                        onChange={(e) =>
                          patch({
                            speedUnit: e.target.value as Settings["speedUnit"],
                          })
                        }
                      >
                        <option>km/h</option>
                        <option>mph</option>
                      </select>
                      <select
                        aria-label="Comparison alignment"
                        value={settings.mode}
                        onChange={(e) =>
                          patch({ mode: e.target.value as Settings["mode"] })
                        }
                      >
                        <option value="distance">By distance</option>
                        <option value="time">Elapsed-time replay</option>
                      </select>
                      <button
                        className={showVideos ? "active" : ""}
                        onClick={() => setShowVideos(!showVideos)}
                      >
                        <Video size={15} /> Video
                      </button>
                    </div>
                  </div>
                  {multiTrack && (
                    <div className="notice">
                      Your selection spans several tracks. The analyzer compares
                      laps on one track at a time, currently {sa?.track}. Pick a
                      lap from another track in Lap A to switch.
                    </div>
                  )}
                  {a.issues.length > 0 && (
                    <div className="notice">Lap A: {a.issues.join(" · ")}</div>
                  )}
                  {b && b.issues.length > 0 && (
                    <div className="notice">Lap B: {b.issues.join(" · ")}</div>
                  )}
                  <TrackView
                    a={a}
                    others={comparisons}
                    colors={settings.colors}
                    cursor={cursor}
                    range={range}
                    gates={gates}
                    brakeMarkers={brakeMarkers}
                    onCursor={moveCursor}
                    height={settings.mapHeight}
                    onHeight={(mapHeight) => patch({ mapHeight })}
                    speedUnit={settings.speedUnit}
                  />
                  <div className="transport">
                    <button
                      className="play"
                      aria-label={playing ? "Pause playback" : "Play playback"}
                      onClick={togglePlay}
                    >
                      {playing ? <Pause size={16} /> : <Play size={16} />}
                    </button>
                    <select
                      aria-label="Playback speed"
                      value={playbackRate}
                      onChange={(e) => setPlaybackRate(Number(e.target.value))}
                    >
                      {PLAYBACK_RATES.map((rate) => (
                        <option key={rate} value={rate}>
                          {rate}×
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-pressed={loopSection}
                      disabled={!canLoop}
                      title={
                        canLoop
                          ? "Replay the selected section repeatedly"
                          : "Select a section on a graph first"
                      }
                      onClick={() => setLoopSection(!loopSection)}
                    >
                      Loop section
                    </button>
                    <ClockInput
                      ms={elapsed}
                      max={a.lap.end - a.lap.start}
                      onJump={(ms) => goTo(a.lap.start + ms)}
                    />
                    <input
                      aria-label="Track position"
                      type="range"
                      min={range[0]}
                      max={range[1]}
                      step="1"
                      value={cursor}
                      onChange={(e) => moveCursor(+e.target.value)}
                    />
                    <span className="mono">
                      {(cursor / 1000).toFixed(2)} km
                    </span>
                    <span className="delta">
                      Δ{" "}
                      {Number.isFinite(delta)
                        ? `${delta > 0 ? "+" : ""}${(delta / 1000).toFixed(3)} s`
                        : "—"}
                    </span>
                    <button onClick={() => setRange([0, a.length])}>
                      Reset zoom
                    </button>
                  </div>
                  {a && b && b.sessionId !== "optimal" && (
                    <BrakingComparison
                      a={a}
                      b={b}
                      pairs={brakePairs}
                      open={showBrakePoints}
                      onOpen={setShowBrakePoints}
                      onFocus={(pair) => {
                        const starts = [pair.a?.start, pair.b?.start].filter(
                          (n): n is number => n !== undefined,
                        );
                        const ends = [pair.a?.end, pair.b?.end].filter(
                          (n): n is number => n !== undefined,
                        );
                        setRange([
                          Math.max(0, Math.min(...starts) - 120),
                          Math.min(a.length, Math.max(...ends) + 120),
                        ]);
                        moveCursor(pair.a?.start ?? pair.b!.start);
                        setPlaying(false);
                      }}
                    />
                  )}
                  {showVideos && (
                    <div
                      className="videos"
                      style={
                        {
                          "--video-height": `${settings.videoHeight}px`,
                        } as React.CSSProperties
                      }
                    >
                      <VideoPanel
                        label="LAP A"
                        session={sa}
                        stamp={at}
                        binding={sync.bindings.find(
                          (b) => b.session.sha256 === sa?.id,
                        )}
                        onBinding={updateBinding}
                        files={files}
                        setFiles={setFiles}
                        sourceFiles={sourceFiles}
                        setSourceFiles={setSourceFiles}
                        onBusy={setBusyA}
                        onPause={() => setPlaying(false)}
                        onGoTo={goTo}
                        lapStart={a?.lap.start}
                        lapDuration={a ? a.lap.end - a.lap.start : undefined}
                        onJumpLap={(ms) => a && goTo(a.lap.start + ms)}
                        onUnlink={() =>
                          setSync((s) => ({
                            ...s,
                            bindings: s.bindings.filter(
                              (b) => b.session.sha256 !== sa?.id,
                            ),
                          }))
                        }
                        playbackRate={playbackRate}
                        playing={playing && !busyB}
                      />
                      <VideoPanel
                        label="LAP B"
                        session={videoSessionB}
                        stamp={videoStampB}
                        lapStart={
                          optimalSource
                            ? optimalSource.source.lap.start
                            : b?.lap.start
                        }
                        binding={sync.bindings.find(
                          (b) => b.session.sha256 === videoSessionB?.id,
                        )}
                        onBinding={updateBinding}
                        files={files}
                        setFiles={setFiles}
                        sourceFiles={sourceFiles}
                        setSourceFiles={setSourceFiles}
                        onBusy={setBusyB}
                        onPause={() => setPlaying(false)}
                        onUnlink={() =>
                          setSync((s) => ({
                            ...s,
                            bindings: s.bindings.filter(
                              (b) => b.session.sha256 !== videoSessionB?.id,
                            ),
                          }))
                        }
                        playbackRate={playbackRate}
                        playing={playing && !busyA}
                      />
                    </div>
                  )}
                  {showVideos && (
                    <label className="video-size">
                      Video panel height{" "}
                      <input
                        aria-label="Video height"
                        type="range"
                        min="180"
                        max="500"
                        value={settings.videoHeight}
                        onChange={(e) =>
                          patch({ videoHeight: +e.target.value })
                        }
                      />
                    </label>
                  )}
                  {tab === "Video sync" && (
                    <div className="notice">
                      <span>
                        Download timing only. Session and video filenames,
                        SHA-256 hashes, clip order, and anchors are included. No
                        recording data.
                      </span>
                      <button
                        onClick={() =>
                          download(
                            "track-day.rcsync.json",
                            JSON.stringify(sync, null, 2),
                          )
                        }
                      >
                        <ArrowDownToLine size={14} /> Download sync file
                      </button>
                    </div>
                  )}
                  <div className="section-heading">
                    <h2>
                      Telemetry{" "}
                      <span>
                        {visibleCharts.length}{" "}
                        {visibleCharts.length === 1 ? "chart" : "charts"}
                      </span>
                    </h2>
                    <div>
                      <small>Drag a chart to zoom into a section</small>
                      {emptyChartCount > 0 && (
                        <label className="empty-chart-toggle">
                          <input
                            type="checkbox"
                            checked={!!settings.showEmptyCharts}
                            onChange={(e) =>
                              patch({ showEmptyCharts: e.target.checked })
                            }
                          />
                          Show empty charts ({emptyChartCount})
                        </label>
                      )}
                      <select
                        aria-label="Add chart"
                        value=""
                        onChange={(e) =>
                          patch({
                            charts: [
                              ...settings.charts,
                              {
                                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                                channels: [e.target.value],
                                height: 130,
                              },
                            ],
                          })
                        }
                      >
                        <option value="">+ Add chart</option>
                        {[...channelsWithData].map((k) => (
                          <option key={k} value={k}>
                            {definitions[k]?.name || k}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {visibleCharts.map(({ chart: c, index: i }, visibleIndex) => (
                    <Chart
                      key={c.id}
                      config={c}
                      a={displayTraces[0]!}
                      others={comparisons}
                      colors={settings.colors}
                      speedUnit={settings.speedUnit}
                      joins={
                        [b, ...extraLaps.map((x) => x.trace)].some(
                          (t) => t?.id === "optimal",
                        )
                          ? gates.slice(1, -1)
                          : []
                      }
                      cursor={cursor}
                      range={range}
                      onCursor={moveCursor}
                      onZoom={setRange}
                      length={a.length}
                      onRange={(r) => {
                        setRange(r);
                        moveCursor(r[0]);
                        setPlaying(false);
                      }}
                      onChange={(next) =>
                        patch({
                          charts: settings.charts.map((x) =>
                            x.id === c.id ? next : x,
                          ),
                        })
                      }
                      onRemove={() =>
                        patch({
                          charts: settings.charts.filter((x) => x.id !== c.id),
                        })
                      }
                      onUp={() => {
                        const next = [...settings.charts];
                        if (visibleIndex) {
                          const previous =
                            visibleCharts[visibleIndex - 1].index;
                          [next[previous], next[i]] = [next[i], next[previous]];
                        }
                        patch({ charts: next });
                      }}
                    />
                  ))}
                  <div className="footnote">
                    GPS-derived alignment · Missing samples remain gaps · Brake
                    pressure is unavailable unless recorded
                  </div>
                </>
              )}
              {tab === "Sessions" && (
                <>
                  <div className="sessions-toolbar">
                    <div
                      className="segmented"
                      role="group"
                      aria-label="Group sessions by"
                    >
                      {(["track", "date"] as const).map((g) => (
                        <button
                          key={g}
                          className={groupBy === g ? "active" : ""}
                          aria-pressed={groupBy === g}
                          onClick={() => patch({ group: g })}
                        >
                          {g === "track" ? "By track" : "By date"}
                        </button>
                      ))}
                    </div>
                    <span className="muted">
                      {sessions.filter((x) => inScope(x.id)).length} of{" "}
                      {sessions.length} sessions in the analyzer ·{" "}
                      {sessions
                        .filter((x) => inScope(x.id))
                        .reduce((n, x) => n + x.laps.length, 0)}{" "}
                      laps
                    </span>
                    <button
                      className="primary"
                      onClick={() => setTab("Analyze")}
                    >
                      Open analyzer
                    </button>
                  </div>
                  {groups.map((g) => {
                    const gids = g.sessions.map((x) => x.id),
                      state = selectionState(settings.collection, gids),
                      times = g.sessions
                        .flatMap((x) => x.laps)
                        .filter(
                          (l) =>
                            !l.issues.some(
                              (i) =>
                                i.includes("Interrupted") ||
                                i.includes("invalid"),
                            ),
                        )
                        .map((l) => l.end - l.start);
                    return (
                      <section className="session-group" key={g.key}>
                        <div className="group-heading">
                          <label>
                            <input
                              type="checkbox"
                              aria-label={`Select all sessions of ${g.label}`}
                              checked={state === "all"}
                              ref={(el) => {
                                if (el) el.indeterminate = state === "some";
                              }}
                              onChange={() =>
                                patch({
                                  collection: toggleSessions(
                                    allIds,
                                    settings.collection,
                                    gids,
                                    state !== "all",
                                  ),
                                })
                              }
                            />
                            <h2>{g.label}</h2>
                          </label>
                          <small>
                            {g.sessions.length}{" "}
                            {g.sessions.length === 1 ? "session" : "sessions"} ·{" "}
                            {g.sessions.reduce((n, x) => n + x.laps.length, 0)}{" "}
                            laps
                            {times.length > 0 &&
                              ` · best ${lapTime(Math.min(...times))}`}
                          </small>
                          <button
                            onClick={() => {
                              patch({
                                collection: onlySessions(allIds, gids),
                              });
                              setTab("Analyze");
                            }}
                          >
                            Analyze only these
                          </button>
                        </div>
                        <div className="session-grid">
                          {g.sessions.map((s) => (
                            <section
                              className="session-card"
                              key={s.id}
                              onClick={(e) => {
                                if (
                                  !(e.target as HTMLElement).closest(
                                    "input,button,label,summary,details,a,table",
                                  )
                                )
                                  setSummaryId(s.id);
                              }}
                            >
                              <div className="panel-heading">
                                <span>
                                  <Flag size={16} /> {s.track}
                                </span>
                                <span className="session-card-actions">
                                  {new Date(s.start).toLocaleDateString()}
                                  <button
                                    className="session-remove"
                                    aria-label={`Remove session ${s.filename}`}
                                    title="Remove session from this browser"
                                    disabled={!!abort.current}
                                    onClick={() => {
                                      setRemoveError("");
                                      setRemoveId(s.id);
                                    }}
                                  >
                                    <X size={16} />
                                  </button>
                                </span>
                              </div>
                              <label className="card-check">
                                <input
                                  type="checkbox"
                                  checked={inScope(s.id)}
                                  onChange={(e) =>
                                    patch({
                                      collection: toggleSessions(
                                        allIds,
                                        settings.collection,
                                        [s.id],
                                        e.target.checked,
                                      ),
                                    })
                                  }
                                />
                                Include in analyzer
                              </label>
                              <button
                                className="card-summary"
                                onClick={() => setTrackFor(s.id)}
                              >
                                Change track
                              </button>
                              <button
                                className="card-summary"
                                disabled={!s.laps.length}
                                onClick={() => setSummaryId(s.id)}
                              >
                                Lap times
                              </button>
                              {s.format === "vbo" && (
                                <>
                                  <button
                                    className="card-summary"
                                    onClick={() => setLineFor(s.id)}
                                  >
                                    {s.laps.length
                                      ? "Move start/finish line"
                                      : "Set start/finish line"}
                                  </button>
                                  {!s.laps.length && (
                                    <p className="notice">
                                      This file has no lap data and no known
                                      finish line for this track, so it has no
                                      laps yet. Place the start/finish line to
                                      cut them.
                                    </p>
                                  )}
                                </>
                              )}
                              <h2>
                                {new Date(s.start).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}{" "}
                                session
                              </h2>
                              <p>{s.filename}</p>
                              <div className="session-metrics">
                                <span>
                                  <strong>{s.laps.length}</strong> laps
                                </span>
                                <span>
                                  <strong>{s.channels.length}</strong> channels
                                </span>
                                <span>
                                  <strong>
                                    {s.times.length.toLocaleString()}
                                  </strong>{" "}
                                  GPS samples
                                </span>
                              </div>
                              <table>
                                <thead>
                                  <tr>
                                    <th>Lap</th>
                                    <th>Time</th>
                                    <th>Optimal eligibility</th>
                                    <th />
                                  </tr>
                                </thead>
                                <tbody>
                                  {s.laps.map((l) => {
                                    const t = traces.find((t) => t.id === l.id),
                                      issues = t?.issues || l.issues,
                                      status = lapStatus({
                                        issues,
                                        sameTrack: s.trackId === sa?.trackId,
                                        selected: inScope(s.id),
                                        excluded: settings.excluded.includes(
                                          l.id,
                                        ),
                                        included: settings.included.includes(
                                          l.id,
                                        ),
                                      }),
                                      // A status is shown only when a lap needs attention or
                                      // you have made a decision about it.
                                      attention = [
                                        "review",
                                        "unusable",
                                        "included",
                                        "excluded",
                                      ].includes(status);
                                    return (
                                      <tr key={l.id}>
                                        <td>
                                          {l.number.toString().padStart(2, "0")}
                                        </td>
                                        <td className="mono">
                                          {lapTime(l.end - l.start)}
                                        </td>
                                        <td>
                                          {attention && (
                                            <span
                                              className={`lap-status ${status}`}
                                            >
                                              {STATUS_LABEL[status]}
                                            </span>
                                          )}
                                          {status !== "other-track" &&
                                            issues.length > 0 && (
                                              <small>
                                                {issues.join(" · ")}
                                              </small>
                                            )}
                                        </td>
                                        <td className="row-actions">
                                          {(attention ||
                                            (status !== "other-track" &&
                                              issues.length > 0)) && (
                                            <button
                                              onClick={() => setReviewId(l.id)}
                                            >
                                              Review
                                            </button>
                                          )}
                                          <button
                                            onClick={() => {
                                              patch({ a: l.id });
                                              setTab("Analyze");
                                            }}
                                          >
                                            Analyze ↗
                                          </button>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                              <details>
                                <summary>
                                  Channel provenance & archive details
                                </summary>
                                {s.channels.map((c) => (
                                  <p key={c.id}>
                                    {c.name} · {c.unit}
                                    <small>{c.source}</small>
                                  </p>
                                ))}
                                <p>
                                  Unmapped archive channels preserved:{" "}
                                  {s.unknown.length}
                                </p>
                                <small className="hash">SHA-256 {s.id}</small>
                                {Number.isFinite(s.importedOptimal) && (
                                  <p>
                                    RaceChrono optimal:{" "}
                                    {lapTime(s.importedOptimal)}. Original
                                    sector definitions are not included in this
                                    archive.
                                  </p>
                                )}
                              </details>
                            </section>
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </>
              )}
              {tab === "Optimal lap" && (
                <>
                  <div className="optimal-hero">
                    <div className="eyebrow">THEORETICAL BEST</div>
                    <h2>
                      {ideal ? lapTime(ideal.lap.end) : "Incomplete sectors"}
                    </h2>
                    <p>
                      {eligible.length} eligible laps ·{" "}
                      {new Set(eligible.map((t) => t.sessionId)).size} sessions
                      · {sectors.length} sectors
                    </p>
                    <button
                      className="primary"
                      disabled={!ideal}
                      onClick={() => {
                        patch({ b: "optimal" });
                        setTab("Analyze");
                      }}
                    >
                      Compare with your optimal lap <ChevronRight size={16} />
                    </button>
                  </div>
                  {opp && (
                    <Opportunities
                      shape={opp.fastest}
                      opps={opp.list}
                      bestMs={opp.bestMs}
                      optMs={opp.optMs}
                      scopeLabel={scope.label}
                      days={
                        scope.mode === "day"
                          ? groupSessions(sessions, "date").map((g) => ({
                              key: g.key,
                              label: g.label,
                            }))
                          : undefined
                      }
                      day={scope.day}
                      onDay={setOppDay}
                      labelOf={labels}
                    />
                  )}
                  <div className="notice">
                    {layout?.generated === false
                      ? "Custom sector gates"
                      : "Generated sectors, approximately 1 km each"}
                    . This is a theoretical sum. Sector joins can have different
                    speeds and racing lines.
                  </div>
                  <section className="panel gate-editor">
                    <h2>Timing gates</h2>
                    <p>
                      Distances along the reference lap. Changing these creates
                      a custom timed section; imported lap boundaries stay
                      intact.
                    </p>
                    <div className="row">
                      <label>
                        Start{" "}
                        <input
                          aria-label="Layout start gate"
                          type="number"
                          defaultValue={Math.round(gates[0] || 0)}
                          key={"start" + gates[0]}
                          onBlur={(e) => {
                            const start = +e.target.value;
                            saveGates([
                              start,
                              ...gates.slice(1).filter((g) => g > start),
                            ]);
                          }}
                        />{" "}
                        m
                      </label>
                      <label>
                        Finish{" "}
                        <input
                          aria-label="Layout finish gate"
                          type="number"
                          defaultValue={Math.floor(gates.at(-1) || 0)}
                          key={"finish" + gates.at(-1)}
                          onBlur={(e) => {
                            const finish = +e.target.value;
                            saveGates([
                              ...gates.slice(0, -1).filter((g) => g < finish),
                              finish,
                            ]);
                          }}
                        />{" "}
                        m
                      </label>
                      <button
                        onClick={() =>
                          patch({
                            layouts: settings.layouts.filter(
                              (l) => l.referenceId !== reference,
                            ),
                          })
                        }
                      >
                        Reset generated gates
                      </button>
                    </div>
                  </section>
                  <section className="panel">
                    <div className="section-heading">
                      <h2>Sector breakdown</h2>
                      <button
                        onClick={() => {
                          if (ref)
                            saveGates(
                              [...gates, cursor]
                                .filter((v, i, arr) => arr.indexOf(v) === i)
                                .sort((a, b) => a - b),
                            );
                        }}
                      >
                        Add gate at cursor
                      </button>
                    </div>
                    <table>
                      <thead>
                        <tr>
                          <th>Sector</th>
                          <th>Finish distance</th>
                          <th>Best time</th>
                          <th>Source recording</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {sectors.map((s: Sector) => (
                          <tr key={s.index}>
                            <td>
                              <span className="sector-number">
                                {String(s.index + 1).padStart(2, "0")}
                              </span>
                            </td>
                            <td>
                              <input
                                aria-label={`Sector ${s.index + 1} finish distance`}
                                className="distance-input"
                                type="number"
                                defaultValue={Math.round(s.end)}
                                key={s.end}
                                onBlur={(e) => {
                                  const next = [...gates];
                                  next[s.index + 1] = +e.target.value;
                                  saveGates(next);
                                }}
                              />{" "}
                              m
                            </td>
                            <td className="cyan mono">{lapTime(s.time)}</td>
                            <td>{labels(s.source)}</td>
                            <td>
                              <button
                                onClick={() => {
                                  patch({ a: s.source.id });
                                  setTab("Analyze");
                                  setTimeout(() => {
                                    setRange([s.start, s.end]);
                                    moveCursor(s.start);
                                  }, 100);
                                }}
                              >
                                Inspect sector ↗
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                </>
              )}
              {tab === "Tracks" && (
                <>
                  <div className="tracks-layout">
                    <section className="track-results">
                      <h2 className="side-title">Your tracks</h2>
                      {summaries.length === 0 && (
                        <p className="muted">
                          Import a session and its track appears here with its
                          trace and start/finish line.
                        </p>
                      )}
                      {trackGroups.map((g) => (
                        <div
                          key={g.venue?.id ?? `t${g.tracks[0].trackId}`}
                          className="venue-group"
                        >
                          {g.venue && (
                            <button
                              className={`venue-head${venue?.id === g.venue.id && osmLayout !== null ? " on" : ""}`}
                              onClick={() => {
                                setVenueId(g.venue!.id);
                                setTrackView(g.tracks[0].trackId);
                                setOsmLayout(null);
                              }}
                            >
                              <MapPin size={15} />
                              <span>
                                {g.venue.name}
                                <small>
                                  {g.venue.layouts.length
                                    ? `${g.venue.layouts.length} mapped ${g.venue.layouts.length === 1 ? "layout" : "layouts"}`
                                    : g.venue.cell
                                      ? "Mapped pieces only"
                                      : "Mapped location"}
                                </small>
                              </span>
                            </button>
                          )}
                          {g.tracks.map((t) => (
                            <button
                              key={t.trackId}
                              className={`my-track${g.venue ? " nested" : ""}${t.trackId === showMine?.trackId ? " on" : ""}`}
                              onClick={() => openTrack(t)}
                            >
                              {!g.venue && <MapPin size={16} />}
                              <span>
                                {t.name}
                                <small>
                                  {t.sessions.length}{" "}
                                  {t.sessions.length === 1
                                    ? "session"
                                    : "sessions"}{" "}
                                  · {t.laps} laps
                                  {t.best && ` · best ${lapTime(t.best.ms)}`}
                                </small>
                              </span>
                              <ChevronRight size={15} />
                            </button>
                          ))}
                        </div>
                      ))}
                      <details className="catalog">
                        <summary>Find a circuit in the catalog</summary>
                        <div className="track-search">
                          <input
                            aria-label="Search tracks"
                            placeholder={`Search ${catalog.length.toLocaleString("en-GB")} mapped circuits…`}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                          />
                        </div>
                        {searchVenues(catalog, search).map(
                          ({ venue: v, via }) => (
                            <button
                              key={v.id}
                              className={
                                venue?.id === v.id && venueId ? "on" : ""
                              }
                              onClick={() => {
                                setVenueId(v.id);
                                setOsmLayout(v.layouts.length ? 0 : null);
                              }}
                            >
                              <MapPin size={16} />
                              <span>
                                {v.name}
                                <small>
                                  {v.layouts.length
                                    ? `${v.layouts.length} ${v.layouts.length === 1 ? "layout" : "layouts"}`
                                    : v.cell
                                      ? "Mapped pieces only"
                                      : "Mapped location"}
                                  {via && ` · ${via}`}
                                </small>
                              </span>
                              <ChevronRight size={15} />
                            </button>
                          ),
                        )}
                        {catalogFailed && (
                          <p className="muted">Catalog unavailable.</p>
                        )}
                      </details>
                    </section>
                    <div>
                      <TracksMap
                        track={showMine}
                        gates={showMine ? shownGates : []}
                        shape={shape}
                        center={venue ? [venue.lat, venue.lon] : undefined}
                        layout={osmLayout}
                        label={venue?.name}
                        height={480}
                      />
                      {venue &&
                        (mineHere.length > 0 || venue.layouts.length > 0) && (
                          <div
                            className="layout-chips"
                            role="group"
                            aria-label="Layouts"
                          >
                            {mineHere.map((t) => (
                              <button
                                key={`m${t.trackId}`}
                                className={`chip mine${showMine?.trackId === t.trackId ? " on" : ""}`}
                                onClick={() => {
                                  setVenueId(venue.id);
                                  setTrackView(t.trackId);
                                  setOsmLayout(null);
                                }}
                              >
                                <i />
                                {t.name}
                                <small>
                                  {(t.lengthM / 1000).toFixed(2)} km
                                </small>
                              </button>
                            ))}
                            {venue.layouts.map((l, i) => (
                              <button
                                key={`o${i}`}
                                className={`chip osm${osmLayout === i ? " on" : ""}`}
                                onClick={() => {
                                  setVenueId(venue.id);
                                  setOsmLayout(i);
                                }}
                              >
                                <i />
                                {l.name}
                                <small>
                                  {(l.lengthM / 1000).toFixed(2)} km
                                </small>
                              </button>
                            ))}
                          </div>
                        )}
                      {venue && !showMine && (
                        <section className="panel track-detail">
                          <h2>{venue.name}</h2>
                          {osmLayout !== null && venue.layouts[osmLayout] ? (
                            <>
                              <div className="track-stats">
                                <div>
                                  <strong>
                                    {(
                                      venue.layouts[osmLayout].lengthM / 1000
                                    ).toFixed(2)}{" "}
                                    km
                                  </strong>
                                  <span>{venue.layouts[osmLayout].name}</span>
                                </div>
                                <div>
                                  <strong>{venue.layouts.length}</strong>
                                  <span>
                                    mapped{" "}
                                    {venue.layouts.length === 1
                                      ? "layout"
                                      : "layouts"}
                                  </span>
                                </div>
                                <div>
                                  <strong>{mineHere.length}</strong>
                                  <span>of your tracks here</span>
                                </div>
                              </div>
                              <p className="muted">
                                {
                                  layoutSourceText[
                                    venue.layouts[osmLayout].source
                                  ]
                                }{" "}
                                OpenStreetMap does not record the start/finish
                                line or the direction of timing. They come from
                                your recordings.
                              </p>
                            </>
                          ) : (
                            <p className="muted">
                              No complete layout could be assembled from what is
                              mapped here. The amber lines are the mapped track
                              pieces.
                            </p>
                          )}
                          {shape === null && (
                            <p className="muted">Track shape unavailable.</p>
                          )}
                        </section>
                      )}
                      {showMine && (
                        <section className="panel track-detail">
                          <h2>{showMine.name}</h2>
                          <div className="track-stats">
                            <div>
                              <strong>{showMine.sessions.length}</strong>
                              <span>sessions</span>
                            </div>
                            <div>
                              <strong>{showMine.laps}</strong>
                              <span>laps</span>
                            </div>
                            <div>
                              <strong>
                                {showMine.best
                                  ? lapTime(showMine.best.ms)
                                  : "-"}
                              </strong>
                              <span>
                                best lap
                                {showMine.best &&
                                  `, lap ${showMine.best.lapNumber} of ${new Date(showMine.best.session.start).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`}
                              </span>
                            </div>
                            <div>
                              <strong>
                                {(showMine.lengthM / 1000).toFixed(2)} km
                              </strong>
                              <span>
                                {showMine.best ? "lap length" : "path length"}
                              </span>
                            </div>
                          </div>
                          <p className="muted">
                            {
                              {
                                you: "Start/finish line placed by you.",
                                session:
                                  "Start/finish line taken from another session of this track.",
                                laps: "Start/finish line where the laps begin in the recordings.",
                                "lap start":
                                  "Start/finish line at the start of the fastest lap. No other session confirms it.",
                                none: "No laps yet, so no start/finish line. Place one to cut the laps.",
                              }[showMine.lineFrom]
                            }
                            {showMine.finish &&
                              showMine.line &&
                              ` The laps finish ${Math.round(
                                Math.hypot(
                                  (showMine.finish.lon - showMine.line.lon) *
                                    Math.cos(
                                      (showMine.line.lat * Math.PI) / 180,
                                    ) *
                                    111320,
                                  (showMine.finish.lat - showMine.line.lat) *
                                    110540,
                                ),
                              ).toLocaleString(
                                "en-GB",
                              )} m from where they start, at a separate finish line. The drive back is not timed.`}
                          </p>
                          <div className="review-actions">
                            <button
                              className="sync-button"
                              onClick={() => analyzeTrack(showMine.sessions)}
                            >
                              Analyze this track
                            </button>
                            {showMine.trackId === sa?.trackId && (
                              <button
                                disabled={!ref}
                                onClick={() => {
                                  saveGates(gates);
                                  setTab("Optimal lap");
                                }}
                              >
                                Create / edit layout from GPS
                              </button>
                            )}
                            {showMine.sessions.some(
                              (x) => x.format === "vbo",
                            ) && (
                              <button
                                onClick={() =>
                                  setLineFor(
                                    showMine.sessions.find(
                                      (x) => x.format === "vbo",
                                    )!.id,
                                  )
                                }
                              >
                                {showMine.lineFrom === "none"
                                  ? "Set start/finish line"
                                  : "Move start/finish line"}
                              </button>
                            )}
                          </div>
                        </section>
                      )}
                    </div>
                  </div>
                  <p className="footnote">
                    Catalog: © OpenStreetMap contributors · ODbL · Coverage
                    depends on what is mapped. Mapped layouts do not define
                    timing: the start/finish line comes from your recordings.
                  </p>
                </>
              )}
            </>
          )}
        </div>
        <footer>
          <a
            className="brand-mini"
            href="https://mthracelab.com/"
            aria-label="MTH Race Lab home"
          >
            <img src={raceLabLogo} alt="MTH Race Lab" width="415" height="68" />
          </a>
          <span>A little more understanding. A little less lap time.</span>
          <a href="/privacy.html">Privacy</a>
          <a href="/terms.html">Terms</a>
          <button
            onClick={() =>
              download("track-day.rcsync.json", JSON.stringify(sync, null, 2))
            }
          >
            <ArrowDownToLine size={13} /> Download sync file
          </button>
        </footer>
      </main>
      {removeId && sessions.find((s) => s.id === removeId) && (
        <RemoveSession
          session={sessions.find((s) => s.id === removeId)!}
          busy={removing}
          error={removeError}
          onRemove={deleteSession}
          onClose={() => setRemoveId(null)}
        />
      )}
      {trackFor && sessions.find((x) => x.id === trackFor) && (
        <TrackChooser
          session={sessions.find((x) => x.id === trackFor)!}
          tracks={knownTracks(sessions)}
          onClose={() => setTrackFor(null)}
          onApply={async (choice) => {
            const current = sessions.find((x) => x.id === trackFor)!;
            try {
              const updated = assignTrack(
                current,
                sessions.filter((x) => x.id !== current.id),
                choice,
              );
              await updateSession(updated);
              setSessions((old) =>
                old.map((x) => (x.id === updated.id ? updated : x)),
              );
              setStatus(
                `${current.filename} is now on ${updated.track}.` +
                  (updated.format === "vbo" && !updated.laps.length
                    ? " It has no laps yet, so place its start/finish line."
                    : ""),
              );
              setTrackFor(null);
            } catch (e) {
              report(e);
            }
          }}
        />
      )}
      {lineFor && sessions.find((x) => x.id === lineFor) && (
        <LineEditor
          session={sessions.find((x) => x.id === lineFor)!}
          onClose={() => setLineFor(null)}
          onApply={async (line) => {
            const current = sessions.find((x) => x.id === lineFor)!;
            const updated = applyLine(current, line);
            try {
              await updateSession(updated);
              setSessions((old) =>
                old.map((x) => (x.id === updated.id ? updated : x)),
              );
              setStatus(
                `${updated.laps.length} laps found for ${updated.track}.`,
              );
              setLineFor(null);
            } catch (e) {
              report(e);
            }
          }}
        />
      )}
      {reviewTrace && reviewSession && (
        <LapReview
          title={`Lap ${String(reviewTrace.lap.number).padStart(2, "0")} · ${lapTime(reviewTrace.lap.end - reviewTrace.lap.start)}`}
          where={`${reviewSession.track} · ${new Date(reviewSession.start).toLocaleDateString("en-GB")} ${new Date(reviewSession.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
          issues={reviewTrace.issues}
          status={reviewStatus}
          trackName={reviewSession.track}
          currentTrack={sa?.track ?? ""}
          effect={reviewEffect}
          onValid={() =>
            patch({
              excluded: settings.excluded.filter((id) => id !== reviewTrace.id),
              included: [
                ...settings.included.filter((id) => id !== reviewTrace.id),
                reviewTrace.id,
              ],
            })
          }
          onExclude={() =>
            patch({
              included: settings.included.filter((id) => id !== reviewTrace.id),
              excluded: [
                ...settings.excluded.filter((id) => id !== reviewTrace.id),
                reviewTrace.id,
              ],
            })
          }
          onAutomatic={() =>
            patch({
              included: settings.included.filter((id) => id !== reviewTrace.id),
              excluded: settings.excluded.filter((id) => id !== reviewTrace.id),
            })
          }
          onOpenTrack={() =>
            analyzeTrack(
              sessions.filter((x) => x.trackId === reviewSession.trackId),
            )
          }
          onClose={() => setReviewId(null)}
        />
      )}
      {summarySession && (
        <SessionSummary
          session={summarySession}
          summary={summarize(summarySession)}
          optMs={
            sessionOpt.get(summarySession.id) ?? summarySession.importedOptimal
          }
          optSource={sessionOpt.has(summarySession.id) ? "app" : "racechrono"}
          speedUnit={settings.speedUnit}
          onClose={() => setSummaryId(null)}
          onLap={(id) => {
            patch({ a: id });
            setSummaryId(null);
            setTab("Analyze");
          }}
        />
      )}
    </div>
  );
}
