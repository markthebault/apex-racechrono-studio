import { analysisTools } from "../raceEngineer/tools";
export const guide = `Read apex_state first. For requests created in Race Engineer, use apex_engineer_context and its exact snapshot ID instead of preparing a separate analysis; return the validated report through apex_engineer_report. Distinguish selected laps, visible range and cursor from the approved analysis snapshot. Call apex_prepare_analysis with explicit recorded lapIds and referenceId, then use the returned snapshotId with analysis tools. Telemetry queries use meters of reference progress and canonical channels. GPS cannot prove pedal inputs, unused grip or the ideal line. Compare multiple clean repetitions; report gaps, contrary evidence and traffic/condition hypotheses. Every theoretical lap must include its sector count; all laps contribute except sectors overlapping GPS gaps longer than 2 seconds. Video images are optional evidence: inspect sequences before/at/after a corner and compare laps. State visible observations separately from hypotheses; do not infer exact edge distances, camera calibration or optimal apex from a still. No video means no visual line verdict.`;
const schema = (
  properties: Record<string, object> = {},
  required: string[] = [],
) => ({ type: "object", properties, required, additionalProperties: false });
export const tools = [
  {
    name: "apex_engineer_context",
    description:
      "Read the open Race Engineer review, pending user request, exact snapshot ID and report schema. Start here when asked to review from Race Engineer.",
    inputSchema: schema(),
  },
  {
    name: "apex_engineer_report",
    description:
      "Return evidence-linked advice for the pending Race Engineer request and save it in Apex. Requires exact requestId and current snapshot; rejects stale or invalid reports.",
    inputSchema: schema(
      {
        requestId: { type: "string" },
        report: {
          type: "object",
          description:
            "Report matching reportSchema from apex_engineer_context.",
        },
      },
      ["requestId", "report"],
    ),
  },
  {
    name: "apex_state",
    description:
      "Current workspace, selected laps, zoom, cursor, channels, recordings, video availability and view revision.",
    inputSchema: schema(),
  },
  {
    name: "apex_guide",
    description: "Read analysis workflow, units and interpretation limits.",
    inputSchema: schema(),
  },
  {
    name: "apex_view",
    description:
      "Set workspace, comparison laps, distance range or cursor. Requires control permission. Read state after changes.",
    inputSchema: schema({
      tab: {
        type: "string",
        enum: [
          "Analyze",
          "Sessions",
          "Race Engineer",
          "Video sync",
          "Optimal lap",
        ],
      },
      lapId: { type: "string" },
      comparisonLapId: { type: "string" },
      range: {
        type: "array",
        items: { type: "number" },
        minItems: 2,
        maxItems: 2,
      },
      cursor: { type: "number" },
      revision: { type: "integer" },
    }),
  },
  {
    name: "apex_prepare_analysis",
    description:
      "Prepare analysis of explicit laps on one track. Returns snapshot ID for analysis tools.",
    inputSchema: schema(
      {
        lapIds: { type: "array", items: { type: "string" }, minItems: 1 },
        referenceId: { type: "string" },
      },
      ["lapIds", "referenceId"],
    ),
  },
  {
    name: "apex_video_frames",
    description:
      "Get up to six JPEG stills at lap-relative times in seconds from linked synchronized video. Requires video permission. Does not change playback.",
    inputSchema: schema(
      {
        lapId: { type: "string" },
        times: {
          type: "array",
          items: { type: "number" },
          minItems: 1,
          maxItems: 6,
        },
      },
      ["lapId", "times"],
    ),
  },
  ...analysisTools(),
];
export function startBridge(
  port: number,
  token: string,
  invoke: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  status: (s: string) => void,
) {
  let stopped = false,
    socket: WebSocket | undefined,
    timer: ReturnType<typeof setTimeout>;
  let queue = Promise.resolve();
  const connect = async () => {
    status("Connecting");
    try {
      const r = await fetch(`http://127.0.0.1:${port}/apex-mcp`, {
        cache: "no-store",
        targetAddressSpace: "loopback",
      } as RequestInit);
      if (!r.ok) throw Error("Local helper unavailable");
      if (stopped) return;
      const ws = (socket = new WebSocket(`ws://127.0.0.1:${port}`));
      ws.onopen = () => ws.send(JSON.stringify({ token, tools }));
      ws.onmessage = (e) => {
        let m;
        try {
          m = JSON.parse(e.data);
        } catch {
          ws.close();
          return;
        }
        if (m.welcome) {
          status("Connected");
          return;
        }
        queue = queue.then(async () => {
          if (stopped || socket !== ws) return;
          try {
            const result = await invoke(m.name, m.args);
            if (!stopped && ws.readyState === 1)
              ws.send(JSON.stringify({ id: m.id, result }));
          } catch (e) {
            if (ws.readyState === 1)
              ws.send(
                JSON.stringify({
                  id: m.id,
                  error: e instanceof Error ? e.message : String(e),
                }),
              );
          }
        });
      };
      ws.onclose = () => {
        if (stopped) return;
        status("Disconnected");
        if (!stopped) timer = setTimeout(connect, 3000);
      };
      ws.onerror = () => {
        if (!stopped) status("Connection failed");
      };
    } catch {
      if (stopped) return;
      status("Helper unavailable or browser permission denied");
      if (!stopped) timer = setTimeout(connect, 3000);
    }
  };
  void connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    socket?.close();
    status("Off");
  };
}
