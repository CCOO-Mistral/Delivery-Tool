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

## Features (mapped to the workbook tabs)

- **Portfolio** — all projects with status, delivery manager, number of HP300 units,
  HP300 version, first/last delivery dates, open-point counts, and an "Enter" button
  into each project dashboard.
- **Per project**: Dashboard (status, open/blocked open points, upcoming milestones),
  Master Data, WBS (phases → gates → milestones → activities, `a.b.c.d` codes,
  seeded from the workbook, editable), Timeline (zoomable weekly Gantt, due dates
  computed from contract date + week offsets, +4 weeks per extra module up to M14,
  critical OPLs as clickable red diamonds at their due date), OPL (auto-numbered,
  calculated duration, status/priority selections), Budget (EUR cash-flow chart:
  payment milestones in, COGS out, cumulative line), Documents (checklist seeded
  from the workbook's document list; new master documents are added to all projects),
  Contacts (sortable/filterable), Change Log (audit trail per project).
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
- `seed.json` — standards extracted from the requirements workbook
- `gen_seed.py` — regenerates `seed.json` from the workbook
  (`python3 gen_seed.py path/to/workbook.xlsx`)
- `static/` — single-page frontend (index.html, app.js, style.css)
- `uploads/` — library files (runtime)
- `library-seed/` — files auto-imported into the Library + wiki on first start

## Design notes

- Roboto Condensed Light (Google Fonts), dark navy + green accent, Climeon-style.
- The official white Climeon logo is included at `static/img/logo.png` and shown in
  the top bar on the dark navy background.
- Faded customer photos: drop them into `static/img/bg.jpg` (used at low opacity as
  the page background).

## Deployment note

The app binds to `127.0.0.1` by default. For real multi-user use, deploy behind
HTTPS with authentication (e.g. a reverse proxy with SSO) and point `DELIVERY_DB`
at a shared/cloud database.
