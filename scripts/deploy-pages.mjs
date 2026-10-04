import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Read local configuration as text; never execute credential files as shell code.
function envFile(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(
      /^\s*(?:export\s+)?([A-Z_][A-Z_0-9]*)\s*=\s*(.*?)\s*$/,
    );
    if (!m) continue;
    const quoted = m[2].match(/^(["'])(.*?)\1(?:\s*#.*)?$/);
    values[m[1]] = quoted ? quoted[2] : m[2].replace(/\s+#.*$/, "");
  }
  return values;
}
const env = {
  ...envFile(
    process.env.CLOUDFLARE_TOKEN_FILE || join(homedir(), ".env.cloudflare"),
  ),
  ...envFile(".env.pages"),
  ...process.env,
};
env.CLOUDFLARE_API_TOKEN ||= env.CLOUDFLARE_TOKEN;
if (
  !env.CLOUDFLARE_API_TOKEN ||
  !env.CLOUDFLARE_ACCOUNT_ID ||
  !env.CLOUDFLARE_PAGES_PROJECT
)
  throw Error(
    "Set Cloudflare account, Pages project and API token in your environment or untracked .env.pages.",
  );
for (const [command, args] of [
  ["npm", ["run", "build"]],
  [
    "npx",
    [
      "--yes",
      "wrangler@4.147.0",
      "pages",
      "deploy",
      "dist",
      "--project-name",
      env.CLOUDFLARE_PAGES_PROJECT,
      "--branch",
      "main",
      "--commit-dirty=true",
    ],
  ],
]) {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
if (env.APEX_PAGES_PUBLIC_URL) {
  const html = readFileSync("dist/index.html", "utf8"),
    asset = html.match(/src="([^" ]+\.js)"/)?.[1];
  if (!asset) throw Error("Cannot identify the deployed build.");
  let verified = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const response = await fetch(env.APEX_PAGES_PUBLIC_URL, {
        headers: { "Cache-Control": "no-cache" },
      });
      if (response.ok && (await response.text()).includes(asset)) {
        verified = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  if (!verified)
    throw Error(
      "Pages upload completed, but the public address did not serve this build. Check the domain setup.",
    );
  console.log("Public Pages build verified at " + env.APEX_PAGES_PUBLIC_URL);
}
