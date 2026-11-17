"use strict";

const state = {
  rev: -1,
  user: localStorage.getItem("dmt_user") || "",
  sort: {},
  filters: {},
  moduleIdx: 0,
};

const main = document.getElementById("main");
const sidebar = document.getElementById("sidebar");
const wikiDrawer = document.getElementById("wiki-drawer");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function flash(msg) {
  const d = document.createElement("div");
  d.className = "flash";
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2200);
}

async function api(path, opts = {}) {
  const headers = { "X-User-Name": state.user || "anonymous" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.headers) Object.assign(headers, opts.headers);
  const res = await fetch("/api" + path, {
    method: opts.method || "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 403) throw new Error("Forbidden: invalid password");
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch (e) { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

function ensureUser() {
  if (!state.user) {
    const name = prompt("Your name (used in the project change log):", "");
    if (name) {
      state.user = name.trim();
      localStorage.setItem("dmt_user", state.user);
    } else {
      state.user = "anonymous";
    }
    document.getElementById("user-label").textContent = state.user;
  }
}

function filterRows(items, key, fields) {
  const q = (state.filters[key] || "").toLowerCase();
  if (!q) return items;
  return items.filter(x => fields.some(f => String(x[f] ?? "").toLowerCase().includes(q)));
}

function modal(title, bodyHTML, actions) {
  const backdrop = document.getElementById("modal-backdrop");
  document.getElementById("modal-title").textContent = title;
  const bodyEl = document.getElementById("modal-body");
  bodyEl.innerHTML = bodyHTML;
  const actionsEl = document.getElementById("modal-actions");
  actionsEl.innerHTML = "";
  for (const a of actions) {
    const b = document.createElement("button");
    b.className = "btn " + (a.cls || "");
    b.textContent = a.label;
    b.onclick = a.fn;
    actionsEl.appendChild(b);
  }
  backdrop.classList.remove("hidden");
}

function closeModal() {
  document.getElementById("modal-backdrop").classList.add("hidden");
}

document.getElementById("modal-backdrop").addEventListener("click", e => {
  if (e.target.id === "modal-backdrop") closeModal();
});

function formHTML(fields, initial = {}) {
  return '<div class="form-grid">' + fields.map(f => {
    const v = esc(initial[f.key] ?? "");
    if (f.type === "select") {
      return `<label>${esc(f.label)}<select name="${f.key}">` +
        f.options.map(o => `<option value="${esc(o)}" ${String(initial[f.key] ?? f.default ?? "") === o ? "selected" : ""}>${esc(o)}</option>`).join("") +
        `</select></label>`;
    }
    return `<label>${esc(f.label)}<input type="${f.type || "text"}" name="${f.key}" value="${v}" ${f.step ? `step="${f.step}"` : ""}></label>`;
  }).join("") + "</div>";
}

function collectForm(bodyEl) {
  const out = {};
  bodyEl.querySelectorAll("input, select, textarea").forEach(el => {
    out[el.name] = el.type === "number" ? (el.value === "" ? "" : Number(el.value)) : el.value;
  });
  return out;
}

function editModal(title, fields, initial, onSave) {
  modal(title, formHTML(fields, initial), [
    { label: "Cancel", cls: "ghost", fn: closeModal },
    {
      label: "Save", cls: "accent", fn: async () => {
        const vals = collectForm(document.getElementById("modal-body"));
        try {
          await onSave(vals);
          closeModal();
          render();
        } catch (e) { alert(e.message); }
      },
    },
  ]);
}

function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  return h.split("/").filter(Boolean);
}

function projectTabs(project) {
  const tabs = [["dashboard", "Dashboard"], ["master", "Master Data"], ["wbs", "WBS"],
    ["timeline", "Timeline"], ["opl", "OPL"], ["budget", "Budget"],
    ["documents", "Documents"], ["contacts", "Contacts"], ["log", "Change Log"]];
  if (project && (project.delivery_type === "Marine" || project.delivery_type === "Retrofit")) {
    tabs.splice(4, 0, ["class", "Class"]);
  }
  return tabs;
}

async function render() {
  ensureUser();
  const parts = parseHash();
  let project = null;
  if (parts[0] === "project" && parts[1]) {
    try { project = await api(`/projects/${parts[1]}`); } catch (e) { project = null; }
  }
  renderSidebar(parts, project);
  try {
    if (parts.length === 0 || parts[0] === "portfolio") await viewPortfolio();
    else if (parts[0] === "library") await viewLibrary();
    else if (parts[0] === "project" && parts[1]) await viewProject(Number(parts[1]), parts[2] || "dashboard", project);
    else main.innerHTML = "<h1>Not found</h1>";
  } catch (e) {
    main.innerHTML = `<div class="card"><span class="err">${esc(e.message)}</span></div>`;
  }
}

function renderSidebar(parts, project) {
  let html = `<div class="nav-title">Tool</div>
    <a href="#/" class="${!parts[0] || parts[0] === "portfolio" ? "active" : ""}">Portfolio</a>
    <a href="#/library" class="${parts[0] === "library" ? "active" : ""}">Library</a>`;
  if (parts[0] === "project" && parts[1]) {
    const pid = parts[1];
    const tab = parts[2] || "dashboard";
    html += `<div class="nav-title">Delivery Project #${esc(pid)}</div>` +
      projectTabs(project).map(([k, label]) =>
        `<a href="#/project/${pid}/${k}" class="${tab === k ? "active" : ""}">${label}</a>`).join("");
  }
  sidebar.innerHTML = html;
}

async function viewPortfolio() {
  const data = await api("/projects");
  const projects = data.projects;
  const kpi = data.kpi;
  const delta = kpi.crit_blocked_now - kpi.crit_blocked_14d_ago;
  main.innerHTML = `
    <h1>Portfolio Overview</h1>
    <div class="cards">
      <div class="stat"><div class="num" style="color:var(--danger)">${kpi.crit_blocked_now}</div>
        <div class="lbl">Critical / blocked points now</div>
        <div class="small muted">14 days ago: ${kpi.crit_blocked_14d_ago} (${delta >= 0 ? "+" : ""}${delta})</div></div>
      <div class="stat"><div class="num">${kpi.open_points_now}</div><div class="lbl">Open points (all projects)</div></div>
      <div class="stat"><div class="num">${projects.filter(p => p.status === "Ongoing").length}</div>
        <div class="lbl">Ongoing projects</div></div>
      <div class="stat"><div class="num">${projects.filter(p => p.status === "Closed").length}</div>
        <div class="lbl">Closed projects</div></div>
    </div>
    <div class="toolbar">
      <button class="btn accent" id="new-project">+ New Delivery Project</button>
    </div>
    <div class="card">
      <h3>Projects</h3>
      <table>
        <thead><tr>
          <th>Project</th><th>Status</th><th>Delivery Manager</th><th>Equipment</th>
          <th>HP300 to deliver</th><th>HP300 version</th><th>First delivery</th>
          <th>Last delivery</th><th>Open points</th><th></th>
        </tr></thead>
        <tbody>
          ${projects.map(p => `<tr>
            <td><a href="#/project/${p.id}/dashboard"><strong>${esc(p.name)}</strong></a><br>
              <span class="muted small">${esc(p.customer || "")}</span></td>
            <td><span class="badge ${esc((p.status || "ongoing").toLowerCase())}">${esc(p.status)}</span></td>
            <td>${esc(p.delivery_manager)}</td>
            <td>${esc(p.equipment)}</td>
            <td>${esc(p.modules_count)}</td>
            <td>${esc(p.module_type)}</td>
            <td>${esc(p.first_delivery_date)}</td>
            <td>${esc(p.last_delivery_date)}</td>
            <td>${p.open_points} ${p.crit_blocked ? `(<span class="badge critical">${p.crit_blocked} crit/blocked</span>)` : ""}</td>
            <td><a class="btn small" href="#/project/${p.id}/dashboard">Enter ▸</a></td>
          </tr>`).join("") || '<tr><td colspan="10" class="muted">No projects yet. Create the first one!</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="card">
      <h3>Critical / blocked open points (all projects)</h3>
      <table><thead><tr><th>Project</th><th>#</th><th>Open point</th><th>Owner</th><th>Due</th><th>Priority</th><th>Blocked</th><th></th></tr></thead>
      <tbody>${data.critical_opl.map(o => `<tr>
        <td><a href="#/project/${o.project_id}/opl">${esc(o.project_name)}</a></td>
        <td>${o.number}</td><td>${esc(o.description)}</td><td>${esc(o.assignee)}</td><td>${esc(o.due_date)}</td>
        <td><span class="badge ${esc(o.priority.toLowerCase())}">${esc(o.priority)}</span></td>
        <td>${o.blocker === "Yes" ? '<span class="badge blocked">Yes</span>' : ""}</td>
        <td><a class="btn small" href="#/project/${o.project_id}/opl">Open ▸</a></td>
      </tr>`).join("") || '<tr><td colspan="8" class="muted">None — good job!</td></tr>'}</tbody></table>
    </div>
    <div class="card">
      <h3>Portfolio timeline — FAT &amp; commissioning dates</h3>
      <div id="portfolio-timeline"></div>
    </div>`;
  document.getElementById("new-project").onclick = () => newProjectModal();
  renderPortfolioTimeline(data.events);
}

function renderPortfolioTimeline(events) {
  const el = document.getElementById("portfolio-timeline");
  if (!el) return;
  if (!events.length) {
    el.innerHTML = '<p class="muted small">No projects with a contract date yet.</p>';
    return;
  }
  const dates = events.map(e => e.date).sort();
  const min = new Date(dates[0]), max = new Date(dates[dates.length - 1]);
  const spanDays = Math.max((max - min) / 864e5, 7);
  const px = d => ((new Date(d) - min) / 864e5 / spanDays) * 100;
  const byProject = {};
  events.forEach(e => {
    (byProject[e.project_id] = byProject[e.project_id] || { name: e.project, pid: e.project_id, ev: [] }).ev.push(e);
  });
  el.innerHTML = `<div class="gantt-wrap"><div class="gantt" style="min-width:100%">` +
    Object.values(byProject).map(p => `
      <div class="gantt-row" style="height:34px">
        <div class="gantt-label" title="${esc(p.name)}"><a href="#/project/${p.pid}/dashboard">${esc(p.name)}</a></div>
        <div class="gantt-track">
          ${p.ev.map(e => `<div class="gantt-diamond ${e.kind === "FAT" ? "fat" : "comm"}"
              style="left:calc(${px(e.date)}% - 9px)"
              title="${esc(p.name)} ${e.kind} — ${esc(e.date)}"></div>`).join("")}
        </div>
      </div>`).join("") + `</div></div>
    <div class="legend"><span><span class="swatch" style="background:#f4a261;transform:rotate(45deg)"></span>FAT (M9)</span>
    <span><span class="swatch" style="background:#2ec4b6;transform:rotate(45deg)"></span>Commissioning (M13)</span>
    <span class="small muted">${esc(dates[0])} → ${esc(dates[dates.length - 1])}</span></div>`;
}

const MASTER_FIELDS = [
  { key: "name", label: "Project name" },
  { key: "delivery_manager", label: "Delivery Project Manager" },
  { key: "customer", label: "Customer" },
  { key: "end_customer", label: "End customer" },
  { key: "delivery_type", label: "Delivery type", type: "select", options: ["Land", "Marine", "Retrofit"] },
  { key: "shipyard", label: "Shipyard (Marine)" },
  { key: "shipyard_country", label: "Shipyard country (Marine)" },
  { key: "equipment", label: "Equipment", type: "select", options: ["HP150", "HP300", "Steam Turbine"] },
  { key: "modules_count", label: "Number of modules", type: "number" },
  { key: "module_type", label: "Module type / HP300 version" },
  { key: "regulatory", label: "Regulatory (class society / CE)" },
  { key: "grid_codes", label: "Grid codes", type: "select", options: ["No", "Yes"] },
  { key: "contract_date", label: "Contract date", type: "date" },
  { key: "first_delivery_date", label: "First delivery date", type: "date" },
  { key: "last_delivery_date", label: "Last delivery date", type: "date" },
];

function newProjectModal() {
  editModal("New Delivery Project", MASTER_FIELDS, { modules_count: 1 },
    async vals => {
      vals.status = "Ongoing";
      const r = await api("/projects", { method: "POST", body: vals });
      location.hash = `#/project/${r.id}/dashboard`;
    });
}

async function viewProject(pid, tab, project) {
  const p = project || await api(`/projects/${pid}`);
  const tabs = projectTabs(p);
  main.innerHTML = `
    <h1>${esc(p.name)} <span class="badge ${esc((p.status || "ongoing").toLowerCase())}">${esc(p.status)}</span></h1>
    <div class="tabs">${tabs.map(([k, label]) =>
      `<a href="#/project/${pid}/${k}" class="${tab === k ? "active" : ""}">${label}</a>`).join("")}</div>
    <div id="tab-content"><div class="loading">Loading…</div></div>`;
  const c = document.getElementById("tab-content");
  if (tab === "dashboard") await renderDashboard(pid, c);
  else if (tab === "master") await renderMaster(pid, p, c);
  else if (tab === "wbs") await renderWbs(pid, c);
  else if (tab === "timeline") await renderTimeline(pid, c);
  else if (tab === "class") await renderClass(pid, c);
  else if (tab === "opl") await renderOpl(pid, c);
  else if (tab === "budget") await renderBudget(pid, c);
  else if (tab === "documents") await renderDocuments(pid, c);
  else if (tab === "contacts") await renderContacts(pid, c);
  else if (tab === "log") await renderLog(pid, c);
}

async function renderDashboard(pid, c) {
  const d = await api(`/projects/${pid}/dashboard`);
  c.innerHTML = `
    <div class="cards">
      <div class="stat"><div class="num">${esc(d.project.status)}</div><div class="lbl">Project status</div></div>
      <div class="stat"><div class="num">${d.open_points}</div><div class="lbl">Open points</div></div>
      <div class="stat"><div class="num" style="color:var(--danger)">${d.blocked_points}</div><div class="lbl">Blocked open points</div></div>
      <div class="stat"><div class="num">${d.milestones_done}/${d.milestones_total}</div><div class="lbl">Milestones done</div></div>
      <div class="stat"><div class="num">${d.modules}</div><div class="lbl">Modules (${esc(d.project.equipment)})</div></div>
    </div>
    <div class="card">
      <h3>Upcoming milestones</h3>
      <table><thead><tr><th>#</th><th>Milestone</th><th>Due date</th><th>Status</th></tr></thead>
      <tbody>${d.upcoming_milestones.map(m => `<tr>
        <td>${m.milestone_no}</td><td>${esc(m.name)}</td>
        <td>${esc(m.due_date || m.computed_due_date)}</td>
        <td>${m.done ? '<span class="badge done">Done</span>' : '<span class="badge open">Open</span>'}</td>
      </tr>`).join("") || '<tr><td colspan="4" class="muted">All milestones done.</td></tr>'}</tbody></table>
    </div>
    <div class="card">
      <h3>Master data</h3>
      <table><tbody>
        <tr><td class="muted">Delivery manager</td><td>${esc(d.project.delivery_manager)}</td>
            <td class="muted">Customer</td><td>${esc(d.project.customer)}</td></tr>
        <tr><td class="muted">Delivery type</td><td>${esc(d.project.delivery_type)}${d.project.shipyard ? ` — ${esc(d.project.shipyard)}, ${esc(d.project.shipyard_country)}` : ""}</td>
            <td class="muted">HP300 version</td><td>${esc(d.project.module_type)}</td></tr>
        <tr><td class="muted">Contract date</td><td>${esc(d.project.contract_date)}</td>
            <td class="muted">First / last delivery</td><td>${esc(d.project.first_delivery_date)} / ${esc(d.project.last_delivery_date)}</td></tr>
      </tbody></table>
    </div>`;
}

async function renderMaster(pid, p, c) {
  c.innerHTML = `<div class="card"><h3>Master Data</h3>
    <div id="master-form"></div>
    <div class="toolbar" style="margin-top:14px">
      <button class="btn accent" id="save-master">Save</button>
      <button class="btn danger" id="close-project">${p.status === "Closed" ? "Re-open project" : "Close project"}</button>
    </div></div>`;
  document.getElementById("master-form").innerHTML = formHTML(MASTER_FIELDS, p);
  document.getElementById("save-master").onclick = async () => {
    const vals = collectForm(document.getElementById("master-form"));
    await api(`/projects/${pid}`, { method: "PUT", body: vals });
    flash("Saved");
    render();
  };
  document.getElementById("close-project").onclick = async () => {
    await api(`/projects/${pid}`, { method: "PUT", body: { status: p.status === "Closed" ? "Ongoing" : "Closed" } });
    render();
  };
}

const WBS_STATUSES = ["Not started", "In progress", "Done", "Blocked", "n/a"];

async function renderWbs(pid, c) {
  const items = await api(`/projects/${pid}/wbs`);
  const p = await api(`/projects/${pid}`);
  const depth = code => code.split(".").length;
  const filtered = filterRows(items, "wbs", ["code", "name", "owner", "doc_ref", "status"]);
  const statusBadge = s => `<span class="badge ${s === "Done" || s === "n/a" ? "done" : s === "In progress" ? "inprogress" : s === "Blocked" ? "blocked" : "low"}">${esc(s)}</span>`;
  c.innerHTML = `<div class="toolbar">
      <input id="wbs-filter" placeholder="Filter WBS…" value="${esc(state.filters.wbs || "")}" style="width:220px">
      <button class="btn accent" id="wbs-add-root">+ Add item</button>
      <span class="muted small">Click a phase/milestone code to collapse it. Click a row to edit inline. New items default owner = delivery manager. Codes: a.b.c.d.</span>
    </div>
    <div class="card"><table id="wbs-table">
      <thead><tr><th>Code</th><th>Type</th><th>Status</th><th>Name</th><th>Owner</th>
        <th>Planned</th><th>Actual</th><th>Reference</th><th></th></tr></thead>
      <tbody>${filtered.map(w => `<tr class="${w.item_type}-row" data-code="${esc(w.code)}" data-parent="${esc(w.parent_code)}" data-id="${w.id}">
        <td class="wbs-code">${w.item_type === "phase" || w.item_type === "milestone" ? '<span class="collapse-toggle">▾</span> ' : ""}${esc(w.code)}</td>
        <td>${esc(w.item_type)}</td>
        <td class="cell-status">${statusBadge(w.status)}</td>
        <td class="cell-name" style="padding-left:${depth(w.code) * 14}px">${esc(w.name)}</td>
        <td class="cell-owner">${esc(w.owner)}</td>
        <td class="cell-planned">${esc(w.planned_date)}</td>
        <td class="cell-actual">${esc(w.actual_date)}</td>
        <td class="cell-ref small muted">${esc(w.doc_ref)}</td>
        <td>
          ${w.item_type !== "phase" ? `<button class="btn small add-child" data-code="${esc(w.code)}">+ child</button>` : ""}
          <button class="btn small danger del-wbs" data-id="${w.id}">✕</button>
        </td></tr>`).join("")}</tbody>
    </table></div>`;
  const filter = c.querySelector("#wbs-filter");
  filter.oninput = () => { state.filters.wbs = filter.value; renderWbs(pid, c); };
  c.querySelectorAll(".collapse-toggle").forEach(t => t.onclick = e => {
    e.stopPropagation();
    const row = t.closest("tr");
    const code = row.dataset.code;
    const collapsed = row.classList.toggle("collapsed");
    t.textContent = collapsed ? "▸" : "▾";
    c.querySelectorAll("tr").forEach(r => {
      if (r.dataset.parent === code || (r.dataset.parent || "").startsWith(code + ".")) {
        r.classList.toggle("hidden-row", collapsed);
      }
    });
  });
  c.querySelectorAll("#wbs-table tbody tr").forEach(row => row.onclick = e => {
    if (e.target.closest("button") || e.target.closest(".collapse-toggle")) return;
    if (row.classList.contains("editing")) return;
    const w = items.find(x => x.id === Number(row.dataset.id));
    row.classList.add("editing");
    row.querySelector(".cell-status").innerHTML = `<select name="status">${WBS_STATUSES.map(s => `<option ${s === w.status ? "selected" : ""}>${s}</option>`).join("")}</select>`;
    row.querySelector(".cell-name").innerHTML = `<input name="name" value="${esc(w.name)}" style="width:100%">`;
    row.querySelector(".cell-owner").innerHTML = `<input name="owner" value="${esc(w.owner)}">`;
    row.querySelector(".cell-planned").innerHTML = `<input name="planned_date" type="date" value="${esc(w.planned_date)}">`;
    row.querySelector(".cell-actual").innerHTML = `<input name="actual_date" type="date" value="${esc(w.actual_date)}">`;
    row.querySelector(".cell-ref").innerHTML = `<input name="doc_ref" value="${esc(w.doc_ref)}" style="width:100%">`;
    const actions = row.querySelector("td:last-child");
    actions.innerHTML = `<button class="btn small accent save-inline">Save</button>
      <button class="btn small ghost2 cancel-inline">Cancel</button>`;
    actions.querySelector(".save-inline").onclick = async () => {
      const vals = collectForm(row);
      await api(`/projects/${pid}/wbs/${w.id}`, { method: "PUT", body: vals });
      render();
    };
    actions.querySelector(".cancel-inline").onclick = () => render();
  });
  c.querySelector("#wbs-add-root").onclick = () =>
    editModal("Add WBS item", [
      { key: "item_type", label: "Type", type: "select", options: ["phase", "gate", "milestone", "activity"] },
      { key: "name", label: "Name" }, { key: "owner", label: `Owner (default: ${esc(p.delivery_manager || "—")})` },
      { key: "doc_ref", label: "Reference" }], {},
      async vals => { await api(`/projects/${pid}/wbs`, { method: "POST", body: vals }); });
  c.querySelectorAll(".add-child").forEach(b => b.onclick = e => {
    e.stopPropagation();
    editModal("Add child item", [
      { key: "item_type", label: "Type", type: "select", options: ["gate", "milestone", "activity"] },
      { key: "name", label: "Name" }, { key: "doc_ref", label: "Reference" }],
      { parent_code: b.dataset.code },
      async vals => { await api(`/projects/${pid}/wbs`, { method: "POST", body: vals }); });
  });
  c.querySelectorAll(".del-wbs").forEach(b => b.onclick = async e => {
    e.stopPropagation();
    if (!confirm("Delete this WBS item?")) return;
    await api(`/projects/${pid}/wbs/${b.dataset.id}`, { method: "DELETE" });
    render();
  });
}

let ganttZoom = 10;

const WBS_STATUS_COLORS = {
  "Done": "var(--ok)", "n/a": "var(--ok)", "In progress": "var(--warn)",
  "Blocked": "var(--danger)", "Not started": "var(--navy-2)",
};

async function renderTimeline(pid, c) {
  const data = await api(`/projects/${pid}/timeline?module=${state.moduleIdx || 0}`);
  const wbs = await api(`/projects/${pid}/wbs`);
  const wbsStatus = {};
  wbs.forEach(w => { if (w.item_type === "milestone") wbsStatus[w.code] = w.status; });
  const actsByMilestone = {};
  wbs.forEach(w => { if (w.item_type === "activity") (actsByMilestone[w.parent_code] = actsByMilestone[w.parent_code] || []).push(w); });
  const modules = data.modules || 1;
  const midx = state.moduleIdx || 0;
  const shiftOf = mno => (mno > 6 ? 4 * midx : 0);
  const maxWeek = Math.max(82, ...data.milestones.map(m => m.week_offset + shiftOf(m.milestone_no))) + 4;
  const pw = ganttZoom;
  const msColor = m => {
    const gate = Math.min(Math.floor((m.milestone_no - 1) / 3) + 1, 5);
    return WBS_STATUS_COLORS[wbsStatus[`${gate}.${gate}.${m.milestone_no}`]] || "var(--navy-2)";
  };
  const headTicks = [];
  for (let w = 0; w <= maxWeek; w++) {
    if (pw >= 14 || w % 4 === 0) headTicks.push(`<div class="gantt-tick" style="width:${pw}px">W${w}</div>`);
  }
  const subColors = ["#2ec4b6", "#f4a261", "#b388eb", "#ff8fab"];
  const rows = data.milestones.map((m, i) => {
    const prev = i > 0 ? data.milestones[i - 1].week_offset + shiftOf(data.milestones[i - 1].milestone_no) : 0;
    const wk = m.week_offset + shiftOf(m.milestone_no);
    const due = m.due_date || m.computed_due_date;
    const color = msColor(m);
    const bar = `<div class="gantt-bar" style="left:${prev * pw}px;width:${Math.max((wk - prev), 1) * pw}px;background:${color}" title="${esc(m.name)} — ${esc(due)}"></div>`;
    const dia = `<div class="gantt-diamond" style="left:${wk * pw - 9}px;background:${color}" title="M${m.milestone_no} ${esc(m.name)} — due ${esc(due)} (click for activities)" data-mno="${m.milestone_no}"></div>`;
    const subs = [];
    for (let mi = 1; mi < modules; mi++) {
      if (m.milestone_no > 6) {
        subs.push(`<div class="gantt-subdiamond" style="left:${(m.week_offset + 4 * mi) * pw - 5}px;background:${subColors[(mi - 1) % subColors.length]}" title="Module ${mi + 1} M${m.milestone_no}"></div>`);
      }
    }
    return `<div class="gantt-row"><div class="gantt-label" title="${esc(m.name)}">M${m.milestone_no} ${esc(m.name)} <span class="muted small">${esc(due)}${m.done ? " ✓" : ""}</span></div>
      <div class="gantt-track">${bar}${dia}${subs.join("")}</div></div>`;
  });
  const critLane = `<div class="gantt-row"><div class="gantt-label" style="color:var(--danger)">⚠ Critical/Blocked OPL</div>
    <div class="gantt-track">${data.critical_opl.map(o => {
      const d = new Date(o.due_date);
      const base = data.contract_date ? new Date(data.contract_date) : null;
      const wk = base && d >= base ? Math.round((d - base) / (7 * 864e5)) : 0;
      return `<div class="gantt-diamond critical" style="left:${wk * pw - 11}px" title="#${o.number} ${esc(o.description)} — due ${esc(o.due_date)} (click to open)" data-opl="${o.id}"></div>`;
    }).join("")}</div></div>`;
  c.innerHTML = `<div class="toolbar">
      <label class="small muted">Module:
        <select id="module-sel">${Array.from({ length: modules }, (_, i) =>
          `<option value="${i}" ${i === midx ? "selected" : ""}>Module ${i + 1}${i ? " (diverges after M6, +4 wks)" : ""}</option>`).join("")}</select></label>
      <span class="muted small">Zoom:</span>
      <button class="btn small" data-zoom="6">−</button>
      <button class="btn small" data-zoom="10">•</button>
      <button class="btn small" data-zoom="20">+</button>
      <span class="muted small">All modules share the timeline until M6; after that each module shifts +4 weeks per module (M7–M14). Colors follow WBS status. Click a milestone for its activities. Contract date: ${esc(data.contract_date || "—")}.</span>
    </div>
    <div class="gantt-wrap"><div class="gantt" style="min-width:${260 + (maxWeek + 1) * pw}px">
      <div class="gantt-head"><div class="gantt-label">Milestone</div><div style="display:flex">${headTicks.join("")}</div></div>
      ${rows.join("")}${critLane}
    </div></div>
    <div id="ms-activities"></div>
    <div class="legend"><span><span class="swatch" style="background:var(--navy-2)"></span>planned span (color = WBS status)</span>
      <span><span class="swatch" style="background:var(--ok)"></span>done / n/a</span>
      <span><span class="swatch" style="background:var(--warn)"></span>in progress</span>
      <span><span class="swatch" style="background:var(--danger);transform:rotate(45deg)"></span>critical/blocked OPL at due date (clickable)</span>
      <span><span class="swatch" style="background:#2ec4b6;transform:rotate(45deg);width:9px;height:9px"></span>sub-milestone of another module</span></div>`;
  c.querySelector("#module-sel").onchange = e => { state.moduleIdx = Number(e.target.value); render(); };
  c.querySelectorAll("[data-zoom]").forEach(b => b.onclick = () => { ganttZoom = Number(b.dataset.zoom); render(); });
  const showActivities = mno => {
    const gate = Math.min(Math.floor((mno - 1) / 3) + 1, 5);
    const code = `${gate}.${gate}.${mno}`;
    const acts = actsByMilestone[code] || [];
    const m = data.milestones.find(x => x.milestone_no === mno);
    c.querySelector("#ms-activities").innerHTML = `<div class="card"><h3>M${mno} ${esc(m.name)} — activities (${acts.length})</h3>
      <table><thead><tr><th>Code</th><th>Activity</th><th>Owner</th><th>Reference</th><th>Status</th></tr></thead>
      <tbody>${acts.map(a => `<tr><td class="wbs-code">${esc(a.code)}</td><td>${esc(a.name)}</td>
        <td>${esc(a.owner)}</td><td class="small muted">${esc(a.doc_ref)}</td>
        <td><span class="badge ${a.status === "Done" || a.status === "n/a" ? "done" : a.status === "In progress" ? "inprogress" : a.status === "Blocked" ? "blocked" : "low"}">${esc(a.status)}</span></td>
      </tr>`).join("") || '<tr><td colspan="5" class="muted">No activities.</td></tr>'}</tbody></table></div>`;
  };
  c.querySelectorAll(".gantt-diamond[data-mno]").forEach(d => d.onclick = () => showActivities(Number(d.dataset.mno)));
  c.querySelectorAll(".gantt-row .gantt-label").forEach((lbl, i) => {
    if (i === 0) return;
    lbl.style.cursor = "pointer";
    lbl.onclick = () => {
      const dia = lbl.parentElement.querySelector(".gantt-diamond[data-mno]");
      if (dia) showActivities(Number(dia.dataset.mno));
    };
  });
  c.querySelectorAll(".gantt-diamond[data-opl]").forEach(d => d.onclick = () => {
    location.hash = `#/project/${pid}/opl`;
    state.highlightOpl = Number(d.dataset.opl);
  });
}

async function renderOpl(pid, c) {
  const items = await api(`/projects/${pid}/opl`);
  const bold = o => (o.priority === "Critical" || o.blocker === "Yes") ? 'style="font-weight:700"' : "";
  const shown = filterRows(items, "opl", ["description", "assignee", "status", "priority", "blocker_description"]);
  c.innerHTML = `<div class="toolbar">
      <input id="opl-filter" placeholder="Filter OPL…" value="${esc(state.filters.opl || "")}" style="width:220px">
      <button class="btn accent" id="opl-add">+ Add open point</button>
      <span class="muted small">Critical or blocked rows are bold and appear as red diamonds on the timeline at their due date.</span>
    </div>
    <div class="card"><table>
      <thead><tr><th>#</th><th>Status</th><th>Open point</th><th>Assigned to</th><th>Start</th>
        <th>Due</th><th>Duration (days)</th><th>Priority</th><th>Blocker</th><th>Blocker description</th><th></th></tr></thead>
      <tbody>${shown.map(o => `<tr ${state.highlightOpl === o.id ? 'style="background:#fdecec"' : ""} ${bold(o)}>
        <td>${o.number}</td>
        <td><span class="badge ${esc(o.status.toLowerCase())}">${esc(o.status)}</span></td>
        <td>${esc(o.description)}</td><td>${esc(o.assignee)}</td>
        <td>${esc(o.start_date)}</td><td>${esc(o.due_date)}</td>
        <td>${o.duration_days ?? ""}</td>
        <td><span class="badge ${esc(o.priority.toLowerCase())}">${esc(o.priority)}</span></td>
        <td>${o.blocker === "Yes" ? '<span class="badge blocked">Yes</span>' : esc(o.blocker)}</td>
        <td class="small">${esc(o.blocker_description)}</td>
        <td><button class="btn small edit-opl" data-id="${o.id}">Edit</button>
        <button class="btn small danger del-opl" data-id="${o.id}">✕</button></td>
      </tr>`).join("") || '<tr><td colspan="11" class="muted">No open points.</td></tr>'}</tbody>
    </table></div>`;
  state.highlightOpl = null;
  const filter = c.querySelector("#opl-filter");
  filter.oninput = () => { state.filters.opl = filter.value; renderOpl(pid, c); };
  const fields = [
    { key: "status", label: "Status", type: "select", options: ["Open", "Closed", "Delayed", "Blocked"] },
    { key: "description", label: "Open point" },
    { key: "assignee", label: "Assigned to" },
    { key: "start_date", label: "Start date", type: "date" },
    { key: "due_date", label: "Due date", type: "date" },
    { key: "priority", label: "Priority", type: "select", options: ["Low", "Mid", "High", "Critical"] },
    { key: "blocker", label: "Blocker", type: "select", options: ["No", "Yes"] },
    { key: "blocker_description", label: "Blocker description (if applicable)" },
  ];
  c.querySelector("#opl-add").onclick = () =>
    editModal("Add open point", fields, { status: "Open", priority: "Mid", blocker: "No" },
      async vals => { await api(`/projects/${pid}/opl`, { method: "POST", body: vals }); });
  c.querySelectorAll(".edit-opl").forEach(b => b.onclick = () => {
    const o = items.find(x => x.id === Number(b.dataset.id));
    editModal(`Edit OPL #${o.number}`, fields, o,
      async vals => { await api(`/projects/${pid}/opl/${o.id}`, { method: "PUT", body: vals }); });
  });
  c.querySelectorAll(".del-opl").forEach(b => b.onclick = async () => {
    if (!confirm("Delete this open point?")) return;
    await api(`/projects/${pid}/opl/${b.dataset.id}`, { method: "DELETE" });
    render();
  });
}

async function renderBudget(pid, c) {
  const d = await api(`/projects/${pid}/budget`);
  const maxW = d.weeks.length - 1;
  const W = 900, H = 260, padL = 60, padB = 30, padT = 14;
  const maxV = Math.max(1, ...d.cash_in, ...d.cash_out.map(x => x), ...d.cumulative.map(Math.abs));
  const x = i => padL + (i / maxW) * (W - padL - 10);
  const y = v => padT + (1 - (v + maxV) / (2 * maxV)) * (H - padB - padT);
  const barsIn = d.cash_in.map((v, i) => v ? `<rect x="${x(i) - 4}" y="${y(0)}" width="8" height="${Math.max(y(0) - y(v), 1)}" fill="#3a9d5d" opacity="0.8"><title>Week ${i}: +€${v.toLocaleString()}</title></rect>` : "").join("");
  const barsOut = d.cash_out.map((v, i) => v ? `<rect x="${x(i) - 4}" y="${y(-v)}" width="8" height="${Math.max(y(0) - y(-v), 1)}" fill="#e63946" opacity="0.8"><title>Week ${i}: −€${v.toLocaleString()}</title></rect>` : "").join("");
  const line = d.cumulative.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const zeroY = y(0);
  c.innerHTML = `
    <div class="cards">
      <div class="stat"><div class="num">€${Math.round(d.totals.planned).toLocaleString()}</div><div class="lbl">Total planned cost</div></div>
      <div class="stat"><div class="num">€${Math.round(d.totals.forecast).toLocaleString()}</div><div class="lbl">Forecast cost</div></div>
      <div class="stat"><div class="num">€${Math.round(d.totals.actual).toLocaleString()}</div><div class="lbl">Actual cost</div></div>
      <div class="stat"><div class="num" style="color:var(--warn)">€${Math.round(d.totals.deviations).toLocaleString()}</div><div class="lbl">Cost deviations (open)</div></div>
      <div class="stat"><div class="num">€${Math.round(d.sales_total).toLocaleString()}</div><div class="lbl">Sales total (${d.modules} module(s))</div></div>
    </div>
    <div class="card"><h3>Inputs (EUR)</h3>
      <div id="budget-inputs"></div>
      <h3 style="margin-top:16px">Payment milestones (cash in, % of sales price — services paid at final milestone)</h3>
      <div id="payments"></div>
      <h3 style="margin-top:16px">Cash out (mode: fixed € / pct_dm / pct_sales / spread over project time)</h3>
      <div id="cashout"></div>
      <h3 style="margin-top:16px">Budget deviations / unexpected costs</h3>
      <div id="deviations"></div>
      <div class="toolbar" style="margin-top:14px"><button class="btn accent" id="budget-save">Save budget</button>
      <span class="muted small">Sales price/module × ${d.modules} module(s).</span></div>
    </div>
    <div class="card"><h3>Cash flow per week (EUR)</h3>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:980px">
        <line x1="${padL}" y1="${zeroY}" x2="${W - 10}" y2="${zeroY}" stroke="#999"/>
        ${Array.from({ length: 5 }, (_, i) => {
          const v = maxV - i * (2 * maxV) / 4;
          return `<text x="4" y="${y(v) + 4}" font-size="10" fill="#6b7a8d">${Math.round(v / 1000)}k</text>
                  <line x1="${padL}" y1="${y(v)}" x2="${W - 10}" y2="${y(v)}" stroke="#eef2f6"/>`;
        }).join("")}
        ${barsIn}${barsOut}
        <path d="${line}" fill="none" stroke="#0b2545" stroke-width="2.5"/>
      </svg>
      <div class="legend"><span><span class="swatch" style="background:#3a9d5d"></span>cash in</span>
      <span><span class="swatch" style="background:#e63946"></span>cash out</span>
      <span><span class="swatch" style="background:#0b2545;height:3px"></span>cumulative cash flow</span></div>
    </div>`;
  document.getElementById("budget-inputs").innerHTML = formHTML([
    { key: "sales_price", label: "Sales price / module (€)", type: "number", step: "1000" },
    { key: "services_price", label: "Services price (€)", type: "number", step: "1000" },
    { key: "cogs_module", label: "Assumed COGS / module (€)", type: "number", step: "1000" },
    { key: "service_costs", label: "Service costs (€)", type: "number", step: "1000" },
    { key: "direct_material", label: "Direct material (€)", type: "number", step: "1000" },
  ], d.inputs);
  document.getElementById("payments").innerHTML = `<table><thead><tr>
      <th>#</th><th>Label</th><th>% of sales</th><th>Week</th><th>Paid</th><th></th></tr></thead><tbody>
      ${d.payments.map((p, i) => `<tr>
        <td>${i + 1}</td>
        <td><input name="plabel" value="${esc(p.label)}" data-i="${i}"></td>
        <td><input name="ppct" type="number" step="1" value="${p.pct}" data-i="${i}" style="width:70px"></td>
        <td><input name="pweek" type="number" value="${p.week}" data-i="${i}" style="width:70px"></td>
        <td><input name="ppaid" type="checkbox" data-i="${i}" ${p.paid ? "checked" : ""}></td>
        <td><button class="btn small danger" data-del-p="${i}">✕</button></td></tr>`).join("")}
      </tbody></table>
      <button class="btn small" id="add-payment" ${d.payments.length >= 5 ? "disabled" : ""}>+ milestone (max 5)</button>`;
  document.getElementById("cashout").innerHTML = `<table><thead><tr>
      <th>Week</th><th>Label</th><th>Mode</th><th>Cost (€)</th><th>% DM</th><th>% sales</th>
      <th>Planned (€)</th><th>Forecast (€)</th><th>Actual (€)</th><th></th></tr></thead><tbody>
      ${d.cashout.map((o, i) => `<tr>
        <td><input name="cweek" type="number" value="${o.week}" data-i="${i}" style="width:60px"></td>
        <td><input name="clabel" value="${esc(o.label)}" data-i="${i}"></td>
        <td><select name="cmode" data-i="${i}">${["fixed", "pct_dm", "pct_sales", "spread"].map(m => `<option value="${m}" ${o.mode === m ? "selected" : ""}>${m}</option>`).join("")}</select></td>
        <td><input name="ccost" type="number" step="100" value="${o.cost || ""}" data-i="${i}" style="width:90px"></td>
        <td><input name="cpct" type="number" step="1" value="${o.pct_of_dm ?? ""}" data-i="${i}" style="width:60px"></td>
        <td><input name="csales" type="number" step="0.1" value="${o.pct_of_sales ?? ""}" data-i="${i}" style="width:60px"></td>
        <td><input name="cplanned" type="number" step="100" value="${o.planned ?? ""}" data-i="${i}" style="width:90px"></td>
        <td><input name="cforecast" type="number" step="100" value="${o.forecast ?? ""}" data-i="${i}" style="width:90px"></td>
        <td><input name="cactual" type="number" step="100" value="${o.actual ?? ""}" data-i="${i}" style="width:90px"></td>
        <td><button class="btn small danger" data-del-c="${i}">✕</button></td></tr>`).join("")}
      </tbody></table>
      <button class="btn small" id="add-cashout">+ cash-out line</button>`;
  document.getElementById("deviations").innerHTML = `<table><thead><tr>
      <th>Description</th><th>Amount (€)</th><th>Status</th><th>Billable</th><th>Reference link</th><th></th></tr></thead><tbody>
      ${d.deviations.map((v, i) => `<tr>
        <td><input name="vdesc" value="${esc(v.description)}" data-i="${i}" style="width:100%"></td>
        <td><input name="vamount" type="number" step="100" value="${v.amount || ""}" data-i="${i}" style="width:90px"></td>
        <td><select name="vstatus" data-i="${i}">${["Request", "Approved", "Closed"].map(s => `<option ${v.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></td>
        <td><select name="vbillable" data-i="${i}">${["No", "Yes"].map(s => `<option ${v.billable === s ? "selected" : ""}>${s}</option>`).join("")}</select></td>
        <td><input name="vlink" value="${esc(v.ref_link)}" data-i="${i}" style="width:100%"></td>
        <td><button class="btn small danger" data-del-v="${i}">✕</button></td></tr>`).join("")}
      </tbody></table>
      <button class="btn small" id="add-deviation">+ deviation</button>`;
  const payments = [...d.payments];
  const cashout = [...d.cashout];
  const deviations = [...d.deviations];
  document.getElementById("add-payment").onclick = () => {
    if (payments.length >= 5) return;
    payments.push({ label: "", pct: 0, week: 0, paid: 0 });
    renderBudget(pid, c);
  };
  document.getElementById("add-cashout").onclick = () => {
    cashout.push({ week: 0, label: "", cost: 0, pct_of_dm: null, pct_of_sales: null, mode: "fixed", planned: 0, forecast: 0, actual: 0 });
    renderBudget(pid, c);
  };
  document.getElementById("add-deviation").onclick = () => {
    deviations.push({ description: "", amount: 0, status: "Request", billable: "No", ref_link: "" });
    renderBudget(pid, c);
  };
  document.querySelectorAll("[data-del-p]").forEach(b => b.onclick = () => { payments.splice(Number(b.dataset.delP), 1); renderBudget(pid, c); });
  document.querySelectorAll("[data-del-c]").forEach(b => b.onclick = () => { cashout.splice(Number(b.dataset.delC), 1); renderBudget(pid, c); });
  document.querySelectorAll("[data-del-v]").forEach(b => b.onclick = () => { deviations.splice(Number(b.dataset.delV), 1); renderBudget(pid, c); });
  const val = (name, i, fallback) => {
    const el = document.querySelector(`[name=${name}][data-i="${i}"]`);
    if (!el) return fallback;
    if (el.type === "checkbox") return el.checked;
    if (el.type === "number") return el.value === "" ? "" : Number(el.value);
    return el.value;
  };
  document.getElementById("budget-save").onclick = async () => {
    const inputs = collectForm(document.getElementById("budget-inputs"));
    const pm = payments.map((p, i) => ({ label: val("plabel", i, p.label), pct: val("ppct", i, p.pct), week: val("pweek", i, p.week), paid: val("ppaid", i, p.paid) }));
    const co = cashout.map((o, i) => ({
      week: val("cweek", i, o.week), label: val("clabel", i, o.label), mode: val("cmode", i, o.mode),
      cost: val("ccost", i, o.cost), pct_of_dm: val("cpct", i, o.pct_of_dm), pct_of_sales: val("csales", i, o.pct_of_sales),
      planned: val("cplanned", i, o.planned), forecast: val("cforecast", i, o.forecast), actual: val("cactual", i, o.actual),
    }));
    const dv = deviations.map((v, i) => ({
      description: val("vdesc", i, v.description), amount: val("vamount", i, v.amount),
      status: val("vstatus", i, v.status), billable: val("vbillable", i, v.billable), ref_link: val("vlink", i, v.ref_link),
    }));
    await api(`/projects/${pid}/budget`, { method: "PUT", body: { inputs, payments: pm, cashout: co, deviations: dv } });
    flash("Budget saved");
    render();
  };
}

async function renderDocuments(pid, c) {
  const docs = await api(`/projects/${pid}/documents`);
  const filtered = filterRows(docs, "docs", ["phase", "doc_name", "description", "consolidated", "code", "owner", "status"]);
  const active = filtered.filter(d => d.status !== "n/a");
  const na = filtered.filter(d => d.status === "n/a");
  const statusBadge = s => `<span class="badge ${({ Missing: "missing", "In progress": "inprogress", Uploaded: "uploaded", Done: "done", "n/a": "done" })[s] || "low"}">${esc(s)}</span>`;
  const flags = d => ["rina", "abs", "customer", "internal", "hard_copies"].filter(k => d[k] === "x" || d[k] === "R" || d[k] === "D").join(", ");
  const table = rows => `<table><thead><tr><th>Phase</th><th>Document</th><th>Status</th><th>Link</th>
      <th>Comment</th><th>Owner</th><th>Reviewer</th><th>Approver</th><th>Flags</th><th>Code</th><th></th></tr></thead>
      <tbody>${rows.map(d => `<tr>
        <td class="small muted">${esc(d.phase)}</td>
        <td>${esc(d.doc_name)}<br><span class="small muted">${esc(d.description)}</span></td>
        <td>${statusBadge(d.status)}</td>
        <td class="small">${d.link ? `<a href="${esc(d.link)}" target="_blank">link</a>` : ""}</td>
        <td class="small">${esc(d.comment || d.template || "")}</td>
        <td>${esc(d.owner)}</td><td>${esc(d.reviewer)}</td><td>${esc(d.approver)}</td>
        <td class="small">${esc(flags(d))}</td>
        <td class="wbs-code">${esc(d.consolidated || d.code)}</td>
        <td><button class="btn small edit-doc" data-id="${d.id}">Edit</button></td>
      </tr>`).join("") || '<tr><td colspan="11" class="muted">No documents.</td></tr>'}</tbody></table>`;
  c.innerHTML = `<div class="toolbar">
      <input id="docs-filter" placeholder="Filter documents…" value="${esc(state.filters.docs || "")}" style="width:220px">
      <button class="btn accent" id="add-doc">+ Add document to list</button>
      <span class="muted small">"n/a" documents are listed in a separate table at the bottom.</span>
    </div>
    <div class="card"><h3>Documents</h3>${table(active)}</div>
    ${na.length ? `<div class="card"><h3>n/a documents</h3>${table(na)}</div>` : ""}`;
  const filter = c.querySelector("#docs-filter");
  filter.oninput = () => { state.filters.docs = filter.value; renderDocuments(pid, c); };
  document.getElementById("add-doc").onclick = () => {
    modal("Add document to the list",
      `<p class="small">Documents added here become a master template and are added to <strong>all</strong> projects automatically.</p>` +
      formHTML([
        { key: "phase", label: "Project phase" }, { key: "consolidated", label: "Consolidated code" },
        { key: "code", label: "Code" }, { key: "description", label: "Description" },
        { key: "doc_name", label: "Document to upload" }, { key: "owner", label: "Owner" },
        { key: "reviewer", label: "Reviewer" }, { key: "approver", label: "Approver" },
        { key: "comment", label: "Comment" },
      ]), [
      { label: "Cancel", cls: "ghost", fn: closeModal },
      { label: "Add", cls: "accent", fn: async () => {
        const vals = collectForm(document.getElementById("modal-body"));
        await api("/document-templates", { method: "POST", body: vals });
        closeModal(); render();
      } },
    ]);
  };
  c.querySelectorAll(".edit-doc").forEach(b => b.onclick = () => {
    const d = docs.find(x => x.id === Number(b.dataset.id));
    editModal(`Edit document status — ${d.doc_name}`, [
      { key: "status", label: "Status", type: "select", options: ["Missing", "In progress", "Uploaded", "Done", "n/a"] },
      { key: "link", label: "Link / storage location" },
      { key: "comment", label: "Comment" },
    ], d, async vals => { await api(`/projects/${pid}/documents/${d.id}`, { method: "PUT", body: vals }); });
  });
}

async function renderContacts(pid, c) {
  let items = await api(`/projects/${pid}/contacts`);
  items = filterRows(items, "contacts", ["company", "first_name", "last_name", "role", "email"]);
  const sortKey = state.contactSort || "company";
  items = [...items].sort((a, b) => String(a[sortKey] || "").localeCompare(String(b[sortKey] || "")));
  const cols = [["company", "Company"], ["first_name", "First name"], ["last_name", "Last name"],
    ["role", "Role"], ["email", "Email"], ["phone", "Phone"], ["language", "Language"], ["contact_way", "Preferred contact"]];
  c.innerHTML = `<div class="toolbar">
      <input id="contact-filter" placeholder="Filter…" value="${esc(state.filters.contacts || "")}" style="width:220px">
      <button class="btn accent" id="contact-add">+ Add contact</button>
      <span class="muted small">Click a column header to sort.</span>
    </div>
    <div class="card"><table>
      <thead><tr>${cols.map(([k, label]) => `<th data-sort="${k}">${label}${state.contactSort === k ? " ▲" : ""}</th>`).join("")}<th></th></tr></thead>
      <tbody>${items.map(x => `<tr>
        <td>${esc(x.company)}</td><td>${esc(x.first_name)}</td><td>${esc(x.last_name)}</td>
        <td>${esc(x.role)}</td>
        <td>${x.email ? `<a href="mailto:${esc(x.email)}">${esc(x.email)}</a>` : ""}</td>
        <td>${esc(x.phone)}</td><td>${esc(x.language)}</td><td>${esc(x.contact_way)}</td>
        <td><button class="btn small edit-contact" data-id="${x.id}">Edit</button>
        <button class="btn small danger del-contact" data-id="${x.id}">✕</button></td>
      </tr>`).join("") || '<tr><td colspan="9" class="muted">No contacts.</td></tr>'}</tbody>
    </table></div>`;
  const filter = c.querySelector("#contact-filter");
  filter.oninput = () => { state.filters.contacts = filter.value; renderContacts(pid, c); };
  c.querySelectorAll("th[data-sort]").forEach(th => th.onclick = () => { state.contactSort = th.dataset.sort; render(); });
  const fields = cols.map(([k, label]) => ({ key: k, label }));
  c.querySelector("#contact-add").onclick = () =>
    editModal("Add contact", fields, {},
      async vals => { await api(`/projects/${pid}/contacts`, { method: "POST", body: vals }); });
  c.querySelectorAll(".edit-contact").forEach(b => b.onclick = () => {
    const x = items.find(y => y.id === Number(b.dataset.id));
    editModal("Edit contact", fields, x,
      async vals => { await api(`/projects/${pid}/contacts/${x.id}`, { method: "PUT", body: vals }); });
  });
  c.querySelectorAll(".del-contact").forEach(b => b.onclick = async () => {
    if (!confirm("Delete contact?")) return;
    await api(`/projects/${pid}/contacts/${b.dataset.id}`, { method: "DELETE" });
    render();
  });
}

async function renderClass(pid, c) {
  const d = await api(`/projects/${pid}/class`);
  const badge = s => `<span class="badge ${s === "Done" ? "done" : s === "In progress" ? "inprogress" : s === "N/A" ? "low" : "missing"}">${esc(s)}</span>`;
  c.innerHTML = `<div class="card">
      <h3>Class / PED checklist — ${esc(d.delivery_type)} delivery</h3>
      <p class="small muted">From the Library standard "Climeon Working Standard — Marine Classification &amp; PED Certification (HP300)" (Section 6). A stage closes only when its exit criteria are met and recorded in the approval log.</p>
      <table><thead><tr><th>Stage</th><th>Title</th><th>Timing / lead time</th><th>Owner</th>
        <th>Class / NoBo touchpoint</th><th>Exit criteria</th><th>Status</th><th>Comment</th><th></th></tr></thead>
      <tbody>${d.items.map(i => `<tr>
        <td>${i.stage}</td><td><strong>${esc(i.title)}</strong></td>
        <td class="small">${esc(i.timing)}</td><td>${esc(i.owner)}</td>
        <td class="small">${esc(i.touchpoint)}</td><td class="small">${esc(i.exit_criteria)}</td>
        <td>${badge(i.status)}</td><td class="small">${esc(i.comment)}</td>
        <td><button class="btn small edit-class" data-id="${i.id}">Edit</button></td>
      </tr>`).join("") || '<tr><td colspan="9" class="muted">No checklist items.</td></tr>'}</tbody></table>
    </div>`;
  c.querySelectorAll(".edit-class").forEach(b => b.onclick = () => {
    const item = d.items.find(x => x.id === Number(b.dataset.id));
    editModal(`Class checklist — Stage ${item.stage}: ${item.title}`, [
      { key: "status", label: "Status", type: "select", options: ["Not started", "In progress", "Done", "N/A"] },
      { key: "comment", label: "Comment / approval-log reference" },
    ], item, async vals => {
      await api(`/projects/${pid}/class/${item.id}`, { method: "PUT", body: vals });
    });
  });
}

async function renderLog(pid, c) {
  const rows = await api(`/projects/${pid}/log`);
  const filtered = filterRows(rows, "log", ["entity", "action", "detail", "changed_by"]);
  c.innerHTML = `<div class="toolbar">
      <input id="log-filter" placeholder="Filter log…" value="${esc(state.filters.log || "")}" style="width:220px">
    </div>
    <div class="card"><h3>Project change log</h3><table>
    <thead><tr><th>When</th><th>By</th><th>Area</th><th>Action</th><th>Detail</th></tr></thead>
    <tbody>${filtered.map(r => `<tr>
      <td class="small muted">${esc(r.changed_at)}</td><td>${esc(r.changed_by)}</td>
      <td>${esc(r.entity)} ${esc(r.entity_id)}</td><td>${esc(r.action)}</td>
      <td class="small">${esc(r.detail)}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">No changes yet.</td></tr>'}
    </tbody></table></div>`;
  const filter = c.querySelector("#log-filter");
  filter.oninput = () => { state.filters.log = filter.value; renderLog(pid, c); };
}

async function viewLibrary() {
  const files = await api("/library");
  main.innerHTML = `
    <h1>Library</h1>
    <div class="card"><p class="small muted">Storage for standard documents. Every upload automatically becomes a wiki chapter (text extracted from .docx/.txt/.md). Uploads and deletions require the library password.</p>
    <div class="toolbar">
      <input type="file" id="lib-file">
      <input type="password" id="lib-pass" placeholder="Library password">
      <button class="btn accent" id="lib-upload">Upload</button>
    </div>
    <table><thead><tr><th>File</th><th>Uploaded by</th><th>When</th><th>Size</th><th></th></tr></thead>
    <tbody>${files.map(f => `<tr>
      <td><a href="/api/library/file/${f.id}">${esc(f.filename)}</a></td>
      <td>${esc(f.uploaded_by)}</td><td class="small muted">${esc(f.uploaded_at)}</td>
      <td class="small">${(f.size / 1024).toFixed(1)} kB</td>
      <td><button class="btn small danger del-lib" data-id="${f.id}">Delete</button></td>
    </tr>`).join("") || '<tr><td colspan="5" class="muted">Library is empty.</td></tr>'}</tbody></table></div>`;
  document.getElementById("lib-upload").onclick = async () => {
    const file = document.getElementById("lib-file").files[0];
    const pass = document.getElementById("lib-pass").value;
    if (!file) return alert("Choose a file first");
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/library/upload", {
        method: "POST",
        headers: { "X-User-Name": state.user || "anonymous", "X-Library-Password": pass },
        body: fd,
      });
      if (res.status === 403) return alert("Invalid library password");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      flash(data.wiki_chapter_id ? "Uploaded — wiki chapter created" : "Uploaded");
      render();
    } catch (e) { alert(e.message); }
  };
  main.querySelectorAll(".del-lib").forEach(b => b.onclick = async () => {
    const pass = prompt("Library password to delete:");
    if (pass === null) return;
    try {
      await api(`/library/${b.dataset.id}`, { method: "DELETE", headers: { "X-Library-Password": pass } });
      flash("Deleted");
      render();
    } catch (e) { alert(e.message); }
  });
}

async function toggleWiki() {
  if (!wikiDrawer.classList.contains("hidden")) {
    wikiDrawer.classList.add("hidden");
    return;
  }
  const w = await api("/wiki");
  const section = (key, title) => `<details><summary>${esc(title)}</summary><ol>${
    w.content[key].items.map(i => `<li>${esc(i)}</li>`).join("")}</ol></details>`;
  const chapters = [...(w.chapters || [])].sort((a, b) => a.title.localeCompare(b.title));
  const sections = [["ce_approvals", "CE Approvals"], ["class_approvals", "Class Approvals"], ["gdpr", "GDPR Checklist"]];
  wikiDrawer.innerHTML = `
    <h2>Delivery Management Wiki</h2>
    <p class="small muted">Accessible from every page via this panel. Click a chapter to expand it.</p>
    ${sections.map(([k, t]) => section(k, t)).join("")}
    <details><summary>Lazydog — good-to-have links</summary>
      <table><thead><tr><th>Name</th><th>Description</th><th>Location</th><th>Link</th><th></th></tr></thead>
      <tbody id="lazydog-rows">${w.lazydog.map(l => `<tr>
        <td>${esc(l.name)}</td><td class="small">${esc(l.description)}</td>
        <td class="small">${esc(l.location)}</td><td class="small">${esc(l.link)}</td>
        <td><button class="btn small del-lazy" data-id="${l.id}">✕</button></td></tr>`).join("")}</tbody></table>
      <button class="btn small" id="add-lazy">+ add link</button>
    </details>
    <details><summary>Library documents</summary>
      <ul>${w.library_files.map(f => `<li><a href="/api/library/file/${f.id}">${esc(f.filename)}</a>
        <span class="small muted">— ${esc(f.uploaded_by)}, ${esc(f.uploaded_at)}</span></li>`).join("") || '<li class="muted">No files uploaded yet.</li>'}</ul>
    </details>
    ${chapters.map(ch => `<details><summary>${esc(ch.title)} <span class="small muted">wiki chapter</span></summary>
      <pre style="white-space:pre-wrap;font-size:12px;max-height:50vh;overflow:auto">${esc((ch.content || "").slice(0, 30000))}${(ch.content || "").length > 30000 ? "\n…[truncated]" : ""}</pre>
    </details>`).join("")}
    <button class="btn ghost" id="wiki-close" style="color:var(--navy);border-color:var(--line)">Close</button>`;
  wikiDrawer.classList.remove("hidden");
  document.getElementById("wiki-close").onclick = () => wikiDrawer.classList.add("hidden");
  document.getElementById("add-lazy").onclick = () =>
    editModal("Add Lazydog link", [
      { key: "name", label: "Name" }, { key: "description", label: "Description" },
      { key: "location", label: "Storage location" }, { key: "link", label: "Link" },
    ], {}, async vals => { await api("/lazydog", { method: "POST", body: vals }); toggleWiki(); toggleWiki(); });
  wikiDrawer.querySelectorAll(".del-lazy").forEach(b => b.onclick = async () => {
    await api(`/lazydog/${b.dataset.id}`, { method: "DELETE" });
    toggleWiki(); toggleWiki();
  });
}

async function pollRev() {
  try {
    const r = await api("/rev");
    if (state.rev !== -1 && r.rev !== state.rev) {
      const ae = document.activeElement;
      const editing = ae && ["INPUT", "TEXTAREA", "SELECT"].includes(ae.tagName);
      const modalOpen = !document.getElementById("modal-backdrop").classList.contains("hidden");
      if (!editing && !modalOpen) render();
    }
    state.rev = r.rev;
  } catch (e) { /* server not reachable yet */ }
}

document.getElementById("wiki-btn").onclick = toggleWiki;
document.getElementById("user-label").onclick = () => {
  const name = prompt("Your name:", state.user);
  if (name !== null && name.trim()) {
    state.user = name.trim();
    localStorage.setItem("dmt_user", state.user);
    document.getElementById("user-label").textContent = state.user;
  }
};
document.getElementById("user-label").textContent = state.user || "set name";
window.addEventListener("hashchange", render);
render();
setInterval(pollRev, 3000);
pollRev();
