import { expect, test } from "vitest";
import { agentSetupPrompt } from "./setupPrompt";
test("gives the agent a source and verified pairing flow without copying URL secrets", () => {
  const prompt = agentSetupPrompt(
    "https://example.test/apex/?secret=private#apex-agent=7318:private-token",
  );
  expect(prompt).toContain("https://example.test/apex/");
  expect(prompt).toContain("mcp/server.mjs");
  expect(prompt).toContain("apex_connection");
  expect(prompt).toContain("connected=true");
  expect(prompt).toContain("apex_state");
  expect(prompt).toContain("Keep that client/server process alive");
  expect(prompt).toContain("neither usable Apex MCP tools nor a local runtime");
  expect(prompt).not.toContain("private");
  expect(prompt).not.toContain("#apex-agent");
});
