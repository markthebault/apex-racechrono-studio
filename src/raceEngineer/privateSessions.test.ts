import { describe, it, expect } from "vitest";
import {
  readdirSync,
  readFileSync,
  existsSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { decode } from "../decoder";
import { decodeVbo } from "../vbo";
import { resolveVbo } from "../vboImport";
import { classifyFile } from "../files";
import { buildSnapshot } from "./pipeline";
import { emptySettings } from "./contracts";
import { AnalysisService } from "./service";
const directory = process.env.APEX_FIXTURES;
const available = !!directory && existsSync(directory);
describe.skipIf(!available)("private session Stage 1 evaluation", () => {
  it("imports supported recordings and runs bounded telemetry review without invented channels", async () => {
    const files = readdirSync(directory!).filter((f) =>
      /\.(rcz|vbo|hlptrl)$/i.test(f),
    );
    const rcz = files
      .filter((f) => /\.rcz$/i.test(f))
      .map((name) => {
        const bytes = readFileSync(join(directory!, name));
        return decode(
          bytes,
          name,
          createHash("sha256").update(bytes).digest("hex"),
        );
      });
    const sessions = [
      ...rcz,
      ...files
        .filter((f) => /\.vbo$/i.test(f))
        .map((name) => {
          const bytes = readFileSync(join(directory!, name));
          return resolveVbo(
            decodeVbo(
              bytes,
              name,
              createHash("sha256").update(bytes).digest("hex"),
            ),
            rcz,
          );
        }),
    ];
    const report: unknown[] = [];
    for (const s of sessions) {
      expect(s.times.length).toBeGreaterThan(1);
      expect(s.channels.some((c) => c.id === "speed")).toBe(true);
      if (!s.laps.length) {
        report.push({
          file: s.filename,
          status: "timing-line-required",
          samples: s.times.length,
        });
        continue;
      }
      const settings = emptySettings(),
        ref = s.laps.find((l) => !l.issues.length) ?? s.laps[0],
        start = performance.now();
      const snapshot = await buildSnapshot({
        sessions: [s],
        referenceId: ref.id,
        lapIds: s.laps.map((l) => l.id),
        settings,
      });
      const service = new AnalysisService(snapshot, [s], settings);
      service.grant();
      const capabilities = await service.query("capabilities", {
        snapshotId: snapshot.id,
      });
      expect(JSON.stringify(capabilities)).not.toContain(
        '"semantic":"accelerator"',
      );
      expect(
        snapshot.evidence.every((e) => e.metrics.brakePeak === undefined),
      ).toBe(true);
      expect(snapshot.priorities.length).toBeLessThanOrEqual(3);
      for (const e of snapshot.evidence)
        for (const m of Object.values(e.metrics))
          expect(m.value === null || Number.isFinite(m.value)).toBe(true);
      const packet = service.packet();
      expect(
        new TextEncoder().encode(JSON.stringify(packet)).length,
      ).toBeLessThanOrEqual(65536);
      report.push({
        file: s.filename,
        samples: s.times.length,
        laps: s.laps.length,
        issues: snapshot.laps.map((l) => ({
          number: l.number,
          issues: l.issues,
        })),
        capabilities: snapshot.capabilities[s.id],
        corners: snapshot.corners.length,
        evidence: snapshot.evidence.length,
        priorities: snapshot.priorities.length,
        envelope: snapshot.envelope.status,
        elapsedMs: performance.now() - start,
        packetBytes: new TextEncoder().encode(JSON.stringify(packet)).length,
      });
      service.dispose();
    }
    const unsupported = files.filter((f) => /\.hlptrl$/i.test(f));
    for (const name of unsupported)
      expect(classifyFile(name)).toBe("unsupported");
    // Optional local-only evidence; no recordings or paths enter tracked assets.
    if (process.env.APEX_EVIDENCE) {
      mkdirSync(process.env.APEX_EVIDENCE, { recursive: true });
      writeFileSync(
        join(process.env.APEX_EVIDENCE, "stage1-recordings.json"),
        JSON.stringify({ sessions: report, unsupported }, null, 2),
      );
    }
  }, 120000);
});
