# Climeon Delivery Management Tool

Web app for delivery project management with a portfolio overview, built from the
requirements workbook (`OA8CJFf5-Tool Mistral.xlsx`).

## Run

```bash
pip install -r requirements.txt
python3 app.py          # serves http://127.0.0.1:5000
```

Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `DELIVERY_PORT` | `5000` | HTTP port |
| `DELIVERY_HOST` | `127.0.0.1` | Bind address (keep loopback unless you add authentication) |
| `DELIVERY_DB` | `./delivery.db` | SQLite database file (swap for a cloud DB later) |
| `LIBRARY_PASSWORD_HASH` | SHA-256 of the library password from the Data tab | Library upload/delete password (only the hash is stored in code) |
| `MISTRAL_API_KEY` | unset | Enables the ✨ AI summary (Portfolio + project Dashboard) via the Mistral API. Without it, a built-in rule-based summary is shown instead |
| `MISTRAL_MODEL` | `mistral-small-latest` | Model used for AI summaries |
| `MISTRAL_BASE_URL` | `https://api.mistral.ai/v1` | API base URL (override for proxies/local gateways) |

## Features (mapped to the workbook tabs)

- **Portfolio** — KPI cards (critical/blocked open points now vs. 14 days ago,
  reconstructed from the audit log), all projects (status, delivery manager, HP300
  count/version, first/last delivery dates, open points), a clickable list of all
  critical/blocked OPLs across projects, and a portfolio timeline highlighting every
  project's FAT (M9) and commissioning (M13) date.
- **Per project**: Dashboard, Master Data (incl. shipyard / shipyard country for
  Marine), WBS (collapsible phases & milestones, inline click-to-edit rows, "n/a"
  status, filter, new items default owner = delivery manager), Timeline (zoomable
  weekly Gantt; all modules share the timeline until M6, then diverge +4 weeks per
  module for M7–M14 with per-module sub-milestones; colors follow WBS status; click a
  milestone to reveal its activities; critical **or blocked** OPLs as clickable red
  diamonds), OPL (Blocker = Yes/No selection + separate blocker description; critical/
  blocked rows bold), Budget (planned/forecast/actual cost columns, paid flag on
  payment milestones, deviations list with status/billable/link, top summary cards,
  weekly cash-flow chart), Documents (filter; "n/a" items in a separate bottom table;
  code column far right), Contacts (sortable/filterable), Change Log (filterable).
- **Tool level**: Library (password-protected upload/delete). Every uploaded file
  automatically becomes a **wiki chapter** (text is extracted from .docx/.txt/.md),
  shown in the Wiki drawer. Files placed in `library-seed/` are auto-imported into
  the Library + wiki on first start — the classification/PED working standard ships
  there.
- **Class checklist**: projects with delivery type **Marine** or **Retrofit** get a
  "Class" tab with the 9-stage class/PED certification checklist (from the working
  standard, Section 6), each stage with timing, owner, class touchpoint, exit criteria,
  status and comment.
- **Data rules**: all text input is sanitized so the forbidden company word is
  automatically replaced with "Process Media"; multi-user via a global revision
  counter — every client polls `/api/rev` and refreshes when another user changes
  data; every change is written to the audit log.

## Files

- `app.py` — Flask server + REST API
- `db.py` — SQLite schema and seed loading
- `seed.json` — standards extracted from the requirements workbook (WBS parsed
  from the flat v3 layout: every row carries phase/gate/milestone/activity, so
  codes are exactly `a.b.c.d`)
- `gen_seed.py` — regenerates `seed.json` from the workbook
  (`python3 gen_seed.py path/to/workbook.xlsx`)
- On every start, `sync_standards()` merges the current `seed.json` into the
  standard tables and into all existing projects **without losing entered data**:
  rows are matched by type+name, structural fields (code/parent/doc ref) are
  refreshed, and user-entered fields (status, dates, owner, comments) are kept;
  nothing is ever deleted from project tables. Existing databases are migrated
  automatically (new columns/tables only).
- **Backup**: Library page → "⬇ Backup database" downloads the whole
  `delivery.db` (or `GET /api/backup`). `delivery.db` is the only file with your
  data — it is git-ignored, so back it up regularly.
- `static/` — single-page frontend (index.html, app.js, style.css)
- `uploads/` — library files (runtime)
- `library-seed/` — files auto-imported into the Library + wiki on first start

## Design notes

- Roboto Condensed Light (Google Fonts), dark navy + green accent, Climeon-style.
- The official white Climeon logo is included at `static/img/logo.png` and shown in
  the top bar on the dark navy background.
- Faded customer photos: drop them into `static/img/bg.jpg` (used at low opacity as
  the page background).

## AI assistant

- Portfolio page and project Dashboard have an **✨ AI summary** button. It gathers
  the relevant data server-side (projects, critical/blocked OPLs, milestones, WBS
  progress, budget, class checklist) and asks Mistral for a markdown report with
  analytics, critical items and suggested actions (`POST /api/ai/summary`).
- Set `MISTRAL_API_KEY` on the machine running the app to enable Mistral AI.
  Without a key, the endpoint returns a rule-based local summary instead.
- The key is only read from the environment and never stored or logged.

## Run as an independent web app / embed in another app

- The app is a self-contained web application: Flask serves both the UI and a plain
  JSON REST API. To run it on a server for several users:
  `DELIVERY_HOST=0.0.0.0 DELIVERY_PORT=5000 python3 app.py` — put it behind a
  reverse proxy (nginx/Caddy) with HTTPS and authentication (SSO/basic auth).
  `DELIVERY_DB` can point at a shared location (or migrate to PostgreSQL later);
  the AI summaries work unchanged via `MISTRAL_API_KEY` on the server.
- To embed in another web app: call the REST endpoints directly, e.g.
  `POST /api/ai/summary {"question": "..."}` returns `{ai, text}` markdown, and
  `GET /api/projects` returns the portfolio JSON. All endpoints speak JSON and take
  an `X-User-Name` header for the change log.
