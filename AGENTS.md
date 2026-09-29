# Agent instructions

## Keep a local deployment up to date

If the maintainer runs a persistent copy of the app (see the README section on the HTTPS service), keep it current. After every change to the app, and before reporting the work as finished:

1. Run `npm test`.
2. Run `npm run deploy`. It builds, publishes `dist/` to the runtime folder, restarts the LaunchAgent and checks that the configured public address serves the new build. It reads `APEX_PUBLIC_URL` from the environment or an untracked `.env.deploy`.
3. Say in the final message that the service was updated, and give the address.

If the deploy check fails, fix it or report the failure. Do not leave the service on an older build without saying so. If no `.env.deploy` exists, the maintainer has no local service and this step does not apply.

## Rules

- Only `dist/` is published. Never put RaceChrono files, videos or other private fixtures in `public/`, `dist/` or the repository. The `/__private/` routes exist only in the Vite dev server.
- Local paths, hostnames and recordings belong in untracked files: `.env.local`, `.env.deploy`, `.private/`, `evidence/`. Do not write them into tracked files, tests, documentation or commit messages.
- Ports 5173 (Tailscale HTTPS) and 5180 (loopback Node server) belong to the service. Run the dev server with `npm run dev -- --port 5174`.
- Tests that read real recordings take them from `APEX_FIXTURES` and skip themselves if the files are missing.
- Any theoretical-lap figure must be quoted with its sector count.
- All laps feed the optimal lap, including red-flag and GPS-outage laps. Only sectors that overlap a GPS gap over 2 seconds are skipped.
