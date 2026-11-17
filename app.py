import hashlib
import hmac
import json
import os
import re
from datetime import date, datetime, timedelta

from flask import Flask, jsonify, request, send_from_directory, abort

import db

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Library upload/delete is password protected. Only the SHA-256 hash of the
# password is stored here (never the plaintext); override with the
# LIBRARY_PASSWORD_HASH environment variable to change it.
LIBRARY_PASSWORD_HASH = os.environ.get(
    "LIBRARY_PASSWORD_HASH",
    "5264b98a226ef88f597e666b5922d2128452457d3bede86e897931bb03e7b70a",
)

FORBIDDEN_WORD = "amolea"
REPLACEMENT = "Process Media"

app = Flask(__name__, static_folder="static", static_url_path="/static")

db.init_db()


# ---------------------------------------------------------------- helpers

def sanitize(obj):
    if isinstance(obj, str):
        return re.sub(FORBIDDEN_WORD, REPLACEMENT, obj, flags=re.IGNORECASE)
    if isinstance(obj, list):
        return [sanitize(x) for x in obj]
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    return obj


def body():
    data = request.get_json(force=True, silent=True) or {}
    return sanitize(data)


def user():
    return request.headers.get("X-User-Name", "anonymous")


def rows_to_dicts(rows):
    return [dict(r) for r in rows]


def bump_rev(conn):
    conn.execute("UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'rev'")


def audit(conn, project_id, entity, entity_id, action, detail=""):
    conn.execute(
        "INSERT INTO audit(project_id, entity, entity_id, action, detail, changed_by)"
        " VALUES (?,?,?,?,?,?)",
        (project_id, entity, str(entity_id), action, detail, user()))


def get_project_or_404(conn, pid):
    row = conn.execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone()
    if row is None:
        abort(404)
    return row


def check_library_password():
    supplied = request.headers.get("X-Library-Password", "")
    digest = hashlib.sha256(supplied.encode()).hexdigest()
    return hmac.compare_digest(digest, LIBRARY_PASSWORD_HASH)


def parse_date(s):
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def milestone_due_date(contract_date, week_offset, module_idx=0):
    base = parse_date(contract_date)
    if base is None:
        return ""
    return (base + timedelta(weeks=week_offset + 4 * module_idx)).isoformat()


def days_between(start, due):
    a, b = parse_date(start), parse_date(due)
    if a and b:
        return (b - a).days
    return None


# ---------------------------------------------------------------- static

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


# ---------------------------------------------------------------- global

@app.route("/api/rev")
def rev():
    conn = db.get_db()
    r = conn.execute("SELECT value FROM meta WHERE key = 'rev'").fetchone()
    conn.close()
    return jsonify({"rev": int(r["value"])})


@app.route("/api/log")
def global_log():
    conn = db.get_db()
    rows = conn.execute(
        "SELECT a.*, p.name AS project_name FROM audit a"
        " LEFT JOIN projects p ON p.id = a.project_id"
        " ORDER BY a.id DESC LIMIT 200").fetchall()
    conn.close()
    return jsonify(rows_to_dicts(rows))


@app.route("/api/wiki")
def wiki():
    conn = db.get_db()
    links = rows_to_dicts(conn.execute("SELECT * FROM lazydog_links ORDER BY id").fetchall())
    files = rows_to_dicts(conn.execute(
        "SELECT id, filename, uploaded_by, uploaded_at, size FROM library_files ORDER BY id DESC").fetchall())
    conn.close()
    content = {
        "gdpr": {
            "title": "GDPR Checklist",
            "items": [
                "Identify what personal data the project processes and why (data mapping).",
                "Confirm a lawful basis for each processing activity (consent, contract, legal obligation...).",
                "Minimise data: only collect what the project needs.",
                "Inform data subjects with a clear privacy notice.",
                "Set retention periods and delete data when no longer needed.",
                "Restrict access to personal data on a need-to-know basis.",
                "Use encryption and secure transfer for personal data (TLS, encrypted storage).",
                "Have Data Processing Agreements (DPA) with any sub-processor handling personal data.",
                "Handle data subject requests (access, erasure, rectification) within 30 days.",
                "Record breaches and notify the supervisory authority within 72 hours where required.",
            ],
        },
        "class_approvals": {
            "title": "Class Approvals",
            "items": [
                "Identify the class society for the project (ABS, RINA, Lloyd's, DNV...) from the contract.",
                "Prepare the Design Basis document and submit the Plan Approval Request early (gate 1).",
                "Track all class comments in the OPL and close them before the relevant gate.",
                "Schedule the ITP (Inspection & Test Plan) review with class before manufacturing.",
                "Book onsite surveys (FAT witness, installation, commissioning) at least 4 weeks ahead.",
                "Keep certificates for all class-relevant components in the Documents tab.",
            ],
        },
        "ce_approvals": {
            "title": "CE Approvals",
            "items": [
                "Identify applicable EU directives (Machinery Directive 2006/42/EC, EMC, LVD, PED as applicable).",
                "Perform and document the risk assessment (EN ISO 12100).",
                "Compile the Technical File: drawings, calculations, FMEA, test reports.",
                "Issue the Declaration of Conformity and affix the CE marking.",
                "Keep the Technical File for 10 years after last placing on the market.",
            ],
        },
    }
    return jsonify({"content": content, "lazydog": links, "library_files": files})


@app.route("/api/lazydog", methods=["POST"])
def lazydog_add():
    d = body()
    conn = db.get_db()
    cur = conn.execute(
        "INSERT INTO lazydog_links(name, description, location, link) VALUES (?,?,?,?)",
        (d.get("name", ""), d.get("description", ""), d.get("location", ""), d.get("link", "")))
    bump_rev(conn)
    audit(conn, None, "lazydog", cur.lastrowid, "create", d.get("name", ""))
    conn.commit()
    conn.close()
    return jsonify({"id": cur.lastrowid})


@app.route("/api/lazydog/<int:lid>", methods=["PUT", "DELETE"])
def lazydog_edit(lid):
    conn = db.get_db()
    if request.method == "DELETE":
        conn.execute("DELETE FROM lazydog_links WHERE id = ?", (lid,))
        audit(conn, None, "lazydog", lid, "delete")
    else:
        d = body()
        conn.execute("UPDATE lazydog_links SET name=?, description=?, location=?, link=? WHERE id=?",
                     (d.get("name", ""), d.get("description", ""), d.get("location", ""),
                      d.get("link", ""), lid))
        audit(conn, None, "lazydog", lid, "update", d.get("name", ""))
    bump_rev(conn)
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------------- library

@app.route("/api/library")
def library_list():
    conn = db.get_db()
    rows = conn.execute(
        "SELECT id, filename, uploaded_by, uploaded_at, size FROM library_files ORDER BY id DESC").fetchall()
    conn.close()
    return jsonify(rows_to_dicts(rows))


@app.route("/api/library/upload", methods=["POST"])
def library_upload():
    if not check_library_password():
        return jsonify({"error": "Invalid library password"}), 403
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "Empty filename"}), 400
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", os.path.basename(f.filename))
    stored = f"{datetime.now().strftime('%Y%m%d%H%M%S')}_{safe}"
    f.save(os.path.join(UPLOAD_DIR, stored))
    size = os.path.getsize(os.path.join(UPLOAD_DIR, stored))
    conn = db.get_db()
    cur = conn.execute(
        "INSERT INTO library_files(filename, stored_name, uploaded_by, size) VALUES (?,?,?,?)",
        (safe, stored, user(), size))
    bump_rev(conn)
    audit(conn, None, "library", cur.lastrowid, "upload", safe)
    conn.commit()
    conn.close()
    return jsonify({"id": cur.lastrowid, "filename": safe})


@app.route("/api/library/file/<int:fid>")
def library_download(fid):
    conn = db.get_db()
    row = conn.execute("SELECT * FROM library_files WHERE id = ?", (fid,)).fetchone()
    conn.close()
    if row is None:
        abort(404)
    return send_from_directory(UPLOAD_DIR, row["stored_name"], as_attachment=True,
                               download_name=row["filename"])


@app.route("/api/library/<int:fid>", methods=["DELETE"])
def library_delete(fid):
    if not check_library_password():
        return jsonify({"error": "Invalid library password"}), 403
    conn = db.get_db()
    row = conn.execute("SELECT * FROM library_files WHERE id = ?", (fid,)).fetchone()
    if row is None:
        conn.close()
        abort(404)
    try:
        os.remove(os.path.join(UPLOAD_DIR, row["stored_name"]))
    except OSError:
        pass
    conn.execute("DELETE FROM library_files WHERE id = ?", (fid,))
    bump_rev(conn)
    audit(conn, None, "library", fid, "delete", row["filename"])
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------------- projects / portfolio

PROJECT_FIELDS = ["name", "status", "delivery_manager", "customer", "end_customer",
                  "delivery_type", "equipment", "modules_count", "module_type", "regulatory",
                  "grid_codes", "contract_date", "first_delivery_date", "last_delivery_date"]


@app.route("/api/projects")
def list_projects():
    conn = db.get_db()
    rows = conn.execute(
        "SELECT p.*,"
        " (SELECT COUNT(*) FROM opl o WHERE o.project_id = p.id AND o.status != 'Closed') AS open_points,"
        " (SELECT COUNT(*) FROM opl o WHERE o.project_id = p.id AND o.status = 'Blocked') AS blocked_points"
        " FROM projects p ORDER BY p.id").fetchall()
    conn.close()
    return jsonify(rows_to_dicts(rows))


@app.route("/api/projects", methods=["POST"])
def create_project():
    d = body()
    conn = db.get_db()
    cols = PROJECT_FIELDS + ["created_by"]
    vals = [d.get(c, "") for c in PROJECT_FIELDS] + [user()]
    if not vals[0]:
        conn.close()
        return jsonify({"error": "Project name is required"}), 400
    try:
        vals[7] = int(d.get("modules_count") or 1)
    except (ValueError, TypeError):
        vals[7] = 1
    cur = conn.execute(
        "INSERT INTO projects(" + ",".join(cols) + ") VALUES (" + ",".join("?" * len(cols)) + ")",
        vals)
    pid = cur.lastrowid

    for i, w in enumerate(conn.execute(
            "SELECT * FROM wbs_standard ORDER BY pos").fetchall()):
        conn.execute(
            "INSERT INTO wbs(project_id, code, item_type, name, parent_code, doc_ref, owner, pos)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (pid, w["code"], w["item_type"], w["name"], w["parent_code"], w["doc_ref"], w["owner"], i))

    for t in conn.execute("SELECT * FROM timeline_standard ORDER BY milestone_no").fetchall():
        conn.execute(
            "INSERT INTO timeline(project_id, milestone_no, name, week_offset, due_date) VALUES (?,?,?,?,?)",
            (pid, t["milestone_no"], t["name"], t["week_offset"],
             milestone_due_date(d.get("contract_date", ""), t["week_offset"])))

    for t in conn.execute("SELECT id FROM doc_templates ORDER BY id").fetchall():
        conn.execute("INSERT INTO project_documents(project_id, template_id) VALUES (?,?)",
                     (pid, t["id"]))

    conn.execute(
        "INSERT INTO budget(project_id, sales_price, services_price, cogs_module, service_costs,"
        " direct_material) VALUES (?,?,?,?,?,?)",
        (pid, 0, 0, 0, 20000, 350000))
    defaults_out = [(6, "Direct material DP", 0, 20.0), (24, "Direct Material Total", 0, 10.0),
                    (28, "Direct Material Total", 0, 70.0), (9, "Production & FAT", 40000, None),
                    (11, "Shipping Packing", 10000, None), (13, "Commissioning", 20000, None)]
    for week, label, cost, pct in defaults_out:
        conn.execute(
            "INSERT INTO cash_out(project_id, week, label, cost, pct_of_dm) VALUES (?,?,?,?,?)",
            (pid, week, label, cost, pct))
    defaults_in = [(1, "Down payment", 30, 0), (2, "Sourcing completed", 30, 28),
                   (3, "Shipped to location", 20, 54), (4, "Installation completed", 10, 62),
                   (5, "Handover & closure (incl. services)", 10, 78)]
    for seq, label, pct, week in defaults_in:
        conn.execute(
            "INSERT INTO payment_milestones(project_id, seq, label, pct, week) VALUES (?,?,?,?,?)",
            (pid, seq, label, pct, week))

    bump_rev(conn)
    audit(conn, pid, "project", pid, "create", vals[0])
    conn.commit()
    conn.close()
    return jsonify({"id": pid}), 201


@app.route("/api/projects/<int:pid>")
def get_project(pid):
    conn = db.get_db()
    p = get_project_or_404(conn, pid)
    conn.close()
    return jsonify(dict(p))


@app.route("/api/projects/<int:pid>", methods=["PUT"])
def update_project(pid):
    d = body()
    conn = db.get_db()
    get_project_or_404(conn, pid)
    sets, vals = [], []
    for c in PROJECT_FIELDS:
        if c in d:
            sets.append(f"{c} = ?")
            if c == "modules_count":
                try:
                    vals.append(int(d[c]))
                except (ValueError, TypeError):
                    vals.append(1)
            else:
                vals.append(d[c])
    if sets:
        conn.execute("UPDATE projects SET " + ",".join(sets) + " WHERE id = ?", vals + [pid])
        if "contract_date" in d:
            for t in conn.execute(
                    "SELECT milestone_no, week_offset, due_date FROM timeline WHERE project_id = ?",
                    (pid,)).fetchall():
                if not t["due_date"]:
                    conn.execute("UPDATE timeline SET due_date = ? WHERE project_id = ? AND milestone_no = ?",
                                 (milestone_due_date(d["contract_date"], t["week_offset"]), pid,
                                  t["milestone_no"]))
        bump_rev(conn)
        audit(conn, pid, "project", pid, "update", ",".join(sets))
        conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/projects/<int:pid>/log")
def project_log(pid):
    conn = db.get_db()
    rows = conn.execute("SELECT * FROM audit WHERE project_id = ? ORDER BY id DESC LIMIT 500",
                        (pid,)).fetchall()
    conn.close()
    return jsonify(rows_to_dicts(rows))


@app.route("/api/projects/<int:pid>/dashboard")
def dashboard(pid):
    conn = db.get_db()
    p = get_project_or_404(conn, pid)
    open_points = conn.execute(
        "SELECT COUNT(*) FROM opl WHERE project_id = ? AND status != 'Closed'", (pid,)).fetchone()[0]
    blocked = conn.execute(
        "SELECT COUNT(*) FROM opl WHERE project_id = ? AND status = 'Blocked'", (pid,)).fetchone()[0]
    today = date.today().isoformat()
    upcoming = rows_to_dicts(conn.execute(
        "SELECT milestone_no, name, week_offset, due_date, done FROM timeline"
        " WHERE project_id = ? AND done = 0 ORDER BY COALESCE(NULLIF(due_date,''), '9999-12-31'), milestone_no"
        " LIMIT 5", (pid,)).fetchall())
    total_ms = conn.execute("SELECT COUNT(*) FROM timeline WHERE project_id = ?", (pid,)).fetchone()[0]
    done_ms = conn.execute("SELECT COUNT(*) FROM timeline WHERE project_id = ? AND done = 1",
                            (pid,)).fetchone()[0]
    b = conn.execute("SELECT * FROM budget WHERE project_id = ?", (pid,)).fetchone()
    modules = p["modules_count"] or 1
    conn.close()
    return jsonify({
        "project": dict(p),
        "open_points": open_points,
        "blocked_points": blocked,
        "upcoming_milestones": upcoming,
        "milestones_done": done_ms,
        "milestones_total": total_ms,
        "budget": dict(b) if b else None,
        "modules": modules,
    })


# ---------------------------------------------------------------- WBS

@app.route("/api/projects/<int:pid>/wbs")
def wbs_list(pid):
    conn = db.get_db()
    get_project_or_404(conn, pid)
    rows = conn.execute("SELECT * FROM wbs WHERE project_id = ? ORDER BY pos", (pid,)).fetchall()
    conn.close()
    return jsonify(rows_to_dicts(rows))


@app.route("/api/projects/<int:pid>/wbs", methods=["POST"])
def wbs_add(pid):
    d = body()
    conn = db.get_db()
    get_project_or_404(conn, pid)
    parent = d.get("parent_code", "")
    code = d.get("code", "")
    if not code and parent:
        prefix = parent + "."
        n = conn.execute("SELECT COUNT(*) FROM wbs WHERE project_id = ? AND parent_code = ?",
                         (pid, parent)).fetchone()[0]
        code = f"{prefix}{n + 1}"
    if not code:
        code = str(conn.execute("SELECT COUNT(*) FROM wbs WHERE project_id = ?", (pid,)).fetchone()[0] + 1)
    pos = conn.execute("SELECT COALESCE(MAX(pos), -1) + 1 FROM wbs WHERE project_id = ?", (pid,)).fetchone()[0]
    cur = conn.execute(
        "INSERT INTO wbs(project_id, code, item_type, name, parent_code, doc_ref, owner, pos)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (pid, code, d.get("item_type", "activity"), d.get("name", ""), parent,
         d.get("doc_ref", ""), d.get("owner", ""), pos))
    bump_rev(conn)
    audit(conn, pid, "wbs", cur.lastrowid, "create", f"{code} {d.get('name', '')}")
    conn.commit()
    conn.close()
    return jsonify({"id": cur.lastrowid, "code": code}), 201


@app.route("/api/projects/<int:pid>/wbs/<int:wid>", methods=["PUT", "DELETE"])
def wbs_edit(pid, wid):
    conn = db.get_db()
    get_project_or_404(conn, pid)
    row = conn.execute("SELECT * FROM wbs WHERE id = ? AND project_id = ?", (wid, pid)).fetchone()
    if row is None:
        conn.close()
        abort(404)
    if request.method == "DELETE":
        conn.execute("DELETE FROM wbs WHERE id = ?", (wid,))
        audit(conn, pid, "wbs", wid, "delete", f"{row['code']} {row['name']}")
    else:
        d = body()
        sets, vals = [], []
        for c in ["code", "item_type", "name", "parent_code", "doc_ref", "owner",
                  "planned_date", "actual_date", "status"]:
            if c in d:
                sets.append(f"{c} = ?")
                vals.append(d[c])
        if sets:
            conn.execute("UPDATE wbs SET " + ",".join(sets) + " WHERE id = ?", vals + [wid])
            audit(conn, pid, "wbs", wid, "update", f"{row['code']} {row['name']}")
    bump_rev(conn)
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------------- timeline

@app.route("/api/projects/<int:pid>/timeline")
def timeline_get(pid):
    module_idx = int(request.args.get("module", 0) or 0)
    conn = db.get_db()
    p = get_project_or_404(conn, pid)
    rows = conn.execute("SELECT * FROM timeline WHERE project_id = ? ORDER BY milestone_no",
                        (pid,)).fetchall()
    out = []
    for t in rows:
        computed = milestone_due_date(p["contract_date"], t["week_offset"], module_idx)
        base = t["due_date"] or milestone_due_date(p["contract_date"], t["week_offset"], 0)
        effective = base
        if module_idx and base:
            bd = parse_date(base)
            if bd:
                effective = (bd + timedelta(weeks=4 * module_idx)).isoformat()
        out.append({
            "milestone_no": t["milestone_no"], "name": t["name"],
            "week_offset": t["week_offset"], "due_date": effective,
            "computed_due_date": computed, "done": t["done"],
        })
    critical = rows_to_dicts(conn.execute(
        "SELECT id, number, description, due_date, assignee, priority FROM opl"
        " WHERE project_id = ? AND priority = 'Critical' AND status != 'Closed'", (pid,)).fetchall())
    conn.close()
    return jsonify({"milestones": out, "critical_opl": critical,
                    "contract_date": p["contract_date"], "module": module_idx})


@app.route("/api/projects/<int:pid>/timeline/<int:mno>", methods=["PUT"])
def timeline_update(pid, mno):
    d = body()
    conn = db.get_db()
    get_project_or_404(conn, pid)
    row = conn.execute("SELECT * FROM timeline WHERE project_id = ? AND milestone_no = ?",
                       (pid, mno)).fetchone()
    if row is None:
        conn.close()
        abort(404)
    sets, vals = [], []
    if "due_date" in d:
        sets.append("due_date = ?")
        vals.append(d["due_date"])
    if "done" in d:
        sets.append("done = ?")
        vals.append(1 if d["done"] else 0)
    if sets:
        conn.execute("UPDATE timeline SET " + ",".join(sets) +
                     " WHERE project_id = ? AND milestone_no = ?", vals + [pid, mno])
        bump_rev(conn)
        audit(conn, pid, "timeline", mno, "update", f"milestone {mno}: {d}")
        conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------------- OPL

@app.route("/api/projects/<int:pid>/opl")
def opl_list(pid):
    conn = db.get_db()
    get_project_or_404(conn, pid)
    rows = conn.execute("SELECT * FROM opl WHERE project_id = ? ORDER BY number", (pid,)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["duration_days"] = days_between(d["start_date"], d["due_date"])
        out.append(d)
    conn.close()
    return jsonify(out)


@app.route("/api/projects/<int:pid>/opl", methods=["POST"])
def opl_add(pid):
    d = body()
    conn = db.get_db()
    get_project_or_404(conn, pid)
    number = conn.execute("SELECT COALESCE(MAX(number), 0) + 1 FROM opl WHERE project_id = ?",
                          (pid,)).fetchone()[0]
    cur = conn.execute(
        "INSERT INTO opl(project_id, number, status, description, assignee, start_date, due_date,"
        " priority, blocker, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (pid, number, d.get("status", "Open"), d.get("description", ""), d.get("assignee", ""),
         d.get("start_date", ""), d.get("due_date", ""), d.get("priority", "Mid"),
         d.get("blocker", ""), user()))
    bump_rev(conn)
    audit(conn, pid, "opl", cur.lastrowid, "create", f"#{number} {d.get('description', '')[:80]}")
    conn.commit()
    conn.close()
    return jsonify({"id": cur.lastrowid, "number": number}), 201


@app.route("/api/projects/<int:pid>/opl/<int:oid>", methods=["PUT", "DELETE"])
def opl_edit(pid, oid):
    conn = db.get_db()
    get_project_or_404(conn, pid)
    row = conn.execute("SELECT * FROM opl WHERE id = ? AND project_id = ?", (oid, pid)).fetchone()
    if row is None:
        conn.close()
        abort(404)
    if request.method == "DELETE":
        conn.execute("DELETE FROM opl WHERE id = ?", (oid,))
        audit(conn, pid, "opl", oid, "delete", f"#{row['number']} {row['description'][:80]}")
    else:
        d = body()
        sets, vals = [], []
        for c in ["status", "description", "assignee", "start_date", "due_date", "priority", "blocker"]:
            if c in d:
                sets.append(f"{c} = ?")
                vals.append(d[c])
        if sets:
            conn.execute("UPDATE opl SET " + ",".join(sets) + " WHERE id = ?", vals + [oid])
            audit(conn, pid, "opl", oid, "update", f"#{row['number']}: {d}")
    bump_rev(conn)
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------------- budget

@app.route("/api/projects/<int:pid>/budget")
def budget_get(pid):
    conn = db.get_db()
    p = get_project_or_404(conn, pid)
    b = conn.execute("SELECT * FROM budget WHERE project_id = ?", (pid,)).fetchone()
    payments = rows_to_dicts(conn.execute(
        "SELECT * FROM payment_milestones WHERE project_id = ? ORDER BY seq", (pid,)).fetchall())
    cashout = rows_to_dicts(conn.execute(
        "SELECT * FROM cash_out WHERE project_id = ? ORDER BY week, id", (pid,)).fetchall())
    conn.close()
    modules = p["modules_count"] or 1
    b = dict(b) if b else {"sales_price": 0, "services_price": 0, "cogs_module": 0,
                           "service_costs": 0, "direct_material": 0}
    max_week = max([78 + 4 * (modules - 1)] + [c["week"] for c in cashout] +
                   [pm["week"] for pm in payments] + [0])
    weeks = list(range(0, max_week + 1))
    cash_in = [0.0] * (max_week + 1)
    sales_total = (b["sales_price"] or 0) * modules
    services = b["services_price"] or 0
    for pm in payments:
        amt = sales_total * (pm["pct"] or 0) / 100.0
        if pm["seq"] == max((x["seq"] for x in payments), default=pm["seq"]):
            amt += services
        if 0 <= pm["week"] <= max_week:
            cash_in[pm["week"]] += amt
    cash_out_w = [0.0] * (max_week + 1)
    dm_total = (b["direct_material"] or 0) * modules
    for c in cashout:
        amt = (dm_total * (c["pct_of_dm"] or 0) / 100.0) if c["pct_of_dm"] is not None else (c["cost"] or 0) * modules
        if 0 <= c["week"] <= max_week:
            cash_out_w[c["week"]] += amt
    cumulative = []
    run = 0.0
    for w in weeks:
        run += cash_in[w] - cash_out_w[w]
        cumulative.append(run)
    if modules and b["service_costs"]:
        cash_out_w[max_week] += b["service_costs"] * modules
        run = 0.0
        cumulative = []
        for w in weeks:
            run += cash_in[w] - cash_out_w[w]
            cumulative.append(run)
    return jsonify({
        "inputs": b, "payments": payments, "cashout": cashout, "modules": modules,
        "weeks": weeks, "cash_in": cash_in, "cash_out": cash_out_w, "cumulative": cumulative,
        "sales_total": sales_total,
    })


@app.route("/api/projects/<int:pid>/budget", methods=["PUT"])
def budget_put(pid):
    d = body()
    conn = db.get_db()
    get_project_or_404(conn, pid)
    inputs = d.get("inputs", {})
    conn.execute(
        "UPDATE budget SET sales_price=?, services_price=?, cogs_module=?, service_costs=?,"
        " direct_material=? WHERE project_id=?",
        (float(inputs.get("sales_price") or 0), float(inputs.get("services_price") or 0),
         float(inputs.get("cogs_module") or 0), float(inputs.get("service_costs") or 0),
         float(inputs.get("direct_material") or 0), pid))
    if "payments" in d:
        conn.execute("DELETE FROM payment_milestones WHERE project_id = ?", (pid,))
        for i, pm in enumerate(d["payments"], start=1):
            conn.execute(
                "INSERT INTO payment_milestones(project_id, seq, label, pct, week) VALUES (?,?,?,?,?)",
                (pid, i, pm.get("label", ""), float(pm.get("pct") or 0), int(pm.get("week") or 0)))
    if "cashout" in d:
        conn.execute("DELETE FROM cash_out WHERE project_id = ?", (pid,))
        for c in d["cashout"]:
            conn.execute(
                "INSERT INTO cash_out(project_id, week, label, cost, pct_of_dm) VALUES (?,?,?,?,?)",
                (pid, int(c.get("week") or 0), c.get("label", ""), float(c.get("cost") or 0),
                 float(c["pct_of_dm"]) if c.get("pct_of_dm") not in (None, "") else None))
    bump_rev(conn)
    audit(conn, pid, "budget", pid, "update", json.dumps(d)[:200])
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------------- documents

@app.route("/api/document-templates")
def doc_templates():
    conn = db.get_db()
    rows = conn.execute("SELECT * FROM doc_templates ORDER BY id").fetchall()
    conn.close()
    return jsonify(rows_to_dicts(rows))


@app.route("/api/document-templates", methods=["POST"])
def doc_template_add():
    d = body()
    cols = ["phase", "consolidated", "code", "description", "seq", "doc_name", "template",
            "sample", "owner", "reviewer", "approver", "rina", "abs", "customer", "internal",
            "hard_copies", "gate1", "gate2", "gate3", "gate4", "gate5", "comment"]
    conn = db.get_db()
    cur = conn.execute(
        "INSERT INTO doc_templates(" + ",".join(cols) + ") VALUES (" + ",".join("?" * len(cols)) + ")",
        [d.get(c, "") for c in cols])
    tid = cur.lastrowid
    for p in conn.execute("SELECT id FROM projects").fetchall():
        conn.execute("INSERT INTO project_documents(project_id, template_id) VALUES (?,?)",
                     (p["id"], tid))
    bump_rev(conn)
    audit(conn, None, "doc_templates", tid, "create", d.get("doc_name", ""))
    conn.commit()
    conn.close()
    return jsonify({"id": tid}), 201


@app.route("/api/projects/<int:pid>/documents")
def project_documents(pid):
    conn = db.get_db()
    get_project_or_404(conn, pid)
    rows = conn.execute(
        "SELECT pd.id, pd.status, pd.link, pd.comment, t.*"
        " FROM project_documents pd JOIN doc_templates t ON t.id = pd.template_id"
        " WHERE pd.project_id = ? ORDER BY t.id", (pid,)).fetchall()
    conn.close()
    return jsonify(rows_to_dicts(rows))


@app.route("/api/projects/<int:pid>/documents/<int:did>", methods=["PUT"])
def project_document_update(pid, did):
    d = body()
    conn = db.get_db()
    get_project_or_404(conn, pid)
    row = conn.execute("SELECT * FROM project_documents WHERE id = ? AND project_id = ?",
                       (did, pid)).fetchone()
    if row is None:
        conn.close()
        abort(404)
    sets, vals = [], []
    for c in ["status", "link", "comment"]:
        if c in d:
            sets.append(f"{c} = ?")
            vals.append(d[c])
    if sets:
        conn.execute("UPDATE project_documents SET " + ",".join(sets) + " WHERE id = ?", vals + [did])
        bump_rev(conn)
        audit(conn, pid, "documents", did, "update", f"{d}")
        conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------------- contacts

@app.route("/api/projects/<int:pid>/contacts")
def contacts_list(pid):
    conn = db.get_db()
    get_project_or_404(conn, pid)
    rows = conn.execute("SELECT * FROM contacts WHERE project_id = ? ORDER BY company, last_name",
                        (pid,)).fetchall()
    conn.close()
    return jsonify(rows_to_dicts(rows))


@app.route("/api/projects/<int:pid>/contacts", methods=["POST"])
def contact_add(pid):
    d = body()
    conn = db.get_db()
    get_project_or_404(conn, pid)
    cols = ["company", "first_name", "last_name", "role", "email", "phone", "language", "contact_way"]
    cur = conn.execute(
        "INSERT INTO contacts(project_id, " + ",".join(cols) + ") VALUES (?" + ",?" * len(cols) + ")",
        [pid] + [d.get(c, "") for c in cols])
    bump_rev(conn)
    audit(conn, pid, "contacts", cur.lastrowid, "create",
          f"{d.get('first_name', '')} {d.get('last_name', '')} ({d.get('company', '')})")
    conn.commit()
    conn.close()
    return jsonify({"id": cur.lastrowid}), 201


@app.route("/api/projects/<int:pid>/contacts/<int:cid>", methods=["PUT", "DELETE"])
def contact_edit(pid, cid):
    conn = db.get_db()
    get_project_or_404(conn, pid)
    row = conn.execute("SELECT * FROM contacts WHERE id = ? AND project_id = ?", (cid, pid)).fetchone()
    if row is None:
        conn.close()
        abort(404)
    if request.method == "DELETE":
        conn.execute("DELETE FROM contacts WHERE id = ?", (cid,))
        audit(conn, pid, "contacts", cid, "delete", f"{row['first_name']} {row['last_name']}")
    else:
        d = body()
        cols = ["company", "first_name", "last_name", "role", "email", "phone", "language", "contact_way"]
        sets, vals = [], []
        for c in cols:
            if c in d:
                sets.append(f"{c} = ?")
                vals.append(d[c])
        if sets:
            conn.execute("UPDATE contacts SET " + ",".join(sets) + " WHERE id = ?", vals + [cid])
            audit(conn, pid, "contacts", cid, "update", f"{row['first_name']} {row['last_name']}")
    bump_rev(conn)
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


if __name__ == "__main__":
    host = os.environ.get("DELIVERY_HOST", "127.0.0.1")
    port = int(os.environ.get("DELIVERY_PORT", "5000"))
    app.run(host=host, port=port, debug=False, threaded=True)
