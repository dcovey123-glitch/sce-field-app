# SCE Field App

Desktop field-management app (Electron + React + Vite) for SCE Electric Western Canada,
plus the phone app and sync server that runs on Cloudflare (`GrabWorker/`).

## Everyday commands (in `D:\Desktopapp`)

| Command | What it does |
| --- | --- |
| `npm install` | Install packages (first time, or after package.json changes) |
| `npm run dist` | Build the Windows installer into `release/` |
| `npm test` | Run the checks on the money maths and other logic |
| `npm run lint` | Look for code mistakes |
| `cd GrabWorker` then `npx wrangler deploy` | Publish the phone app / sync server |

## What lives where

- `src/pages` — screens (Jobs, Quotes, Materials, Timesheets…)
- `src/components` — shared pieces (Needs you, Stock count, Proposal pill…)
- `src/api` — logic with no screen (billing, slips, purchases, job health, Alberta Time…)
- `electron` — the desktop shell (files, windows, email drafts)
- `GrabWorker/upload-worker.js` — phone app + sync server
- Data (jobs, quotes, files) is **not** in this repo — it lives in the data folder chosen in the app.

Secrets (Anthropic key, upload password) are never stored in this repo: the app keeps them on the PC,
and the server's are set with `npx wrangler secret put`.
