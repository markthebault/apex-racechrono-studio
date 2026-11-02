import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
// Opt in to a real network install; use a commit/tag to test a proposed release.
const spec = process.env.APEX_MCP_PACKAGE;
if (!spec) {
  console.log(
    "SKIP: set APEX_MCP_PACKAGE to the public GitHub package reference",
  );
  process.exit(0);
}
const client = new Client({ name: "apex-install-regression", version: "1" });
const port = process.env.APEX_MCP_PORT || "17320";
const transport = new StdioClientTransport({
  command: "npm",
  args: ["exec", "--yes", `--package=${spec}`, "--", "apex-mcp"],
  env: { ...process.env, APEX_MCP_PORT: port },
  stderr: "pipe",
});
try {
  const ready = client.connect(transport, { timeout: 180000 });
  transport.stderr?.on("data", (data) => process.stderr.write(data));
  await ready;
  const result = await client.callTool({
    name: "apex_connection",
    arguments: {},
  });
  assert(!result.isError);
  const connection = JSON.parse(result.content[0].text);
  assert.equal(connection.connected, false);
  assert(
    new URL(connection.pairingUrl).hash.startsWith(`#apex-agent=${port}:`),
  );
  console.log(
    "Public package install, executable startup, MCP handshake and pairing tool: PASS",
  );
} finally {
  await client.close();
}
