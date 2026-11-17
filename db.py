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
    blocker TEXT DEFAULT '',
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
    week INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cash_out (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    week INTEGER NOT NULL,
    label TEXT DEFAULT '',
    cost REAL DEFAULT 0,
    pct_of_dm REAL
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
    conn.commit()
    conn.close()
