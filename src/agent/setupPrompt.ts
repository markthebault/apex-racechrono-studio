export function agentSetupPrompt(appUrl: string) {
  const url = new URL(appUrl);
  const app = url.origin + url.pathname;
  return `Connect to my Apex workspace at ${app} and verify that you can read its current state through MCP.

Use existing Apex MCP tools if available. Otherwise use your local terminal/runtime tools to run the helper; do not ask me to manually install an MCP extension or edit my client's global MCP settings.

Public source: https://github.com/markthebault/apex-racechrono-studio
Server script: mcp/server.mjs
Direct script: https://raw.githubusercontent.com/markthebault/apex-racechrono-studio/main/mcp/server.mjs
Read package.json and docs/local-mcp.md for the runtime dependencies and protocol. The helper uses Node.js 22+ and MCP stdio. Use an existing checkout or a temporary working folder, provide its runtime dependencies there if needed, and run the server as a child of an MCP client. Keep that client/server process alive for this conversation; launching the stdio server alone in an abandoned terminal is not a connection. Set APEX_MCP_APP to ${app}. Do not expose the helper beyond loopback.

1. Call apex_connection on the running helper. Use its actual pairingUrl; never invent a pairing token or reuse one from a different process.
2. Open that link in my existing Apex browser profile on the same computer as the helper, preserving its local workspace. If you cannot control my browser, give me the link to click. Let me press Connect agent and approve browser device access. Navigation/import and video-frame sharing remain my optional choices.
3. Call apex_connection again and confirm connected=true, then call apex_state and apex_guide. Only report success after both the live connection and workspace read succeed. Summarize the visible tab, selected laps and turn/section if present. Do not start a coaching review unless I ask.
4. If waiting or refused, diagnose the live helper, browser permission and app origin; ask for a fresh pairing link after a helper restart. Do not bypass access controls.

If this chat has neither usable Apex MCP tools nor a local runtime, say exactly which capability is missing. A prompt alone cannot give a remote/chat-only client access to my computer. Do not claim you connected or changed settings that you cannot verify.`;
}
