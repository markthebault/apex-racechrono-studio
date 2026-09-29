import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
// Private, development-only fixture access. Never included in a production build.
import { readFile, writeFile } from "node:fs/promises";
// Local settings live in .env.local, which is not committed:
//   APEX_ALLOWED_HOSTS=my-host.my-tailnet.ts.net   comma separated, for the dev server
//   APEX_LOCAL_SESSIONS=/path/a.rcz,/path/b.rcz    served to the dev-only import shortcut
//   APEX_FIXTURES=/path/to/folder                  real recordings for the extra tests
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "APEX_");
  const localSessions = (env.APEX_LOCAL_SESSIONS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return {
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
            ...Object.keys(bundle).map((p) => "/" + p),
          ];
          const version =
            "apex-" +
            Object.keys(bundle)
              .filter((p) => p.endsWith(".js"))
              .join("-");
          await writeFile(
            (options.dir || "dist") + "/sw.js",
            `const CACHE=${JSON.stringify(version)};const ASSETS=${JSON.stringify(assets)};self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('apex-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.origin!==location.origin||e.request.method!=='GET')return;if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match('/index.html')));return;}if(ASSETS.includes(u.pathname))e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request)));});`,
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
