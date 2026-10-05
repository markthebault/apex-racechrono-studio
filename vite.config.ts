import { defineConfig } from "vite";
import { readFileSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
import react from "@vitejs/plugin-react";
// Private, development-only fixture access. Never included in a production build.
import { readFile, writeFile } from "node:fs/promises";
// Local settings live in .env.local, which is not committed:
//   APEX_ALLOWED_HOSTS=my-host.my-tailnet.ts.net   comma separated, for the dev server
//   APEX_LOCAL_SESSIONS=/path/a.rcz,/path/b.rcz    served to the dev-only import shortcut
//   APEX_FIXTURES=/path/to/folder                  real recordings for the extra tests
export default defineConfig(() => {
  // .env may hold unrelated server credentials. Read only the explicit local
  // app configuration; never load generic .env files into a browser build.
  const configured = {
    ...(existsSync(".env.local")
      ? parseEnv(readFileSync(".env.local", "utf8"))
      : {}),
    ...process.env,
  };
  const env = Object.fromEntries(
    Object.entries(configured).filter(([key]) => key.startsWith("APEX_")),
  );
  const browserKeys = ["VITE_GOOGLE_CLIENT_ID", "VITE_GOOGLE_PICKER_API_KEY"];
  const define = Object.fromEntries(
    browserKeys.map((key) => [
      "import.meta.env." + key,
      JSON.stringify(configured[key] || ""),
    ]),
  );
  const localSessions = (env.APEX_LOCAL_SESSIONS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return {
    envDir: false,
    define,
    test: { env },
    server: {
      allowedHosts: (env.APEX_ALLOWED_HOSTS || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    },
    plugins: [
      react(),
      {
        name: "offline-shell",
        async writeBundle(options, bundle) {
          const assets = [
            "/",
            "/index.html",
            "/tracks.json",
            "/favicon.svg",
            "/logo.svg",
            "/fonts/inter-latin.woff2",
            ...Object.keys(bundle).map((p) => "/" + p),
          ];
          // The catalog is part of the version, so a new one replaces cached venue files.
          const catalog = JSON.parse(
            await readFile("public/tracks.json", "utf8"),
          ).generated;
          const version =
            "apex-" +
            Object.keys(bundle)
              .filter((p) => p.endsWith(".js"))
              .join("-") +
            "-" +
            catalog;
          await writeFile(
            (options.dir || "dist") + "/sw.js",
            `const CACHE=${JSON.stringify(version)};const ASSETS=${JSON.stringify(assets)};self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('apex-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.origin!==location.origin||e.request.method!=='GET')return;if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match('/index.html')));return;}if(ASSETS.includes(u.pathname))e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request)));else if(u.pathname.startsWith('/venues/'))e.respondWith(caches.open(CACHE).then(c=>c.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{if(r.ok)c.put(e.request,r.clone());return r;}))));});`,
          );
        },
      },
      {
        name: "private-fixtures",
        configureServer(server) {
          server.middlewares.use("/__private/video", async (_req, res) => {
            try {
              res.setHeader("Content-Type", "video/mp4");
              res.end(await readFile(".private/sync-test.mp4"));
            } catch {
              res.statusCode = 404;
              res.end();
            }
          });
          server.middlewares.use(
            "/__private/session/",
            async (req, res, next) => {
              const i = Number(req.url?.slice(1));
              if (!Number.isInteger(i) || i < 0 || i >= localSessions.length) {
                res.statusCode = 404;
                res.end();
                return;
              }
              try {
                res.setHeader("Content-Type", "application/octet-stream");
                res.end(await readFile(localSessions[i]));
              } catch {
                res.statusCode = 404;
                res.end();
              }
            },
          );
        },
      },
    ],
  };
});
