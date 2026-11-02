# Hockenheimring demo recordings

These four RaceChrono sessions were explicitly supplied and approved by the maintainer for reuse and Git version control. They are an exception to the default rule against storing recordings in the repository. Keep them outside `public/` and `dist/`; do not deploy them as website assets.

Import the `.rcz` files through Apex or `apex_import_session`. To run the browser/MCP regression, set `APEX_FIXTURES` to this folder and run `npm run test:mcp` with the dev server running. Tests skip without a configured fixture folder.

No onboard video accompanies these demos. Visual racing-line assessment requires separately linked and synchronized video. Imported vehicle, tire, setup and conditions context is unverified; do not infer those from recording times.
