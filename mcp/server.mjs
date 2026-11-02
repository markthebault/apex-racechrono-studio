#!/usr/bin/env node
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { WebSocketServer } from "ws";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const port = Number(process.env.APEX_MCP_PORT || 7318);
const app = new URL(process.env.APEX_MCP_APP || "https://apex.mthracelab.com/");
const token = randomBytes(32).toString("hex");
const pairing = `${app.href.split("#")[0]}#apex-agent=${port}:${token}`;
const allowed = new Set([
  app.origin,
  ...(process.env.APEX_MCP_ORIGINS || "").split(",").filter(Boolean),
]);
let page,
  definitions = [],
  next = 0;
const pending = new Map();
const http = createServer((req, res) => {
  const origin = req.headers.origin;
  if (!origin || !allowed.has(origin)) {
    res.writeHead(403).end();
    return;
  }
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Cache-Control", "no-store");
  if (req.url !== "/apex-mcp") {
    res.writeHead(404).end();
    return;
  }
  res.end(JSON.stringify({ app: "apex-mcp", version: 1 }));
});
const sockets = new WebSocketServer({
  server: http,
  maxPayload: 12 * 1024 * 1024,
  verifyClient: ({ origin }, done) => done(allowed.has(origin), 403),
});
const drop = () => {
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(
      Error(
        "disconnected: action may have completed; read apex_state before retrying",
      ),
    );
  }
  pending.clear();
};
sockets.on("connection", (ws) => {
  let authenticated = false;
  const timer = setTimeout(() => ws.close(4001), 5000);
  ws.on("error", () => {});
  ws.on("message", (raw) => {
    try {
      const m = JSON.parse(raw.toString());
      if (!authenticated) {
        if (
          typeof m.token !== "string" ||
          m.token.length !== token.length ||
          !timingSafeEqual(Buffer.from(m.token), Buffer.from(token)) ||
          page ||
          !Array.isArray(m.tools)
        ) {
          ws.close(4001);
          return;
        }
        clearTimeout(timer);
        authenticated = true;
        page = ws;
        definitions = m.tools;
        ws.send(JSON.stringify({ welcome: true }));
        void server.sendToolListChanged().catch(() => {});
        return;
      }
      const p = pending.get(m.id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(m.id);
      if (m.error) p.reject(Error(m.error));
      else p.resolve(m.result);
    } catch {
      ws.close(1003);
    }
  });
  ws.on("close", () => {
    clearTimeout(timer);
    if (page === ws) {
      page = undefined;
      drop();
    }
  });
});
function ask(name, args) {
  if (!page)
    throw Error(
      "No paired Apex tab. Call apex_connection and open its pairing URL.",
    );
  const id = ++next;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error("timeout: read apex_state before retrying an action"));
    }, 120000);
    pending.set(id, { resolve, reject, timer });
    page.send(JSON.stringify({ id, name, args }));
  });
}
const connection = {
  name: "apex_connection",
  description:
    "Get pairing URL and connection status. Open URL in the browser, then explicitly connect in Apex.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
};
const importer = {
  name: "apex_import_session",
  description:
    "Import a local RaceChrono .rcz or Dragy .vbo recording into the paired Apex tab. Requires control permission in Apex.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
    additionalProperties: false,
  },
};
const server = new Server(
  { name: "apex", version: "0.1.0" },
  {
    capabilities: { tools: { listChanged: true } },
    instructions:
      "Begin with apex_connection, then apex_state. Read apex_guide before analysis. Use exact snapshot IDs. Video frames support visual hypotheses, not calibrated track-edge distances or proof of optimal lines. Do not blindly retry timed-out actions.",
  },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [connection, importer, ...definitions],
}));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    let result;
    if (params.name === "apex_connection")
      result = { connected: !!page, pairingUrl: pairing };
    else if (params.name === "apex_import_session") {
      const path = params.arguments?.path;
      if (typeof path !== "string" || !/\.(rcz|vbo)$/i.test(path))
        throw Error("Expected a .rcz or .vbo path");
      const bytes = await readFile(path);
      if (bytes.length > 8 * 1024 * 1024)
        throw Error(
          "Import limit is 8 MiB; import larger recordings through Apex",
        );
      result = await ask("apex_import_session", {
        name: basename(path),
        base64: bytes.toString("base64"),
      });
    } else {
      if (!definitions.some((d) => d.name === params.name))
        throw Error("Unknown tool");
      result = await ask(params.name, params.arguments || {});
    }
    if (result?.frames)
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ...result,
              frames: result.frames.map(({ data, ...meta }) => meta),
            }),
          },
          ...result.frames.map((f) => ({
            type: "image",
            mimeType: "image/jpeg",
            data: f.data,
          })),
        ],
      };
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: e.message }] };
  }
});
http.listen(port, "127.0.0.1", () =>
  process.stderr.write(`Apex MCP listening on loopback port ${port}\n`),
);
http.on("error", (e) => {
  process.stderr.write(`${e.message}\n`);
  process.exit(1);
});
await server.connect(new StdioServerTransport());
process.stdin.on("end", () => {
  drop();
  sockets.close();
  http.close();
  process.exit(0);
});
