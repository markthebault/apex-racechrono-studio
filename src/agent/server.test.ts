import { expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { WebSocket } from "ws";

test("local helper requires origin and token, allows one tab and returns MCP images", async () => {
  const client = new Client({ name: "transport-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["mcp/server.mjs"],
    env: {
      ...process.env,
      APEX_MCP_PORT: "17319",
      APEX_MCP_APP: "http://localhost:5174/",
    },
    stderr: "pipe",
  });
  const sockets: WebSocket[] = [];
  const open = (origin: string) => {
    const ws = new WebSocket("ws://127.0.0.1:17319", { origin });
    sockets.push(ws);
    return ws;
  };
  try {
    await client.connect(transport);
    const response = await client.callTool({
      name: "apex_connection",
      arguments: {},
    });
    const info = JSON.parse((response.content as { text: string }[])[0].text);
    const token = new URL(info.pairingUrl).hash.split(":").at(-1);
    const evil = open("https://untrusted.invalid");
    await new Promise<void>((resolve) => evil.on("error", () => resolve()));
    const bad = open("http://localhost:5174");
    bad.on("open", () =>
      bad.send(JSON.stringify({ token: "wrong", tools: [] })),
    );
    expect(
      await new Promise((resolve) => bad.on("close", (code) => resolve(code))),
    ).toBe(4001);
    const good = open("http://localhost:5174");
    good.on("open", () =>
      good.send(
        JSON.stringify({
          token,
          tools: [
            {
              name: "apex_video_frames",
              description: "test",
              inputSchema: { type: "object" },
            },
          ],
        }),
      ),
    );
    await new Promise<void>((resolve) => good.once("message", () => resolve()));
    const second = open("http://localhost:5174");
    second.on("open", () => second.send(JSON.stringify({ token, tools: [] })));
    expect(
      await new Promise((resolve) =>
        second.on("close", (code) => resolve(code)),
      ),
    ).toBe(4001);
    good.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      good.send(
        JSON.stringify({
          id: m.id,
          result: { frames: [{ lapSeconds: 1, data: "dGVzdA==" }] },
        }),
      );
    });
    const images = await client.callTool({
      name: "apex_video_frames",
      arguments: {},
    });
    expect(images.isError).not.toBe(true);
    expect(images.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "image",
          mimeType: "image/jpeg",
          data: "dGVzdA==",
        }),
      ]),
    );
    expect(
      (await client.callTool({ name: "unknown", arguments: {} })).isError,
    ).toBe(true);
  } finally {
    for (const ws of sockets) ws.terminate();
    await client.close();
  }
}, 15000);
