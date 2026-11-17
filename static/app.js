"use strict";

const state = {
  rev: -1,
  user: localStorage.getItem("dmt_user") || "",
  sort: {},
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

// ---------------------------------------------------------------- modal

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

// ---------------------------------------------------------------- router

function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const parts = h.split("/").filter(Boolean);
  return parts;
}

async function render() {
  ensureUser();
  const parts = parseHash();
  renderSidebar(parts);
  try {
    if (parts.length === 0 || parts[0] === "portfolio") await viewPortfolio();
    else if (parts[0] === "library") await viewLibrary();
    else if (parts[0] === "project" && parts[1]) await viewProject(Number(parts[1]), parts[2] || "dashboard");
    else main.innerHTML = "<h1>Not found</h1>";
  } catch (e) {
    main.innerHTML = `<div class="card"><span class="err">${esc(e.message)}</span></div>`;
  }
}

function renderSidebar(parts) {
  let html = `<div class="nav-title">Tool</div>
    <a href="#/" class="${!parts[0] || parts[0] === "portfolio" ? "active" : ""}">Portfolio</a>
    <a href="#/library" class="${parts[0] === "library" ? "active" : ""}">Library</a>`;
  if (parts[0] === "project" && parts[1]) {
    const pid = parts[1];
    const tab = parts[2] || "dashboard";
    const tabs = [["dashboard", "Dashboard"], ["master", "Master Data"], ["wbs", "WBS"],
      ["timeline", "Timeline"], ["opl", "OPL"], ["budget", "Budget"],
      ["documents", "Documents"], ["contacts", "Contacts"], ["log", "Change Log"]];
    html += `<div class="nav-title">Delivery Project #${esc(pid)}</div>` +
      tabs.map(([k, label]) => `<a href="#/project/${pid}/${k}" class="${tab === k ? "active" : ""}">${label}</a>`).join("");
  }
  sidebar.innerHTML = html;
}

// ---------------------------------------------------------------- portfolio

async function viewPortfolio() {
  const projects = await api("/projects");
  main.innerHTML = `
    <h1>Portfolio Overview</h1>
    <div class="toolbar">
      <button class="btn accent" id="new-project">+ New Delivery Project</button>
      <span class="muted small">All delivery projects — click a row to enter the project dashboard.</span>
    </div>
    <div class="card">
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
            <td>${p.equipment === "HP300" ? esc(p.modules_count) : esc(p.modules_count)}</td>
            <td>${esc(p.module_type)}</td>
            <td>${esc(p.first_delivery_date)}</td>
            <td>${esc(p.last_delivery_date)}</td>
            <td>${p.open_points} ${p.blocked_points ? `(<span class="badge blocked">${p.blocked_points} blocked</span>)` : ""}</td>
            <td><a class="btn small" href="#/project/${p.id}/dashboard">Enter ▸</a></td>
          </tr>`).join("") || '<tr><td colspan="10" class="muted">No projects yet. Create the first one!</td></tr>'}
        </tbody>
      </table>
    </div>`;
  document.getElementById("new-project").onclick = () => newProjectModal();
}

const MASTER_FIELDS = [
  { key: "name", label: "Project name" },
  { key: "delivery_manager", label: "Delivery Project Manager" },
  { key: "customer", label: "Customer" },
  { key: "end_customer", label: "End customer" },
  { key: "delivery_type", label: "Delivery type", type: "select", options: ["Land", "Marine", "Retrofit"] },
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
  editModal("New Delivery Project", MASTER_FIELDS, { modules_count: 1, status: "Ongoing" },
    async vals => {
      vals.status = "Ongoing";
      const r = await api("/projects", { method: "POST", body: vals });
      location.hash = `#/project/${r.id}/dashboard`;
    });
}

// ---------------------------------------------------------------- project shell

async function viewProject(pid, tab) {
  const p = await api(`/projects/${pid}`);
  const tabs = [["dashboard", "Dashboard"], ["master", "Master Data"], ["wbs", "WBS"],
    ["timeline", "Timeline"], ["opl", "OPL"], ["budget", "Budget"],
    ["documents", "Documents"], ["contacts", "Contacts"], ["log", "Change Log"]];
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
        <tr><td class="muted">Contract date</td><td>${esc(d.project.contract_date)}</td>
            <td class="muted">HP300 version</td><td>${esc(d.project.module_type)}</td></tr>
        <tr><td class="muted">First delivery</td><td>${esc(d.project.first_delivery_date)}</td>
            <td class="muted">Last delivery</td><td>${esc(d.project.last_delivery_date)}</td></tr>
      </tbody></table>
      <p class="small muted">Open the <a href="#/project/${pid}/timeline">Timeline</a>,
      <a href="#/project/${pid}/opl">OPL</a> or <a href="#/project/${pid}/log">Change Log</a> from the tabs above.</p>
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

// ---------------------------------------------------------------- WBS

async function renderWbs(pid, c) {
  const items = await api(`/projects/${pid}/wbs`);
  const depth = code => code.split(".").length;
  c.innerHTML = `<div class="toolbar">
      <button class="btn accent" id="wbs-add-root">+ Add item</button>
      <span class="muted small">WBS numbered a.b.c.d — phases → gates → milestones → activities. Editable per project.</span>
    </div>
    <div class="card"><table>
      <thead><tr><th>Code</th><th>Type</th><th>Name</th><th>Owner</th><th>Doc ref</th>
        <th>Planned</th><th>Actual</th><th>Status</th><th></th></tr></thead>
      <tbody>${items.map(w => `<tr class="${w.item_type}-row">
        <td class="wbs-code">${esc(w.code)}</td>
        <td>${esc(w.item_type)}</td>
        <td style="padding-left:${depth(w.code) * 14}px">${esc(w.name)}</td>
        <td>${esc(w.owner)}</td><td class="small muted">${esc(w.doc_ref)}</td>
        <td>${esc(w.planned_date)}</td><td>${esc(w.actual_date)}</td>
        <td><span class="badge ${w.status === "Done" ? "done" : w.status === "In progress" ? "inprogress" : "low"}">${esc(w.status)}</span></td>
        <td>
          ${w.item_type !== "phase" ? `<button class="btn small ghost2 add-child" data-id="${w.id}" data-code="${esc(w.code)}">+ child</button>` : ""}
          <button class="btn small edit-wbs" data-id="${w.id}">Edit</button>
          <button class="btn small danger del-wbs" data-id="${w.id}">✕</button>
        </td></tr>`).join("")}</tbody>
    </table></div>`;
  c.querySelector("#wbs-add-root").onclick = () =>
    editModal("Add WBS item", [
      { key: "item_type", label: "Type", type: "select", options: ["phase", "gate", "milestone", "activity"] },
      { key: "name", label: "Name" }, { key: "owner", label: "Owner" },
      { key: "doc_ref", label: "Document reference" }], {},
      async vals => { await api(`/projects/${pid}/wbs`, { method: "POST", body: vals }); });
  c.querySelectorAll(".add-child").forEach(b => b.onclick = () =>
    editModal("Add child item", [
      { key: "item_type", label: "Type", type: "select", options: ["gate", "milestone", "activity"] },
      { key: "name", label: "Name" }, { key: "owner", label: "Owner" },
      { key: "doc_ref", label: "Document reference" }], { parent_code: b.dataset.code },
      async vals => { await api(`/projects/${pid}/wbs`, { method: "POST", body: vals }); }));
  c.querySelectorAll(".edit-wbs").forEach(b => b.onclick = async () => {
    const w = items.find(x => x.id === Number(b.dataset.id));
    editModal(`Edit ${w.code}`, [
      { key: "name", label: "Name" }, { key: "owner", label: "Owner" },
      { key: "doc_ref", label: "Document reference" },
      { key: "planned_date", label: "Planned date", type: "date" },
      { key: "actual_date", label: "Actual date", type: "date" },
      { key: "status", label: "Status", type: "select", options: ["Not started", "In progress", "Done", "Blocked"] },
    ], w, async vals => { await api(`/projects/${pid}/wbs/${w.id}`, { method: "PUT", body: vals }); });
  });
  c.querySelectorAll(".del-wbs").forEach(b => b.onclick = async () => {
    if (!confirm("Delete this WBS item?")) return;
    await api(`/projects/${pid}/wbs/${b.dataset.id}`, { method: "DELETE" });
    render();
  });
}

// ---------------------------------------------------------------- timeline

let ganttZoom = 10; // px per week

async function renderTimeline(pid, c) {
  const data = await api(`/projects/${pid}/timeline?module=${state.moduleIdx || 0}`);
  const modules = (await api(`/projects/${pid}`)).modules_count || 1;
  const maxWeek = Math.max(82, ...data.milestones.map(m => m.week_offset + 4 * (state.moduleIdx || 0))) + 4;
  const pw = ganttZoom;
  const headTicks = [];
  for (let w = 0; w <= maxWeek; w++) {
    if (pw >= 14 || w % 4 === 0) headTicks.push(`<div class="gantt-tick" style="width:${pw}px">W${w}</div>`);
  }
  const rows = data.milestones.map((m, i) => {
    const prev = i > 0 ? data.milestones[i - 1].week_offset + 4 * (state.moduleIdx || 0) : 0;
    const wk = m.week_offset + 4 * (state.moduleIdx || 0);
    const due = m.due_date || m.computed_due_date;
    const bar = `<div class="gantt-bar ${m.done ? "done" : ""}" style="left:${prev * pw}px;width:${Math.max((wk - prev), 1) * pw}px" title="${esc(m.name)} — ${esc(due)}"></div>`;
    const dia = `<div class="gantt-diamond ${m.done ? "done" : ""}" style="left:${wk * pw - 9}px" title="M${m.milestone_no} ${esc(m.name)} — due ${esc(due)}" data-mno="${m.milestone_no}"></div>`;
    return `<div class="gantt-row"><div class="gantt-label" title="${esc(m.name)}">M${m.milestone_no} ${esc(m.name)} <span class="muted small">${esc(due)}${m.done ? " ✓" : ""}</span></div>
      <div class="gantt-track">${bar}${dia}</div></div>`;
  });
  const critLane = `<div class="gantt-row"><div class="gantt-label" style="color:var(--danger)">⚠ Critical OPL</div>
    <div class="gantt-track">${data.critical_opl.map(o => {
      const d = new Date(o.due_date);
      const base = data.contract_date ? new Date(data.contract_date) : null;
      const wk = base && d >= base ? Math.round((d - base) / (7 * 864e5)) : 0;
      return `<div class="gantt-diamond critical" style="left:${wk * pw - 11}px" title="#${o.number} ${esc(o.description)} — due ${esc(o.due_date)} (click to open)" data-opl="${o.id}"></div>`;
    }).join("")}</div></div>`;
  c.innerHTML = `<div class="toolbar">
      <label class="small muted">Module:
        <select id="module-sel">${Array.from({ length: modules }, (_, i) =>
          `<option value="${i}" ${i === (state.moduleIdx || 0) ? "selected" : ""}>Module ${i + 1}${i ? ` (+${4 * i} weeks)` : ""}</option>`).join("")}</select></label>
      <span class="muted small">Zoom:</span>
      <button class="btn small" data-zoom="6">−</button>
      <button class="btn small" data-zoom="10">•</button>
      <button class="btn small" data-zoom="20">+</button>
      <span class="muted small">Dates based on contract date ${esc(data.contract_date || "—")}; each extra module shifts milestones +4 weeks (up to M14). Click a diamond to edit the milestone.</span>
    </div>
    <div class="gantt-wrap"><div class="gantt" style="min-width:${260 + (maxWeek + 1) * pw}px">
      <div class="gantt-head"><div class="gantt-label">Milestone</div><div style="display:flex">${headTicks.join("")}</div></div>
      ${rows.join("")}${critLane}
    </div></div>
    <div class="legend"><span><span class="swatch" style="background:var(--navy-2)"></span>planned span</span>
      <span><span class="swatch" style="background:var(--navy);transform:rotate(45deg)"></span>milestone due</span>
      <span><span class="swatch" style="background:var(--ok)"></span>done</span>
      <span><span class="swatch" style="background:var(--danger);transform:rotate(45deg)"></span>critical OPL at due date (clickable)</span></div>`;
  c.querySelector("#module-sel").onchange = e => { state.moduleIdx = Number(e.target.value); render(); };
  c.querySelectorAll("[data-zoom]").forEach(b => b.onclick = () => { ganttZoom = Number(b.dataset.zoom); render(); });
  c.querySelectorAll(".gantt-diamond[data-mno]").forEach(d => d.onclick = () => {
    const m = data.milestones.find(x => x.milestone_no === Number(d.dataset.mno));
    modal(`Milestone M${m.milestone_no} — ${esc(m.name)}`, formHTML([
      { key: "due_date", label: "Due date", type: "date" },
      { key: "done", label: "Done", type: "select", options: ["No", "Yes"] },
    ], { due_date: m.due_date, done: m.done ? "Yes" : "No" }), [
      { label: "Cancel", cls: "ghost", fn: closeModal },
      { label: "Save", cls: "accent", fn: async () => {
        const vals = collectForm(document.getElementById("modal-body"));
        await api(`/projects/${pid}/timeline/${m.milestone_no}`, {
          method: "PUT", body: { due_date: vals.due_date, done: vals.done === "Yes" } });
        closeModal(); render();
      } },
    ]);
  });
  c.querySelectorAll(".gantt-diamond[data-opl]").forEach(d => d.onclick = () => {
    location.hash = `#/project/${pid}/opl`;
    state.highlightOpl = Number(d.dataset.opl);
  });
}

// ---------------------------------------------------------------- OPL

async function renderOpl(pid, c) {
  const items = await api(`/projects/${pid}/opl`);
  c.innerHTML = `<div class="toolbar">
      <button class="btn accent" id="opl-add">+ Add open point</button>
      <span class="muted small">Critical points appear as red diamonds on the timeline at their due date.</span>
    </div>
    <div class="card"><table>
      <thead><tr><th>#</th><th>Status</th><th>Open point</th><th>Assigned to</th><th>Start</th>
        <th>Due</th><th>Duration (days)</th><th>Priority</th><th>Blocker</th><th></th></tr></thead>
      <tbody>${items.map(o => `<tr ${state.highlightOpl === o.id ? 'style="background:#fdecec"' : ""}>
        <td>${o.number}</td>
        <td><span class="badge ${esc(o.status.toLowerCase())}">${esc(o.status)}</span></td>
        <td>${esc(o.description)}</td><td>${esc(o.assignee)}</td>
        <td>${esc(o.start_date)}</td><td>${esc(o.due_date)}</td>
        <td>${o.duration_days ?? ""}</td>
        <td><span class="badge ${esc(o.priority.toLowerCase())}">${esc(o.priority)}</span></td>
        <td class="small">${esc(o.blocker)}</td>
        <td><button class="btn small edit-opl" data-id="${o.id}">Edit</button>
        <button class="btn small danger del-opl" data-id="${o.id}">✕</button></td>
      </tr>`).join("") || '<tr><td colspan="10" class="muted">No open points yet.</td></tr>'}</tbody>
    </table></div>`;
  state.highlightOpl = null;
  const fields = [
    { key: "status", label: "Status", type: "select", options: ["Open", "Closed", "Delayed", "Blocked"] },
    { key: "description", label: "Open point" },
    { key: "assignee", label: "Assigned to" },
    { key: "start_date", label: "Start date", type: "date" },
    { key: "due_date", label: "Due date", type: "date" },
    { key: "priority", label: "Priority", type: "select", options: ["Low", "Mid", "High", "Critical"] },
    { key: "blocker", label: "Blocker (if applicable)" },
  ];
  c.querySelector("#opl-add").onclick = () =>
    editModal("Add open point", fields, { status: "Open", priority: "Mid" },
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

// ---------------------------------------------------------------- budget

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
    <div class="card"><h3>Inputs (EUR)</h3>
      <div id="budget-inputs"></div>
      <h3 style="margin-top:16px">Payment milestones (cash in, % of sales price — services paid at final milestone)</h3>
      <div id="payments"></div>
      <h3 style="margin-top:16px">Cash out (COGS by week; % values are % of direct material)</h3>
      <div id="cashout"></div>
      <div class="toolbar" style="margin-top:14px"><button class="btn accent" id="budget-save">Save budget</button>
      <span class="muted small">Sales price/module × ${d.modules} module(s) = €${d.sales_total.toLocaleString()} total.</span></div>
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
      <th>#</th><th>Label</th><th>% of sales</th><th>Week</th><th></th></tr></thead><tbody>
      ${d.payments.map((p, i) => `<tr>
        <td>${i + 1}</td>
        <td><input name="plabel" value="${esc(p.label)}" data-i="${i}"></td>
        <td><input name="ppct" type="number" step="1" value="${p.pct}" data-i="${i}" style="width:70px"></td>
        <td><input name="pweek" type="number" value="${p.week}" data-i="${i}" style="width:70px"></td>
        <td><button class="btn small danger" data-del-p="${i}">✕</button></td></tr>`).join("")}
      </tbody></table>
      <button class="btn small" id="add-payment" ${d.payments.length >= 5 ? "disabled" : ""}>+ milestone (max 5)</button>`;
  document.getElementById("cashout").innerHTML = `<table><thead><tr>
      <th>Week</th><th>Label</th><th>Cost (€)</th><th>or % of direct material</th><th></th></tr></thead><tbody>
      ${d.cashout.map((o, i) => `<tr>
        <td><input name="cweek" type="number" value="${o.week}" data-i="${i}" style="width:70px"></td>
        <td><input name="clabel" value="${esc(o.label)}" data-i="${i}"></td>
        <td><input name="ccost" type="number" step="1000" value="${o.cost || ""}" data-i="${i}" style="width:100px"></td>
        <td><input name="cpct" type="number" step="1" value="${o.pct_of_dm ?? ""}" data-i="${i}" style="width:80px"></td>
        <td><button class="btn small danger" data-del-c="${i}">✕</button></td></tr>`).join("")}
      </tbody></table>
      <button class="btn small" id="add-cashout">+ cash-out line</button>`;
  const payments = [...d.payments];
  const cashout = [...d.cashout];
  document.getElementById("add-payment").onclick = () => {
    if (payments.length >= 5) return;
    payments.push({ label: "", pct: 0, week: 0 });
    renderBudget(pid, c);
  };
  document.getElementById("add-cashout").onclick = () => {
    cashout.push({ week: 0, label: "", cost: 0, pct_of_dm: null });
    renderBudget(pid, c);
  };
  document.querySelectorAll("[data-del-p]").forEach(b => b.onclick = () => { payments.splice(Number(b.dataset.delP), 1); renderBudget(pid, c); });
  document.querySelectorAll("[data-del-c]").forEach(b => b.onclick = () => { cashout.splice(Number(b.dataset.delC), 1); renderBudget(pid, c); });
  document.getElementById("budget-save").onclick = async () => {
    const inputs = collectForm(document.getElementById("budget-inputs"));
    const pm = payments.map((p, i) => ({
      label: document.querySelector(`input[name=plabel][data-i="${i}"]`)?.value ?? p.label,
      pct: Number(document.querySelector(`input[name=ppct][data-i="${i}"]`)?.value ?? p.pct),
      week: Number(document.querySelector(`input[name=pweek][data-i="${i}"]`)?.value ?? p.week),
    }));
    const co = cashout.map((o, i) => ({
      week: Number(document.querySelector(`input[name=cweek][data-i="${i}"]`)?.value ?? o.week),
      label: document.querySelector(`input[name=clabel][data-i="${i}"]`)?.value ?? o.label,
      cost: Number(document.querySelector(`input[name=ccost][data-i="${i}"]`)?.value ?? o.cost),
      pct_of_dm: document.querySelector(`input[name=cpct][data-i="${i}"]`)?.value ?? null,
    }));
    await api(`/projects/${pid}/budget`, { method: "PUT", body: { inputs, payments: pm, cashout: co } });
    flash("Budget saved");
    render();
  };
}

// ---------------------------------------------------------------- documents

async function renderDocuments(pid, c) {
  const docs = await api(`/projects/${pid}/documents`);
  const statusBadge = s => `<span class="badge ${esc({ Missing: "missing", "In progress": "inprogress", Uploaded: "uploaded", Done: "done" }[s] || "low")}">${esc(s)}</span>`;
  c.innerHTML = `<div class="toolbar">
      <button class="btn accent" id="add-doc">+ Add document to list</button>
      <span class="muted small">Checklist of all documents needed in the project, per phase/gate.</span>
    </div>
    <div class="card"><table>
      <thead><tr><th>Phase</th><th>Code</th><th>Document</th><th>Owner</th><th>Reviewer</th>
        <th>Approver</th><th>Flags</th><th>Gates</th><th>Status</th><th>Link</th><th>Comment</th><th></th></tr></thead>
      <tbody>${docs.map(d => `<tr>
        <td class="small muted">${esc(d.phase)}</td>
        <td class="wbs-code">${esc(d.consolidated || d.code)}</td>
        <td>${esc(d.doc_name)}<br><span class="small muted">${esc(d.description)}</span></td>
        <td>${esc(d.owner)}</td><td>${esc(d.reviewer)}</td><td>${esc(d.approver)}</td>
        <td class="small">${["rina", "abs", "customer", "internal", "hard_copies"].filter(k => d[k] === "x" || d[k] === "R" || d[k] === "D").map(k => esc(k)).join(", ")}</td>
        <td class="small">${["gate1", "gate2", "gate3", "gate4", "gate5"].filter((k, i) => d[k]).map((k, i) => esc(d[k])).join(", ")}</td>
        <td>${statusBadge(d.status)}</td>
        <td class="small">${d.link ? `<a href="${esc(d.link)}" target="_blank">link</a>` : ""}</td>
        <td class="small">${esc(d.comment || d.template || "")}</td>
        <td><button class="btn small edit-doc" data-id="${d.id}">Edit</button></td>
      </tr>`).join("")}</tbody>
    </table></div>`;
  document.getElementById("add-doc").onclick = () => {
    modal("Add document to the list",
      `<p class="small">Documents added here are created as a new master template and are added to <strong>all</strong> projects automatically.</p>` +
      formHTML([
        { key: "phase", label: "Project phase" },
        { key: "consolidated", label: "Consolidated code" },
        { key: "code", label: "Code" },
        { key: "description", label: "Description" },
        { key: "doc_name", label: "Document to upload" },
        { key: "owner", label: "Owner" },
        { key: "reviewer", label: "Reviewer" },
        { key: "approver", label: "Approver" },
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
      { key: "status", label: "Status", type: "select", options: ["Missing", "In progress", "Uploaded", "Done"] },
      { key: "link", label: "Link / storage location" },
      { key: "comment", label: "Comment" },
    ], d, async vals => { await api(`/projects/${pid}/documents/${d.id}`, { method: "PUT", body: vals }); });
  });
}

// ---------------------------------------------------------------- contacts

async function renderContacts(pid, c) {
  let items = await api(`/projects/${pid}/contacts`);
  const q = (state.contactFilter || "").toLowerCase();
  if (q) items = items.filter(x => [x.company, x.first_name, x.last_name, x.role, x.email]
    .join(" ").toLowerCase().includes(q));
  const sortKey = state.contactSort || "company";
  items = [...items].sort((a, b) => String(a[sortKey] || "").localeCompare(String(b[sortKey] || "")));
  const cols = [["company", "Company"], ["first_name", "First name"], ["last_name", "Last name"],
    ["role", "Role"], ["email", "Email"], ["phone", "Phone"], ["language", "Language"], ["contact_way", "Preferred contact"]];
  c.innerHTML = `<div class="toolbar">
      <input id="contact-filter" placeholder="Filter…" value="${esc(state.contactFilter || "")}" style="width:220px">
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
  filter.oninput = () => { state.contactFilter = filter.value; renderContacts(pid, c); };
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

// ---------------------------------------------------------------- log

async function renderLog(pid, c) {
  const rows = await api(`/projects/${pid}/log`);
  c.innerHTML = `<div class="card"><h3>Project change log</h3><table>
    <thead><tr><th>When</th><th>By</th><th>Area</th><th>Action</th><th>Detail</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td class="small muted">${esc(r.changed_at)}</td><td>${esc(r.changed_by)}</td>
      <td>${esc(r.entity)} ${esc(r.entity_id)}</td><td>${esc(r.action)}</td>
      <td class="small">${esc(r.detail)}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">No changes yet.</td></tr>'}
    </tbody></table></div>`;
}

// ---------------------------------------------------------------- library

async function viewLibrary() {
  const files = await api("/library");
  main.innerHTML = `
    <h1>Library</h1>
    <div class="card"><p class="small muted">Storage for standard documents (charters, checklists, instructions).
    Uploaded files become wiki chapters. Uploads and deletions require the library password.</p>
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
      flash("Uploaded");
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

// ---------------------------------------------------------------- wiki drawer

async function toggleWiki() {
  if (!wikiDrawer.classList.contains("hidden")) {
    wikiDrawer.classList.add("hidden");
    return;
  }
  const w = await api("/wiki");
  const section = (key, title) => `<details open><summary>${esc(title)}</summary><ol>${
    w.content[key].items.map(i => `<li>${esc(i)}</li>`).join("")}</ol></details>`;
  wikiDrawer.innerHTML = `
    <h2>Delivery Management Wiki</h2>
    <p class="small muted">Accessible from every page via this panel.</p>
    ${section("gdpr", "GDPR Checklist")}
    ${section("class_approvals", "Class Approvals")}
    ${section("ce_approvals", "CE Approvals")}
    <details open><summary>Lazydog — good-to-have links</summary>
      <table><thead><tr><th>Name</th><th>Description</th><th>Location</th><th>Link</th><th></th></tr></thead>
      <tbody id="lazydog-rows">${w.lazydog.map(l => `<tr>
        <td>${esc(l.name)}</td><td class="small">${esc(l.description)}</td>
        <td class="small">${esc(l.location)}</td><td class="small">${esc(l.link)}</td>
        <td><button class="btn small del-lazy" data-id="${l.id}">✕</button></td></tr>`).join("")}</tbody></table>
      <button class="btn small" id="add-lazy">+ add link</button>
    </details>
    <details><summary>Library documents (wiki chapters)</summary>
      <ul>${w.library_files.map(f => `<li><a href="/api/library/file/${f.id}">${esc(f.filename)}</a>
        <span class="small muted">— ${esc(f.uploaded_by)}, ${esc(f.uploaded_at)}</span></li>`).join("") || '<li class="muted">No files uploaded yet.</li>'}</ul>
    </details>
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

// ---------------------------------------------------------------- live updates

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

// ---------------------------------------------------------------- boot

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
