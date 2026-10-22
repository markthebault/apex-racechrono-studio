import { describe, expect, it, vi } from "vitest";
import { emptySettings, type Snapshot, type Report } from "./contracts";
import { AnalysisService } from "./service";
import { analysisTools } from "./tools";
import { connect, type ModelContext } from "./webmcp";
import { reportFormat } from "./reportFormat";
import {
  completionUrl,
  engineerTurn,
  initialMessages,
  loadProvider,
  parseReview,
  saveProvider,
  MAX_OUTPUT_TOKENS,
  openRouterModel,
  type Message,
} from "./provider";

function fixture() {
  const snapshot: Snapshot = {
    version: 1,
    algorithm: "engineer-1",
    id: "approved-snapshot",
    referenceId: "lap-a",
    sessionIds: ["session-a"],
    contexts: {},
    capabilities: {},
    laps: [
      {
        id: "lap-a",
        sessionId: "session-a",
        number: 2,
        durationMs: 90_000,
        issues: [],
        coachingEligible: true,
      },
    ],
    corners: [
      {
        id: "corner-a",
        name: "Corner 1",
        start: 0,
        end: 100,
        direction: "left",
      },
    ],
    evidence: [
      {
        id: "evidence-a",
        snapshotId: "approved-snapshot",
        sessionId: "session-a",
        lapId: "lap-a",
        cornerId: "corner-a",
        time: [0, 5000],
        distance: [0, 100],
        quality: [],
        metrics: {},
        uncertainty: "GPS",
      },
    ],
    priorities: [],
    envelope: {
      status: "unavailable",
      bins: [],
      method: "none",
      limitations: [],
    },
    modeled: { status: "unavailable", reasons: [] },
    warnings: [],
  };
  const service = new AnalysisService(snapshot, [], emptySettings());
  service.grant();
  const report: Report = {
    format: "apex-engineer-report",
    version: 1,
    snapshotId: snapshot.id,
    priorities: [
      {
        category: "telemetry-comparison",
        evidenceIds: ["evidence-a"],
        observation: "Observed difference",
        explanation: "Uncertain",
        experiment: "Review consistency",
        limitations: "GPS only",
      },
    ],
  };
  return { snapshot, service, report };
}
const config = {
  baseUrl: "https://api.example/v1",
  model: "test-model",
  apiKey: "test-key-never-a-real-credential",
};
function answer(content: string | null, calls?: unknown[], finish = "stop") {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: finish,
          message: {
            role: "assistant",
            content,
            ...(calls ? { tool_calls: calls } : {}),
          },
        },
      ],
    }),
  );
}
function call(name: string, args: unknown, id = "call-1") {
  return {
    type: "function",
    id,
    function: { name, arguments: JSON.stringify(args) },
  };
}
const options = () => ({
  config,
  signal: new AbortController().signal,
  messages: [{ role: "user", content: "Review" }] as Message[],
});

describe("API-backed race engineer", () => {
  it("constrains corner identity, shape and sources before the model generates a report", () => {
    const { snapshot } = fixture();
    snapshot.evidence.push({
      ...snapshot.evidence[0],
      id: "other-corner-source",
      cornerId: "other-corner",
    });
    const format = reportFormat({ snapshot, cornerId: "corner-a" });
    expect(format).toMatchObject({
      type: "json_schema",
      json_schema: { strict: true, name: "corner_review" },
    });
    const schema = format.json_schema.schema as any;
    expect(schema.properties.snapshotId.enum).toEqual([snapshot.id]);
    expect(
      schema.properties.cornerReviews.items.properties.cornerId.enum,
    ).toEqual(["corner-a"]);
    expect(
      schema.properties.cornerReviews.items.properties.evidenceIds.items.enum,
    ).toEqual(["evidence-a", "e1"]);
    expect(schema.properties.cornerReviews.items.required).toContain(
      "possibleMistakes",
    );
    expect(schema.properties.cornerReviews.items.additionalProperties).toBe(
      false,
    );
    expect(() => reportFormat({ snapshot, cornerId: "missing" })).toThrow(
      "Unknown review corner",
    );
  });
  it("keeps a strict session schema and Medium reasoning throughout source checking and bounded repair", async () => {
    const { snapshot, service } = fixture();
    const valid = {
      format: "apex-engineer-report",
      version: 1,
      snapshotId: snapshot.id,
      priorities: [],
      debrief: {
        headline: "Collect a repeatable baseline",
        assessment: "The cause is unknown.",
        findings: [],
        practicePlan: [],
      },
    };
    const invalid = { ...valid, debrief: { ...valid.debrief, headline: null } };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(answer(JSON.stringify(valid)))
      .mockResolvedValueOnce(answer(JSON.stringify(invalid)))
      .mockResolvedValueOnce(answer(JSON.stringify(valid)));
    const result = await engineerTurn({
      ...options(),
      config: {
        ...config,
        baseUrl: "https://openrouter.ai/api/v1",
        model: "openai/gpt-6-luna",
        reasoningEffort: "medium",
      },
      review: { snapshot },
      service,
      snapshotId: snapshot.id,
      fetcher,
    });
    expect(parseReview(result.text, service)?.debrief?.headline).toBe(
      valid.debrief.headline,
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [, init] of fetcher.mock.calls)
      expect(JSON.parse(init!.body as string)).toMatchObject({
        model: "openai/gpt-6-luna",
        reasoning: { effort: "medium" },
        response_format: {
          type: "json_schema",
          json_schema: { strict: true, name: "session_debrief" },
        },
      });
  });
  it("bounds schema enums for large session scopes while retaining report source validation", () => {
    const { snapshot, service, report } = fixture();
    snapshot.evidence = Array.from({ length: 120 }, (_, i) => ({
      ...snapshot.evidence[0],
      id: `source-${i}`,
    }));
    const schema = reportFormat({ snapshot }).json_schema.schema as any;
    expect(
      schema.properties.debrief.properties.findings.items.properties.evidenceIds
        .items.enum,
    ).toBeUndefined();
    expect(() =>
      service.report({
        ...report,
        priorities: [
          { ...report.priorities[0], evidenceIds: ["invented-source"] },
        ],
      }),
    ).toThrow(/Unknown or out-of-scope evidence/);
  });
  it("accepts a catalog-verified Luna snapshot while keeping Medium and the requested alias on every paid request", async () => {
    const { snapshot, service, report } = fixture();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).endsWith("/models"))
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "openai/gpt-6-luna",
                canonical_slug: "openai/gpt-6-luna-20260922",
              },
            ],
          }),
        );
      const response = await answer(JSON.stringify(report)).json();
      return new Response(
        JSON.stringify({ ...response, model: "openai/gpt-6-luna-2026-09-22" }),
      );
    });
    const result = await engineerTurn({
      ...options(),
      config: {
        ...config,
        baseUrl: "https://openrouter.ai/api/v1",
        model: "openai/gpt-6-luna",
        reasoningEffort: "medium",
      },
      service,
      snapshotId: snapshot.id,
      fetcher,
    });
    expect(parseReview(result.text, service)).toEqual(report);
    const paid = fetcher.mock.calls.filter(
      ([, init]) => init?.method === "POST",
    );
    expect(paid).toHaveLength(2);
    for (const [, init] of paid)
      expect(JSON.parse(init!.body as string)).toMatchObject({
        model: "openai/gpt-6-luna",
        reasoning: { effort: "medium", exclude: true },
      });
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).endsWith("/models")),
    ).toHaveLength(1);
    const catalogRequest = fetcher.mock.calls.find(([url]) =>
      String(url).endsWith("/models"),
    )![1]!;
    expect(catalogRequest).not.toHaveProperty("headers");
    expect(catalogRequest).not.toHaveProperty("body");
    expect(catalogRequest.credentials).toBe("omit");
  });
  it("stops before the next paid request when scope is revoked during alias verification", async () => {
    const { snapshot, service } = fixture();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).endsWith("/models")) {
        service.revoke();
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "openai/gpt-6-luna",
                canonical_slug: "openai/gpt-6-luna-20260922",
              },
            ],
          }),
        );
      }
      const response = await answer("A draft.").json();
      return new Response(
        JSON.stringify({ ...response, model: "openai/gpt-6-luna-20260922" }),
      );
    });
    await expect(
      engineerTurn({
        ...options(),
        config: {
          ...config,
          baseUrl: "https://openrouter.ai/api/v1",
          model: "openai/gpt-6-luna",
          reasoningEffort: "medium",
        },
        service,
        snapshotId: snapshot.id,
        fetcher,
      }),
    ).rejects.toThrow("sharing_not_approved");
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
  });
  it.each(["low", "medium", "high"] as const)(
    "sends %s reasoning on investigation and source-check requests without changing the model",
    async (effort) => {
      const { snapshot, service } = fixture();
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementation(async () => answer("Supported answer."));
      await engineerTurn({
        ...options(),
        config: {
          ...config,
          baseUrl: "https://openrouter.ai/api/v1",
          model: openRouterModel,
          reasoningEffort: effort,
        },
        service,
        snapshotId: snapshot.id,
        fetcher,
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
      for (const [, init] of fetcher.mock.calls) {
        const body = JSON.parse(init!.body as string);
        expect(body.model).toBe(openRouterModel);
        expect(body.reasoning).toEqual({ effort, exclude: true });
      }
    },
  );
  it("rejects an invalid reasoning effort before sending a request", async () => {
    const { snapshot, service } = fixture();
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      engineerTurn({
        ...options(),
        config: { ...config, reasoningEffort: "invalid" as "low" },
        service,
        snapshotId: snapshot.id,
        fetcher,
      }),
    ).rejects.toThrow("reasoning effort");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses only the selected OpenRouter model with low reasoning and bounded output, and reports billed usage", async () => {
    const { snapshot, service } = fixture();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            model: openRouterModel,
            usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.0001 },
            choices: [
              {
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: "Insufficient evidence.",
                },
              },
            ],
          }),
        ),
    );
    const onUsage = vi.fn();
    await engineerTurn({
      ...options(),
      config: {
        ...config,
        baseUrl: "https://openrouter.ai/api/v1/",
        model: openRouterModel,
      },
      service,
      snapshotId: snapshot.id,
      fetcher,
      onUsage,
    });
    const request = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(request).toMatchObject({
      model: openRouterModel,
      max_tokens: MAX_OUTPUT_TOKENS,
      reasoning: { effort: "low", exclude: true },
      provider: { require_parameters: true },
    });
    expect(request.models).toBeUndefined();
    expect(request.route).toBeUndefined();
    expect(onUsage).toHaveBeenCalledWith({
      requests: 1,
      promptTokens: 100,
      completionTokens: 50,
      costUsd: 0.0001,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(fetcher.mock.calls[1][1]!.body as string).tool_choice,
    ).toBe("none");
  });
  it("stops when OpenRouter returns a different model, without retrying", async () => {
    const { snapshot, service } = fixture();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ model: "unexpected-model" })),
      );
    await expect(
      engineerTurn({
        ...options(),
        config: {
          ...config,
          baseUrl: "https://openrouter.ai/api/v1",
          model: openRouterModel,
        },
        service,
        snapshotId: snapshot.id,
        fetcher,
      }),
    ).rejects.toThrow("different or unverifiable model");
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
  });
  it("checks OpenRouter drafts against evidence using the same model, and keeps only the checked answer in history", async () => {
    const { snapshot, service } = fixture();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        answer(
          "The reference is fastest and the deceleration percentile is a measured peak.",
        ),
      )
      .mockResolvedValueOnce(
        answer(
          "The reference is selected for review; the derived percentile does not measure pedal use.",
        ),
      );
    const onVerify = vi.fn();
    const result = await engineerTurn({
      ...options(),
      config: {
        ...config,
        baseUrl: "https://openrouter.ai/api/v1",
        model: openRouterModel,
      },
      service,
      snapshotId: snapshot.id,
      fetcher,
      onVerify,
    });
    expect(result.text).toContain("derived percentile");
    expect(result.messages).toHaveLength(2);
    expect(JSON.stringify(result.messages)).not.toContain(
      "reference is fastest",
    );
    const check = JSON.parse(fetcher.mock.calls[1][1]!.body as string);
    expect(check.messages.at(-1).content).toContain("numerical ordering");
    expect(check.messages.at(-1).content).toContain(
      "clear, simple English and short sentences",
    );
    expect(check).toMatchObject({
      model: openRouterModel,
      reasoning: { effort: "low" },
      tool_choice: "none",
    });
    expect(onVerify).toHaveBeenCalledOnce();
  });
  it("passes a malformed report's validation issue to the reserved source check before display", async () => {
    const { snapshot, service, report } = fixture();
    const malformed = {
      ...report,
      priorities: [
        {
          id: "invented-schema",
          action: "A made-up priority shape",
          evidenceIds: ["evidence-a"],
        },
      ],
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(answer(JSON.stringify(malformed)))
      .mockResolvedValueOnce(
        answer(
          JSON.stringify({
            ...report,
            priorities: [],
            debrief: {
              headline: "Not enough evidence",
              assessment: "Collect comparable clean laps.",
              findings: [],
              practicePlan: [],
            },
          }),
        ),
      );
    const result = await engineerTurn({
      ...options(),
      config: {
        ...config,
        baseUrl: "https://openrouter.ai/api/v1",
        model: openRouterModel,
      },
      service,
      snapshotId: snapshot.id,
      fetcher,
    });
    expect(
      JSON.parse(fetcher.mock.calls[1][1]!.body as string).messages.at(-1)
        .content,
    ).toContain("Draft structure validation failed");
    expect(parseReview(result.text, service)?.debrief?.findings).toEqual([]);
    expect(JSON.stringify(result.messages)).not.toContain("invented-schema");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("repairs an invalid checked report once within the same request budget and removes rejected drafts", async () => {
    const { snapshot, service, report } = fixture();
    const malformed = {
      ...report,
      priorities: [{ id: "invalid-checked-priority" }],
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(answer(JSON.stringify(report)))
      .mockResolvedValueOnce(answer(JSON.stringify(malformed)))
      .mockResolvedValueOnce(answer(JSON.stringify(report)));
    const result = await engineerTurn({
      ...options(),
      config: {
        ...config,
        baseUrl: "https://openrouter.ai/api/v1",
        model: openRouterModel,
      },
      service,
      snapshotId: snapshot.id,
      fetcher,
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    const repair = JSON.parse(fetcher.mock.calls[2][1]!.body as string);
    expect(repair.messages.at(-1).content).toContain(
      "failed deterministic validation",
    );
    expect(repair).toMatchObject({
      model: openRouterModel,
      reasoning: { effort: "low" },
      tool_choice: "none",
    });
    expect(result.messages).toHaveLength(2);
    expect(JSON.stringify(result.messages)).not.toContain(
      "invalid-checked-priority",
    );
    expect(parseReview(result.text, service)).toEqual(report);
  });
  it("stops after a failed format repair rather than spending on an unbounded loop", async () => {
    const { snapshot, service, report } = fixture();
    const invalid = { ...report, priorities: [{ id: "invalid" }] };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(answer(JSON.stringify(report)))
      .mockImplementation(async () => answer(JSON.stringify(invalid)));
    await expect(
      engineerTurn({
        ...options(),
        config: {
          ...config,
          baseUrl: "https://openrouter.ai/api/v1",
          model: openRouterModel,
        },
        service,
        snapshotId: snapshot.id,
        fetcher,
      }),
    ).rejects.toThrow(
      "The AI report could not be validated: Invalid report priority.",
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("does not send OpenRouter-specific reasoning options to other providers or invent missing cost", async () => {
    const { snapshot, service } = fixture();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(answer("Insufficient evidence."));
    const onUsage = vi.fn();
    await engineerTurn({
      ...options(),
      service,
      snapshotId: snapshot.id,
      fetcher,
      onUsage,
    });
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body.max_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect(body.reasoning).toBeUndefined();
    expect(body.provider).toBeUndefined();
    expect(onUsage).toHaveBeenCalledWith({
      requests: 1,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: null,
    });
  });
  it("retains a useful assessment when no priorities are supported, while validating summary size", () => {
    const { service, report } = fixture();
    const abstention = {
      ...report,
      summary:
        "Only one comparable lap. Record repeatable laps before recommending a change.",
      priorities: [],
    };
    expect(parseReview(JSON.stringify(abstention), service)).toEqual(
      abstention,
    );
    expect(() =>
      parseReview(
        JSON.stringify({ ...abstention, summary: "x".repeat(3001) }),
        service,
      ),
    ).toThrow("invalid evidence");
  });
  it("labels the reference independently from the quickest selected duration and shares display units", async () => {
    const { snapshot } = fixture();
    snapshot.laps.push({
      ...snapshot.laps[0],
      id: "lap-b",
      number: 3,
      durationMs: 80_000,
    });
    const service = new AnalysisService(snapshot, [], emptySettings());
    service.grant();
    const messages = await initialMessages(service, snapshot, "mph");
    const selected = JSON.parse(
      messages[1].content!.split("\n").slice(1).join("\n"),
    );
    expect(selected.summary.laps[0]).toMatchObject({
      id: "lap-a",
      isReference: true,
      hasShortestSelectedDuration: false,
    });
    expect(selected.summary.laps[1]).toMatchObject({
      id: "lap-b",
      isReference: false,
      hasShortestSelectedDuration: true,
    });
    expect(selected.displayUnits).toEqual({ speed: "mph", elapsed: "s" });
  });
  it("uses the same query definitions as WebMCP and keeps grants independent", async () => {
    const { snapshot, service, report } = fixture();
    const browserService = new AnalysisService(snapshot, [], emptySettings());
    const registered: Parameters<ModelContext["registerTool"]>[0][] = [];
    const stop = connect(
      {
        registerTool: (tool) => {
          registered.push(tool);
        },
      },
      browserService,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      registered.map(({ name, inputSchema }) => ({ name, inputSchema })),
    ).toEqual(
      analysisTools().map(({ name, inputSchema }) => ({ name, inputSchema })),
    );
    const browserSummary = registered.find((t) => t.name === "apex_summary")!;
    expect(
      await browserSummary.execute({ snapshotId: snapshot.id }),
    ).toHaveProperty("error", "sharing_not_approved");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        answer(null, [
          call("apex_corners", {
            snapshotId: snapshot.id,
            cornerId: "corner-a",
            lapId: "lap-a",
          }),
        ]),
      )
      .mockResolvedValueOnce(answer(JSON.stringify(report)));
    const messages = await initialMessages(service, snapshot);
    const result = await engineerTurn({
      ...options(),
      messages,
      service,
      snapshotId: snapshot.id,
      fetcher,
    });
    expect(result.calls).toBe(1);
    expect(parseReview(result.text, service)).toEqual(report);
    const requests = fetcher.mock.calls.map(([, init]) =>
      JSON.parse(init!.body as string),
    );
    expect(requests[1].messages.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "call-1",
    });
    expect(JSON.parse(requests[1].messages.at(-1).content).evidence[0].id).toBe(
      "evidence-a",
    );
    expect(
      requests[0].tools.map(
        (t: { function: { name: string } }) => t.function.name,
      ),
    ).toEqual(analysisTools().map((t) => t.name));
    expect(JSON.stringify(requests)).not.toContain(config.apiKey);
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    expect(
      await browserSummary.execute({ snapshotId: snapshot.id }),
    ).toHaveProperty("error", "sharing_not_approved");
    stop();
  });
  it("rejects stale, foreign and invented tool requests before returning private evidence", async () => {
    const { snapshot, service } = fixture();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        answer(null, [
          call(
            "apex_corners",
            { snapshotId: "stale", cornerId: "corner-a" },
            "stale",
          ),
          call(
            "apex_corners",
            { snapshotId: snapshot.id, cornerId: "corner-a", lapId: "foreign" },
            "foreign",
          ),
          call("upload_recording", { snapshotId: snapshot.id }, "invented"),
          call(
            "apex_summary",
            { snapshotId: snapshot.id, extra: "not-allowed" },
            "extra",
          ),
        ]),
      )
      .mockResolvedValueOnce(answer("Not enough evidence."));
    await engineerTurn({
      ...options(),
      service,
      snapshotId: snapshot.id,
      fetcher,
    });
    const sent = JSON.parse(
      fetcher.mock.calls[1][1]!.body as string,
    ).messages.filter((m: Message) => m.role === "tool");
    expect(sent).toHaveLength(4);
    expect(sent.every((m: Message) => JSON.parse(m.content!).error)).toBe(true);
    expect(JSON.stringify(sent)).not.toContain("evidence-a");
  });
  it("does not send anything without consent, and honors revocation mid-turn", async () => {
    const { snapshot, service } = fixture();
    const fetcher = vi.fn<typeof fetch>();
    service.revoke();
    await expect(
      engineerTurn({ ...options(), service, snapshotId: snapshot.id, fetcher }),
    ).rejects.toThrow("sharing_not_approved");
    expect(fetcher).not.toHaveBeenCalled();
    service.grant();
    fetcher.mockImplementationOnce(async () => {
      service.revoke();
      return answer("Late result");
    });
    await expect(
      engineerTurn({ ...options(), service, snapshotId: snapshot.id, fetcher }),
    ).rejects.toThrow("sharing_not_approved");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("stops a canceled turn even when a provider returns late", async () => {
    const { snapshot, service } = fixture();
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => {
      controller.abort();
      return answer("Late result");
    });
    await expect(
      engineerTurn({
        ...options(),
        signal: controller.signal,
        service,
        snapshotId: snapshot.id,
        fetcher,
      }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("caps tool loops and blocks malformed or excessive calls", async () => {
    const { snapshot, service } = fixture();
    const loop = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        answer(null, [call("apex_capabilities", { snapshotId: snapshot.id })]),
      );
    await expect(
      engineerTurn({
        ...options(),
        service,
        snapshotId: snapshot.id,
        fetcher: loop,
      }),
    ).rejects.toThrow("request limit");
    expect(loop).toHaveBeenCalledTimes(6);
    const duplicate = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        answer(null, [
          call("apex_summary", {}, "same"),
          call("apex_summary", {}, "same"),
        ]),
      );
    await expect(
      engineerTurn({
        ...options(),
        service,
        snapshotId: snapshot.id,
        fetcher: duplicate,
      }),
    ).rejects.toThrow("invalid tool call");
    const many = vi.fn<typeof fetch>().mockResolvedValue(
      answer(
        null,
        Array.from({ length: 9 }, (_, i) =>
          call("apex_summary", {}, String(i)),
        ),
      ),
    );
    await expect(
      engineerTurn({
        ...options(),
        service,
        snapshotId: snapshot.id,
        fetcher: many,
      }),
    ).rejects.toThrow("tool limit");
  });
  it("reserves the final request for an answer instead of discarding a whole investigation at the loop limit", async () => {
    const { snapshot, service } = fixture();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) => {
        const request = JSON.parse(init!.body as string);
        return request.tool_choice === "none"
          ? answer("No recommendation supported by the available evidence.")
          : answer(null, [
              call("apex_capabilities", { snapshotId: snapshot.id }),
            ]);
      });
    const result = await engineerTurn({
      ...options(),
      service,
      snapshotId: snapshot.id,
      fetcher,
    });
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(result.text).toContain("No recommendation supported");
    expect(result.calls).toBe(5);
  });
  it("reports provider errors without displaying credentials echoed by a server", async () => {
    const { snapshot, service } = fixture();
    for (const status of [401, 403, 429, 400, 500]) {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(config.apiKey, { status }));
      await expect(
        engineerTurn({
          ...options(),
          service,
          snapshotId: snapshot.id,
          fetcher,
        }),
      ).rejects.not.toThrow(config.apiKey);
    }
    const unreachable = vi
      .fn<typeof fetch>()
      .mockRejectedValue(Error(config.apiKey));
    await expect(
      engineerTurn({
        ...options(),
        service,
        snapshotId: snapshot.id,
        fetcher: unreachable,
      }),
    ).rejects.toThrow("CORS");
  });
  it("rejects oversized, truncated and incompatible responses", async () => {
    const { snapshot, service } = fixture();
    const oversized = vi
      .fn<typeof fetch>()
      .mockResolvedValue(answer("x".repeat(600 * 1024)));
    await expect(
      engineerTurn({
        ...options(),
        service,
        snapshotId: snapshot.id,
        fetcher: oversized,
      }),
    ).rejects.toThrow("too large");
    const truncated = vi
      .fn<typeof fetch>()
      .mockResolvedValue(answer("partial", undefined, "length"));
    await expect(
      engineerTurn({
        ...options(),
        service,
        snapshotId: snapshot.id,
        fetcher: truncated,
      }),
    ).rejects.toThrow("cut off");
    const incompatible = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ choices: [] })));
    await expect(
      engineerTurn({
        ...options(),
        service,
        snapshotId: snapshot.id,
        fetcher: incompatible,
      }),
    ).rejects.toThrow("compatible");
  });
  it("validates AI evidence links without trusting prose or leaking raw JSON to the UI", () => {
    const { service, report } = fixture();
    expect(parseReview("Plain answer", service)).toBeUndefined();
    expect(
      parseReview("```json\n" + JSON.stringify(report) + "\n```", service),
    ).toEqual(report);
    report.priorities[0].evidenceIds = ["invented-evidence"];
    expect(() => parseReview(JSON.stringify(report), service)).toThrow(
      "invalid evidence",
    );
    expect(() => parseReview("{broken", service)).toThrow("invalid evidence");
  });
});

describe("user-owned API credentials", () => {
  it("allows explicit compatible URLs without credentials, fragments or remote HTTP", () => {
    expect(completionUrl("https://api.example/v1/")).toBe(
      "https://api.example/v1/chat/completions",
    );
    expect(completionUrl("https://api.example/v1/chat/completions")).toBe(
      "https://api.example/v1/chat/completions",
    );
    expect(completionUrl("http://127.0.0.1:8000/v1")).toBe(
      "http://127.0.0.1:8000/v1/chat/completions",
    );
    for (const url of [
      "http://remote.example/v1",
      "https://user:pass@api.example",
      "https://api.example?key=secret",
      "https://api.example/#secret",
      "javascript:alert(1)",
    ])
      expect(() => completionUrl(url)).toThrow();
  });
  it("remembers only explicit credentials and provides a real removal path", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
    };
    expect(loadProvider(storage)).toBeUndefined();
    saveProvider(storage, {
      ...config,
      arbitrary: "not-persisted",
    } as typeof config);
    expect(loadProvider(storage)).toEqual(config);
    expect([...data.values()][0]).not.toContain("arbitrary");
    saveProvider(storage, { ...config, reasoningEffort: "high" });
    expect(loadProvider(storage)?.reasoningEffort).toBe("high");
    saveProvider(storage);
    expect(data.size).toBe(0);
    storage.setItem("apex-engineer-provider-v1", "broken");
    expect(loadProvider(storage)).toBeUndefined();
  });
});
