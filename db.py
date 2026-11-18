import json
import os
import sqlite3

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DELIVERY_DB", os.path.join(BASE_DIR, "delivery.db"))
SEED_PATH = os.path.join(BASE_DIR, "seed.json")

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Ongoing',
    delivery_manager TEXT DEFAULT '',
    customer TEXT DEFAULT '',
    end_customer TEXT DEFAULT '',
    delivery_type TEXT DEFAULT '',
    equipment TEXT DEFAULT '',
    modules_count INTEGER DEFAULT 1,
    module_type TEXT DEFAULT '',
    regulatory TEXT DEFAULT '',
    grid_codes TEXT DEFAULT '',
    contract_date TEXT DEFAULT '',
    first_delivery_date TEXT DEFAULT '',
    last_delivery_date TEXT DEFAULT '',
    shipyard TEXT DEFAULT '',
    shipyard_country TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS wbs_standard (
    code TEXT PRIMARY KEY,
    item_type TEXT NOT NULL,
    name TEXT NOT NULL,
    parent_code TEXT DEFAULT '',
    doc_ref TEXT DEFAULT '',
    owner TEXT DEFAULT '',
    pos INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS wbs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    code TEXT NOT NULL,
    item_type TEXT NOT NULL,
    name TEXT NOT NULL,
    parent_code TEXT DEFAULT '',
    doc_ref TEXT DEFAULT '',
    owner TEXT DEFAULT '',
    planned_date TEXT DEFAULT '',
    actual_date TEXT DEFAULT '',
    status TEXT DEFAULT 'Not started',
    pos INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS timeline_standard (
    milestone_no INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    week_offset INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS timeline (
    project_id INTEGER NOT NULL,
    milestone_no INTEGER NOT NULL,
    name TEXT NOT NULL,
    week_offset INTEGER NOT NULL,
    due_date TEXT DEFAULT '',
    done INTEGER DEFAULT 0,
    PRIMARY KEY (project_id, milestone_no)
);
CREATE TABLE IF NOT EXISTS opl (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    number INTEGER NOT NULL,
    status TEXT DEFAULT 'Open',
    description TEXT DEFAULT '',
    assignee TEXT DEFAULT '',
    start_date TEXT DEFAULT '',
    due_date TEXT DEFAULT '',
    priority TEXT DEFAULT 'Mid',
    blocker TEXT DEFAULT 'No',
    blocker_description TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS budget (
    project_id INTEGER PRIMARY KEY,
    sales_price REAL DEFAULT 0,
    services_price REAL DEFAULT 0,
    cogs_module REAL DEFAULT 0,
    service_costs REAL DEFAULT 0,
    direct_material REAL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS payment_milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    label TEXT DEFAULT '',
    pct REAL DEFAULT 0,
    week INTEGER DEFAULT 0,
    paid INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cash_out (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    week INTEGER NOT NULL,
    label TEXT DEFAULT '',
    cost REAL DEFAULT 0,
    pct_of_dm REAL,
    pct_of_sales REAL,
    mode TEXT DEFAULT 'fixed',
    planned REAL DEFAULT 0,
    forecast REAL DEFAULT 0,
    actual REAL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS budget_deviations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    description TEXT DEFAULT '',
    amount REAL DEFAULT 0,
    status TEXT DEFAULT 'Request',
    billable TEXT DEFAULT 'No',
    ref_link TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS doc_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phase TEXT DEFAULT '',
    consolidated TEXT DEFAULT '',
    code TEXT DEFAULT '',
    description TEXT DEFAULT '',
    seq TEXT DEFAULT '',
    doc_name TEXT DEFAULT '',
    template TEXT DEFAULT '',
    sample TEXT DEFAULT '',
    owner TEXT DEFAULT '',
    reviewer TEXT DEFAULT '',
    approver TEXT DEFAULT '',
    rina TEXT DEFAULT '',
    abs TEXT DEFAULT '',
    customer TEXT DEFAULT '',
    internal TEXT DEFAULT '',
    hard_copies TEXT DEFAULT '',
    gate1 TEXT DEFAULT '',
    gate2 TEXT DEFAULT '',
    gate3 TEXT DEFAULT '',
    gate4 TEXT DEFAULT '',
    gate5 TEXT DEFAULT '',
    comment TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS project_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    template_id INTEGER NOT NULL,
    status TEXT DEFAULT 'Missing',
    link TEXT DEFAULT '',
    comment TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    company TEXT DEFAULT '',
    first_name TEXT DEFAULT '',
    last_name TEXT DEFAULT '',
    role TEXT DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    language TEXT DEFAULT '',
    contact_way TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS library_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    uploaded_by TEXT DEFAULT '',
    uploaded_at TEXT DEFAULT (datetime('now')),
    size INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS lazydog_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT DEFAULT '',
    description TEXT DEFAULT '',
    location TEXT DEFAULT '',
    link TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    entity TEXT DEFAULT '',
    entity_id TEXT DEFAULT '',
    action TEXT DEFAULT '',
    detail TEXT DEFAULT '',
    changed_by TEXT DEFAULT '',
    changed_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS wiki_chapters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    source_file_id INTEGER,
    content TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS class_checklist_standard (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stage INTEGER NOT NULL,
    title TEXT NOT NULL,
    timing TEXT DEFAULT '',
    owner TEXT DEFAULT '',
    touchpoint TEXT DEFAULT '',
    exit_criteria TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS project_class_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    stage INTEGER NOT NULL,
    title TEXT NOT NULL,
    timing TEXT DEFAULT '',
    owner TEXT DEFAULT '',
    touchpoint TEXT DEFAULT '',
    exit_criteria TEXT DEFAULT '',
    status TEXT DEFAULT 'Not started',
    comment TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_class_project ON project_class_items(project_id);
CREATE INDEX IF NOT EXISTS idx_wbs_project ON wbs(project_id);
CREATE INDEX IF NOT EXISTS idx_opl_project ON opl(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_project ON audit(project_id);
"""


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript(SCHEMA)
    conn.execute("INSERT OR IGNORE INTO meta(key, value) VALUES ('rev', '0')")
    with open(SEED_PATH, encoding="utf-8") as f:
        seed = json.load(f)
    if conn.execute("SELECT COUNT(*) FROM wbs_standard").fetchone()[0] == 0:
        for i, w in enumerate(seed["wbs_standard"]):
            conn.execute(
                "INSERT INTO wbs_standard(code, item_type, name, parent_code, doc_ref, owner, pos)"
                " VALUES (?,?,?,?,?,?,?)",
                (w["code"], w["type"], w["name"], w["parent"], w["doc_ref"], w["owner"], i))
    if conn.execute("SELECT COUNT(*) FROM timeline_standard").fetchone()[0] == 0:
        for t in seed["timeline"]:
            conn.execute("INSERT INTO timeline_standard(milestone_no, name, week_offset) VALUES (?,?,?)",
                         (t["num"], t["name"], t["week"]))
    if conn.execute("SELECT COUNT(*) FROM doc_templates").fetchone()[0] == 0:
        cols = ["phase", "consolidated", "code", "description", "seq", "doc_name", "template",
                "sample", "owner", "reviewer", "approver", "rina", "abs", "customer", "internal",
                "hard_copies", "gate1", "gate2", "gate3", "gate4", "gate5", "comment"]
        for d in seed["document_templates"]:
            conn.execute(
                "INSERT INTO doc_templates(" + ",".join(cols) + ") VALUES (" +
                ",".join("?" * len(cols)) + ")",
                [d.get(c, "") for c in cols])
    if conn.execute("SELECT COUNT(*) FROM lazydog_links").fetchone()[0] == 0:
        seeds = [
            ("Project Charter template", "Standard charter used at project kick-off",
             "Library", "Library: upload 'Template - Project Charter'"),
            ("Delivery Project Master Document", "Master document list for delivery projects",
             "Library", "Library: upload 'Delivery Project Master Document'"),
            ("Startup Checklist", "Checklist used at start-up & verification",
             "Library", "Library: upload 'Startup Checklist'"),
            ("FAT procedure template", "Factory Acceptance Test procedure and protocol",
             "Library", "Library: upload 'FAT Procedure'"),
        ]
        conn.executemany(
            "INSERT INTO lazydog_links(name, description, location, link) VALUES (?,?,?,?)", seeds)
    if conn.execute("SELECT COUNT(*) FROM class_checklist_standard").fetchone()[0] == 0:
        stages = [
            (1, "Contract award / kick-off", "Within 10 working days of award", "Delivery PM",
             "Confirm society, office, rule edition, notation, essential-service status, PED position",
             "Society, edition and PED position written and acknowledged by the yard; every component has a CL, piping class and PED category"),
            (2, "Design and drawing approval", "Submit >= 12 weeks before first fabrication hold point", "Engineering",
             "PDA or drawing submission; written replies to every comment",
             "Approval letter or PDA received; every comment closed in writing; approval log updated"),
            (3, "Procurement", "PO issued with design; certificates ordered with the part", "Procurement",
             "Flow-down of class requirements to suppliers",
             "Every PO line in Annex A carries society, CL, material certificate and H/W points; each supplier has confirmed acceptance in writing"),
            (4, "Fabrication and in-process inspection", "Surveyor notified >= 10 working days before each H point (>= 15 abroad)", "Quality",
             "Surveyor attends H points: material ID and testing, welding, NDT, hydrotest on Class I/II and CL5 items",
             "Every H point released in writing; NDT and hydrotest accepted; nonconformances closed or concession approved"),
            (5, "FAT", "Procedure to class >= 20 working days before; surveyor booked >= 15 working days before", "Delivery PM",
             "Surveyor witnesses CL5 items and the unit FAT, incl. CBS fault simulation where Cat II/III",
             "Surveyor report signed; class punch items assigned with dates; no open H point"),
            (6, "Pre-shipment documentation", "Dossier complete >= 10 working days before dispatch", "Quality",
             "Class review of dossier where required",
             "Dossier passes the certificate acceptance checklist (C-5) for 100% of Annex A lines; no missing certificate"),
            (7, "Installation and onboard survey", "Notify yard of HP300 survey points at installation planning", "Delivery PM with yard",
             "Surveyor verifies installed IDs and serials against the dossier",
             "Serials match the dossier; deviations approved by class; surveyor, office and date recorded"),
            (8, "Commissioning and sea trial", "Commissioning procedure to class >= 15 working days before", "Delivery PM",
             "Function test of safety systems (relief valves, gas detection, shutdowns); CBS integration tests; performance at sea trial",
             "All safety functions tested and witnessed; findings answered in writing"),
            (9, "Final certification / close-out", "Within 20 working days of sea trial", "Delivery PM",
             "Class issues unit certificate / survey report; open conditions closed",
             "No open class condition, or each open condition has an owner, a date and the owner/yard informed"),
        ]
        conn.executemany(
            "INSERT INTO class_checklist_standard(stage, title, timing, owner, touchpoint, exit_criteria)"
            " VALUES (?,?,?,?,?,?)", stages)
    conn.commit()
    migrate(conn)
    sync_standards(conn)
    conn.close()


def sync_standards(conn):
    """Merge the standards from seed.json into the standard tables and into
    every existing project WITHOUT losing entered project data: rows are
    matched by (type, name), standard fields (code/parent/doc_ref) are
    refreshed, and user-entered fields (status, dates, owner, comments) are
    kept. Nothing is ever deleted from project tables."""
    try:
        with open(SEED_PATH, encoding="utf-8") as f:
            seed = json.load(f)
    except (OSError, ValueError):
        return
    wbs_std = seed.get("wbs_standard", [])
    tl_std = seed.get("timeline", [])
    docs_std = seed.get("document_templates", [])

    for i, w in enumerate(wbs_std):
        conn.execute(
            "INSERT INTO wbs_standard(code, item_type, name, parent_code, doc_ref, owner, pos)"
            " VALUES (?,?,?,?,?,?,?)"
            " ON CONFLICT(code) DO UPDATE SET item_type=excluded.item_type, name=excluded.name,"
            " parent_code=excluded.parent_code, doc_ref=excluded.doc_ref, owner=excluded.owner, pos=excluded.pos",
            (w["code"], w["type"], w["name"], w["parent"], w["doc_ref"], w["owner"], i))

    for t in tl_std:
        conn.execute(
            "INSERT INTO timeline_standard(milestone_no, name, week_offset) VALUES (?,?,?)"
            " ON CONFLICT(milestone_no) DO UPDATE SET name=excluded.name, week_offset=excluded.week_offset",
            (t["num"], t["name"], t["week"]))

    doc_cols = ["phase", "consolidated", "code", "description", "seq", "doc_name", "template",
                "sample", "owner", "reviewer", "approver", "rina", "abs", "customer", "internal",
                "hard_copies", "gate1", "gate2", "gate3", "gate4", "gate5", "comment"]
    template_ids = {}
    for d in docs_std:
        key = d.get("consolidated") or d.get("doc_name") or ""
        row = conn.execute(
            "SELECT id FROM doc_templates WHERE consolidated = ? OR (consolidated = '' AND doc_name = ?)",
            (key, key)).fetchone()
        if row:
            conn.execute(
                "UPDATE doc_templates SET " + ",".join(f"{c}=?" for c in doc_cols) + " WHERE id=?",
                [d.get(c, "") for c in doc_cols] + [row[0]])
            template_ids[key] = row[0]
        else:
            cur = conn.execute(
                "INSERT INTO doc_templates(" + ",".join(doc_cols) + ") VALUES (" +
                ",".join("?" * len(doc_cols)) + ")",
                [d.get(c, "") for c in doc_cols])
            template_ids[key] = cur.lastrowid

    # merge WBS into every project
    std_by_name = {(w["type"], w["name"]): w for w in wbs_std}
    for p in conn.execute("SELECT id FROM projects").fetchall():
        pid = p["id"]
        existing = conn.execute(
            "SELECT id, item_type, name, owner, code, doc_ref FROM wbs WHERE project_id = ?",
            (pid,)).fetchall()
        matched = set()
        for row in existing:
            std = std_by_name.get((row["item_type"], row["name"]))
            if std:
                matched.add((std["type"], std["name"]))
                # refresh structural fields; keep status/dates and any user-entered owner/doc_ref
                conn.execute("UPDATE wbs SET code=?, parent_code=? WHERE id=?",
                             (std["code"], std["parent"], row["id"]))
                if not row["doc_ref"]:
                    conn.execute("UPDATE wbs SET doc_ref=? WHERE id=?", (std["doc_ref"], row["id"]))
                if not row["owner"]:
                    conn.execute("UPDATE wbs SET owner=? WHERE id=?", (std["owner"], row["id"]))
        pos = conn.execute("SELECT COALESCE(MAX(pos), -1) FROM wbs WHERE project_id = ?",
                           (pid,)).fetchone()[0]
        for w in wbs_std:
            if (w["type"], w["name"]) not in matched:
                pos += 1
                conn.execute(
                    "INSERT INTO wbs(project_id, code, item_type, name, parent_code, doc_ref, owner, pos)"
                    " VALUES (?,?,?,?,?,?,?,?)",
                    (pid, w["code"], w["type"], w["name"], w["parent"], w["doc_ref"], w["owner"], pos))
        # re-order standard rows per the standard (phase -> milestones -> gate last),
        # custom user-added rows keep their relative order at the end
        order = {(w["type"], w["name"]): i for i, w in enumerate(wbs_std)}
        rows = conn.execute(
            "SELECT id, item_type, name FROM wbs WHERE project_id = ? ORDER BY pos", (pid,)).fetchall()
        std_rows = sorted((r for r in rows if (r["item_type"], r["name"]) in order),
                          key=lambda r: order[(r["item_type"], r["name"])])
        custom_rows = [r for r in rows if (r["item_type"], r["name"]) not in order]
        for i, r in enumerate(std_rows):
            conn.execute("UPDATE wbs SET pos=? WHERE id=?", (i, r["id"]))
        for j, r in enumerate(custom_rows):
            conn.execute("UPDATE wbs SET pos=? WHERE id=?", (len(std_rows) + j, r["id"]))

        # merge timeline rows per project (keep manual due_date / done)
        for t in tl_std:
            row = conn.execute(
                "SELECT name, week_offset, due_date FROM timeline WHERE project_id=? AND milestone_no=?",
                (pid, t["num"])).fetchone()
            if row is None:
                conn.execute(
                    "INSERT INTO timeline(project_id, milestone_no, name, week_offset) VALUES (?,?,?,?)",
                    (pid, t["num"], t["name"], t["week"]))
            elif row["due_date"] == "":
                conn.execute(
                    "UPDATE timeline SET name=?, week_offset=? WHERE project_id=? AND milestone_no=?",
                    (t["name"], t["week"], pid, t["num"]))

        # add new document templates to the project
        have = {r[0] for r in conn.execute(
            "SELECT template_id FROM project_documents WHERE project_id = ?", (pid,)).fetchall()}
        for key, tid in template_ids.items():
            if tid not in have:
                conn.execute("INSERT INTO project_documents(project_id, template_id) VALUES (?,?)",
                             (pid, tid))
    conn.commit()


def migrate(conn):
    """Add columns introduced in later versions to existing databases."""
    def add_col(table, col, decl):
        cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
        if col not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")
    add_col("projects", "shipyard", "TEXT DEFAULT ''")
    add_col("projects", "shipyard_country", "TEXT DEFAULT ''")
    add_col("opl", "blocker_description", "TEXT DEFAULT ''")
    add_col("payment_milestones", "paid", "INTEGER DEFAULT 0")
    add_col("cash_out", "pct_of_sales", "REAL")
    add_col("cash_out", "mode", "TEXT DEFAULT 'fixed'")
    add_col("cash_out", "planned", "REAL DEFAULT 0")
    add_col("cash_out", "forecast", "REAL DEFAULT 0")
    add_col("cash_out", "actual", "REAL DEFAULT 0")
    conn.commit()
