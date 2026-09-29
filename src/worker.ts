import { createSHA256 } from "hash-wasm";
import { decode } from "./decoder";
import { fingerprintOf } from "./fingerprint";
import { trace, align, optimal } from "./analysis";
self.onmessage = async ({ data }) => {
  try {
    if (data.kind === "analysis") {
      const raw = data.sessions.flatMap((s: any) =>
        s.laps.map((l: any) => trace(s, l)),
      );
      const ref =
        raw.find((t: any) => t.id === data.reference) ||
        raw.find((t: any) => !t.issues.length);
      const traces = ref ? raw.map((t: any) => align(t, ref)) : [];
      self.postMessage({
        result: {
          traces,
          sectors: optimal(
            traces.filter((t: any) => data.ids.includes(t.id)),
            data.gates,
          ),
        },
      });
      return;
    }
    if (data.kind === "fingerprint") {
      self.postMessage({ result: await fingerprintOf(data.file) });
      return;
    }
    const file: File = data.file;
    const hash = await createSHA256();
    hash.init();
    for (let offset = 0; offset < file.size; offset += 4 * 1024 * 1024) {
      hash.update(
        new Uint8Array(
          await file.slice(offset, offset + 4 * 1024 * 1024).arrayBuffer(),
        ),
      );
      self.postMessage({
        progress: Math.min(1, (offset + 4 * 1024 * 1024) / file.size),
      });
    }
    const id = hash.digest("hex");
    self.postMessage({
      result:
        data.kind === "decode"
          ? decode(new Uint8Array(await file.arrayBuffer()), file.name, id)
          : { sha256: id, name: file.name, size: file.size },
    });
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
};
