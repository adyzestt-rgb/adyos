/* =========================================================
   AdyOS — script.js
   Vanilla JS Personal Productivity System
   ========================================================= */

(() => {
  "use strict";

  /* ============ CONSTANTS ============ */
  const STORAGE_KEY = "adyos_v1";
  const XP_MAP = { easy: 10, medium: 25, hard: 50 };
  const XP_PER_LEVEL = 100;
  const DAY_MS = 86400000;

  const DEFAULT_TASKS = [
    { name: "DSA", category: "Study", priority: "hard", notes: "" },
    { name: "Web Development", category: "Study", priority: "hard", notes: "" },
    { name: "English", category: "Study", priority: "medium", notes: "" },
    { name: "Gym", category: "Health", priority: "medium", notes: "" },
    { name: "Project", category: "Work", priority: "hard", notes: "" },
    { name: "College Study", category: "Study", priority: "medium", notes: "" },
    { name: "Reading", category: "Growth", priority: "easy", notes: "" },
    { name: "Meditation", category: "Health", priority: "easy", notes: "" },
  ];

  /* ============ UTILITIES ============ */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const uid = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function formatDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  function todayKey() { return formatDateKey(new Date()); }
  function keyToDate(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function prettyDate(key, opts = {}) {
    const d = keyToDate(key);
    return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", ...opts });
  }
  function weekday(key) {
    return keyToDate(key).toLocaleDateString("en-US", { weekday: "long" });
  }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  /* ============ STATE ============ */
  let state = null;

  function defaultState() {
    const tasks = DEFAULT_TASKS.map((t, i) => ({ id: uid(), order: i, isDefault: true, ...t }));
    const today = todayKey();
    const dayTasks = tasks.map(t => ({ ...t, completed: false }));
    return {
      tasks,
      days: {
        [today]: { date: today, tasks: dayTasks, completedCount: 0, totalCount: dayTasks.length, score: 0 },
      },
      currentDate: today,
      xpTotal: 0,
      settings: { theme: "dark", accent: "#22C55E" },
      pomodoro: { sessionsDate: today, sessions: 0 },
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!parsed.tasks || !parsed.days) return defaultState();
      return parsed;
    } catch (e) {
      console.error("AdyOS: failed to load state", e);
      return defaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error("AdyOS: failed to save state", e);
      toast("⚠️ Could not save data (storage full?)");
    }
  }

  /* ============ DAY MANAGEMENT / AUTO NEW DAY ============ */
  function recalcDayStats(dayKey) {
    const day = state.days[dayKey];
    if (!day) return;
    day.totalCount = day.tasks.length;
    day.completedCount = day.tasks.filter(t => t.completed).length;
    day.score = day.tasks.filter(t => t.completed).reduce((s, t) => s + (XP_MAP[t.priority] || 0), 0);
  }

  function ensureToday() {
    const key = todayKey();
    if (state.currentDate !== key) {
      // date has rolled over — yesterday (state.currentDate) becomes permanent history (already stored)
      state.currentDate = key;
    }
    if (!state.days[key]) {
      const dayTasks = state.tasks
        .slice()
        .sort((a, b) => a.order - b.order)
        .map(t => ({ id: t.id, name: t.name, category: t.category, priority: t.priority, notes: t.notes, completed: false }));
      state.days[key] = { date: key, tasks: dayTasks, completedCount: 0, totalCount: dayTasks.length, score: 0 };
      saveState();
    }
    if (state.pomodoro.sessionsDate !== key) {
      state.pomodoro.sessionsDate = key;
      state.pomodoro.sessions = 0;
      saveState();
    }
    return state.days[key];
  }

  /* ============ STREAK & XP ============ */
  function computeStreak() {
    const key = todayKey();
    let streak = 0;
    let cursor = keyToDate(key);
    let first = true;
    while (true) {
      const k = formatDateKey(cursor);
      const day = state.days[k];
      const active = day && day.completedCount > 0;
      if (k === key) {
        if (active) streak++;
        cursor = new Date(cursor.getTime() - DAY_MS);
        first = false;
        continue;
      }
      if (active) {
        streak++;
        cursor = new Date(cursor.getTime() - DAY_MS);
      } else break;
    }
    return streak;
  }

  function computeLevel() {
    const level = Math.floor(state.xpTotal / XP_PER_LEVEL) + 1;
    const into = state.xpTotal % XP_PER_LEVEL;
    return { level, into, needed: XP_PER_LEVEL };
  }

  /* ============ TASK CRUD ============ */
  function addTask({ name, category, priority, notes }) {
    const order = state.tasks.length ? Math.max(...state.tasks.map(t => t.order)) + 1 : 0;
    const task = { id: uid(), name, category: category || "General", priority, notes: notes || "", order, isDefault: false };
    state.tasks.push(task);
    const day = ensureToday();
    day.tasks.push({ id: task.id, name: task.name, category: task.category, priority: task.priority, notes: task.notes, completed: false });
    recalcDayStats(day.date);
    saveState();
    toast(`✅ "${name}" added`);
  }

  function updateTask(id, { name, category, priority, notes }) {
    const master = state.tasks.find(t => t.id === id);
    if (master) {
      master.name = name; master.category = category || "General"; master.priority = priority; master.notes = notes || "";
    }
    const day = state.days[todayKey()];
    if (day) {
      const dt = day.tasks.find(t => t.id === id);
      if (dt) { dt.name = name; dt.category = category || "General"; dt.priority = priority; dt.notes = notes || ""; }
      recalcDayStats(day.date);
    }
    saveState();
    toast(`✏️ "${name}" updated`);
  }

  function deleteTask(id) {
    const t = state.tasks.find(t => t.id === id);
    state.tasks = state.tasks.filter(t => t.id !== id);
    const day = state.days[todayKey()];
    if (day) {
      day.tasks = day.tasks.filter(t => t.id !== id);
      recalcDayStats(day.date);
    }
    saveState();
    toast(`🗑️ "${t ? t.name : "Task"}" deleted`);
  }

  function reorderMasterTasks(orderedIds) {
    orderedIds.forEach((id, idx) => {
      const t = state.tasks.find(t => t.id === id);
      if (t) t.order = idx;
    });
    const day = state.days[todayKey()];
    if (day) {
      day.tasks.sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id));
    }
    saveState();
  }

  function toggleComplete(dayKey, taskId, checkboxEl) {
    const day = state.days[dayKey];
    if (!day) return;
    const t = day.tasks.find(t => t.id === taskId);
    if (!t) return;
    const wasCompleted = t.completed;
    t.completed = !t.completed;
    const xpDelta = XP_MAP[t.priority] || 0;
    if (dayKey === todayKey()) {
      state.xpTotal = clamp(state.xpTotal + (t.completed ? xpDelta : -xpDelta), 0, Infinity);
    }
    recalcDayStats(dayKey);
    saveState();

    if (checkboxEl) {
      checkboxEl.classList.toggle("checked", t.completed);
    }
    if (t.completed && !wasCompleted) {
      toast(`+${xpDelta} XP · ${t.name} completed`, true);
    }
    renderDashboardStats();
    renderSidebarStreak();
    if (currentView === "tasks") renderTasksView();
    if (currentView === "dashboard") renderTodayList();
  }

  /* ============ TOASTS ============ */
  function toast(msg, isXp = false) {
    const container = $("#toastContainer");
    const el = document.createElement("div");
    el.className = "toast" + (isXp ? " xp" : "");
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 320);
    }, 2600);
  }

  /* ============ RIPPLE ============ */
  function attachRipple(btn) {
    btn.addEventListener("click", function (e) {
      const rect = btn.getBoundingClientRect();
      const ripple = document.createElement("span");
      ripple.className = "ripple";
      const size = Math.max(rect.width, rect.height);
      ripple.style.width = ripple.style.height = size + "px";
      ripple.style.left = (e.clientX - rect.left - size / 2) + "px";
      ripple.style.top = (e.clientY - rect.top - size / 2) + "px";
      btn.appendChild(ripple);
      setTimeout(() => ripple.remove(), 650);
    });
  }

  /* ============ NAVIGATION ============ */
  let currentView = "dashboard";
  function switchView(view) {
    currentView = view;
    $$(".view").forEach(v => v.classList.remove("active"));
    $(`#view-${view}`).classList.add("active");
    $$(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.view === view));
    $("#sidebar").classList.remove("open");
    if (view === "tasks") renderTasksView();
    if (view === "history") renderHistoryView();
    if (view === "analytics") renderAnalytics();
    if (view === "calendar") renderCalendar();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ============ DASHBOARD RENDER ============ */
  function renderGreetingClock() {
    const now = new Date();
    const h = now.getHours();
    const greet = h < 12 ? "Good Morning" : h < 18 ? "Good Afternoon" : "Good Evening";
    $("#greetingText").textContent = `${greet} 👋`;
    $("#dateText").textContent = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    $("#timeText").textContent = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  }

  function renderDashboardStats() {
    const day = ensureToday();
    const pct = day.totalCount ? Math.round((day.completedCount / day.totalCount) * 100) : 0;
    $("#progressPercent").textContent = pct + "%";
    $("#progressFraction").textContent = `${day.completedCount} / ${day.totalCount} tasks`;
    const circumference = 326.7;
    $("#ringFg").style.strokeDashoffset = circumference - (circumference * pct) / 100;

    $("#todayScore").textContent = day.score;

    const streak = computeStreak();
    $("#streakVal").textContent = streak;

    const { level, into, needed } = computeLevel();
    $("#levelVal").textContent = level;
    $("#xpVal").textContent = into;
    $("#xpNeeded").textContent = needed;
    $("#xpBarFill").style.width = (into / needed) * 100 + "%";
  }

  function renderSidebarStreak() {
    $("#sidebarStreakVal").textContent = computeStreak();
  }

  function taskItemTemplate(t, dayKey, opts = {}) {
    const li = document.createElement("li");
    li.className = "task-item" + (t.completed ? " completed" : "");
    li.dataset.id = t.id;
    li.draggable = !!opts.draggable;

    li.innerHTML = `
      ${opts.draggable ? `<span class="drag-handle" title="Drag to reorder"><svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></span>` : ""}
      <button class="checkbox ${t.completed ? "checked" : ""}" aria-label="Toggle complete">
        <svg viewBox="0 0 24 24"><polyline points="4,13 9,18 20,6"/></svg>
      </button>
      <div class="task-main">
        <div class="task-top-row">
          <span class="task-name">${escapeHtml(t.name)}</span>
        </div>
        <div class="task-meta">
          <span class="badge">${escapeHtml(t.category || "General")}</span>
          <span class="badge priority-${t.priority}">${cap(t.priority)} · ${XP_MAP[t.priority]} XP</span>
        </div>
        ${t.notes ? `<div class="task-note">📝 ${escapeHtml(t.notes)}</div>` : ""}
      </div>
      <div class="task-actions">
        <button class="icon-btn edit-btn" title="Edit"><svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z"/></svg></button>
        <button class="icon-btn del-btn" title="Delete"><svg viewBox="0 0 24 24"><path d="M6 7h12l-1 14H7L6 7Zm3-4h6l1 2h4v2H4V5h4l1-2Z"/></svg></button>
      </div>
    `;

    li.querySelector(".checkbox").addEventListener("click", (e) => {
      toggleComplete(dayKey, t.id, e.currentTarget);
    });
    li.querySelector(".edit-btn").addEventListener("click", () => openTaskModal(t.id));
    li.querySelector(".del-btn").addEventListener("click", () => {
      if (confirm(`Delete "${t.name}"? This cannot be undone.`)) {
        deleteTask(t.id);
        renderTodayList();
        renderTasksView();
      }
    });
    return li;
  }

  function renderTodayList() {
    const day = ensureToday();
    const list = $("#todayList");
    list.innerHTML = "";
    const filterText = ($("#dashFilter").value || "").toLowerCase().trim();
    const filtered = day.tasks.filter(t => t.name.toLowerCase().includes(filterText));

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = `<div class="empty-icon">✨</div><p>${day.tasks.length ? "No tasks match your filter." : "No tasks yet — add your first task to get started."}</p>`;
      list.appendChild(empty);
    } else {
      filtered.forEach(t => list.appendChild(taskItemTemplate(t, day.date, { draggable: filterText === "" })));
      enableDrag(list, (orderedIds) => reorderMasterTasks(orderedIds));
    }
    renderDashboardStats();
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ============ DRAG REORDER ============ */
  function enableDrag(listEl, onReorder) {
    let dragEl = null;
    listEl.querySelectorAll(".task-item[draggable='true']").forEach(item => {
      item.addEventListener("dragstart", () => { dragEl = item; item.classList.add("dragging"); });
      item.addEventListener("dragend", () => {
        item.classList.remove("dragging");
        const ids = Array.from(listEl.querySelectorAll(".task-item")).map(i => i.dataset.id);
        onReorder(ids);
      });
      item.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (!dragEl || dragEl === item) return;
        const rect = item.getBoundingClientRect();
        const next = (e.clientY - rect.top) / rect.height > 0.5;
        listEl.insertBefore(dragEl, next ? item.nextSibling : item);
      });
    });
  }

  /* ============ TASKS VIEW ============ */
  function renderTasksView() {
    const day = ensureToday();
    const list = $("#allTasksList");
    const search = ($("#taskSearch").value || "").toLowerCase().trim();
    const statusF = $("#filterStatus").value;
    const catF = $("#filterCategory").value;
    const prioF = $("#filterPriority").value;

    // populate categories
    const cats = Array.from(new Set(state.tasks.map(t => t.category || "General")));
    const catSelect = $("#filterCategory");
    const prevVal = catSelect.value;
    catSelect.innerHTML = `<option value="all">All Categories</option>` + cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    catSelect.value = cats.includes(prevVal) ? prevVal : "all";
    $("#categoryList").innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">`).join("");

    let dayTasks = day.tasks.slice().sort((a, b) => {
      const oa = state.tasks.find(t => t.id === a.id);
      const ob = state.tasks.find(t => t.id === b.id);
      return (oa ? oa.order : 0) - (ob ? ob.order : 0);
    });

    dayTasks = dayTasks.filter(t => {
      if (search && !t.name.toLowerCase().includes(search)) return false;
      if (statusF === "completed" && !t.completed) return false;
      if (statusF === "pending" && t.completed) return false;
      if (catF !== "all" && (t.category || "General") !== catF) return false;
      if (prioF !== "all" && t.priority !== prioF) return false;
      return true;
    });

    list.innerHTML = "";
    if (!dayTasks.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = `<div class="empty-icon">🔍</div><p>No tasks match your search or filters.</p>`;
      list.appendChild(empty);
    } else {
      dayTasks.forEach(t => list.appendChild(taskItemTemplate(t, day.date, { draggable: !search && statusF === "all" && catF === "all" && prioF === "all" })));
      enableDrag(list, (orderedIds) => reorderMasterTasks(orderedIds));
    }
  }

  /* ============ TASK MODAL ============ */
  let editingTaskId = null;
  function openTaskModal(taskId = null) {
    editingTaskId = taskId;
    const isEdit = !!taskId;
    $("#taskModalTitle").textContent = isEdit ? "Edit Task" : "Add Task";
    $("#taskDeleteBtn").hidden = !isEdit;

    if (isEdit) {
      const t = state.tasks.find(t => t.id === taskId);
      $("#taskNameInput").value = t.name;
      $("#taskCategoryInput").value = t.category || "";
      $("#taskNotesInput").value = t.notes || "";
      setPriority(t.priority);
    } else {
      $("#taskNameInput").value = "";
      $("#taskCategoryInput").value = "";
      $("#taskNotesInput").value = "";
      setPriority("easy");
    }
    openModal("#taskModal");
    setTimeout(() => $("#taskNameInput").focus(), 200);
  }
  function setPriority(p) {
    $$("#priorityToggle .seg-btn").forEach(b => b.classList.toggle("active", b.dataset.priority === p));
  }
  function getPriority() {
    const active = $("#priorityToggle .seg-btn.active");
    return active ? active.dataset.priority : "easy";
  }

  function saveTaskFromModal() {
    const name = $("#taskNameInput").value.trim();
    if (!name) { toast("⚠️ Task name is required"); $("#taskNameInput").focus(); return; }
    const category = $("#taskCategoryInput").value.trim();
    const priority = getPriority();
    const notes = $("#taskNotesInput").value.trim();

    if (editingTaskId) updateTask(editingTaskId, { name, category, priority, notes });
    else addTask({ name, category, priority, notes });

    closeModal("#taskModal");
    renderTodayList();
    renderTasksView();
  }

  /* ============ GENERIC MODAL ============ */
  function openModal(sel) {
    $("#overlay").classList.add("show");
    $(sel).classList.add("show");
  }
  function closeModal(sel) {
    $("#overlay").classList.remove("show");
    $$(".modal").forEach(m => m.classList.remove("show"));
  }

  /* ============ HISTORY VIEW ============ */
  function renderHistoryView() {
    const container = $("#historyList");
    const search = ($("#historySearch").value || "").toLowerCase().trim();
    const keys = Object.keys(state.days).filter(k => k !== todayKey()).sort((a, b) => b.localeCompare(a));

    const filtered = keys.filter(k => {
      if (!search) return true;
      return prettyDate(k).toLowerCase().includes(search) || k.includes(search) || weekday(k).toLowerCase().includes(search);
    });

    container.innerHTML = "";
    $("#historyEmpty").hidden = filtered.length > 0;

    filtered.forEach(k => {
      const day = state.days[k];
      const pct = day.totalCount ? Math.round((day.completedCount / day.totalCount) * 100) : 0;
      const card = document.createElement("div");
      card.className = "history-card glass";
      card.innerHTML = `
        <div>
          <div class="history-date">${prettyDate(k)}</div>
          <div class="history-weekday">${weekday(k)}</div>
        </div>
        <div class="history-right">
          <div class="mini-bar"><div class="mini-bar-fill" style="width:${pct}%"></div></div>
          <div class="history-ratio">${day.completedCount} / ${day.totalCount}</div>
        </div>
      `;
      card.addEventListener("click", () => openDayModal(k));
      container.appendChild(card);
    });
  }

  function openDayModal(key) {
    const day = state.days[key];
    if (!day) return;
    $("#dayModalTitle").textContent = `${prettyDate(key)} · ${weekday(key)}`;
    const body = $("#dayModalBody");
    const pct = day.totalCount ? Math.round((day.completedCount / day.totalCount) * 100) : 0;
    body.innerHTML = `
      <p style="color:var(--text-dim);margin:0 0 14px;">${day.completedCount} / ${day.totalCount} completed · ${pct}% · ${day.score} XP earned</p>
      <ul class="task-list" style="gap:8px;"></ul>
    `;
    const list = body.querySelector(".task-list");
    day.tasks.forEach(t => {
      const li = document.createElement("li");
      li.className = "task-item" + (t.completed ? " completed" : "");
      li.innerHTML = `
        <span class="checkbox ${t.completed ? "checked" : ""}" style="pointer-events:none;">
          <svg viewBox="0 0 24 24"><polyline points="4,13 9,18 20,6"/></svg>
        </span>
        <div class="task-main">
          <div class="task-name">${escapeHtml(t.name)}</div>
          <div class="task-meta">
            <span class="badge">${escapeHtml(t.category || "General")}</span>
            <span class="badge priority-${t.priority}">${cap(t.priority)} · ${XP_MAP[t.priority]} XP</span>
          </div>
          ${t.notes ? `<div class="task-note">📝 ${escapeHtml(t.notes)}</div>` : ""}
        </div>
      `;
      list.appendChild(li);
    });
    openModal("#dayModal");
  }

  /* ============ ANALYTICS ============ */
  let charts = {};
  function destroyChart(key) { if (charts[key]) { charts[key].destroy(); delete charts[key]; } }

  function chartColors() {
    const styles = getComputedStyle(document.documentElement);
    return {
      accent: styles.getPropertyValue("--accent").trim() || "#22C55E",
      text: styles.getPropertyValue("--text-dim").trim() || "#9AA5B5",
      grid: styles.getPropertyValue("--border").trim() || "rgba(255,255,255,0.08)",
    };
  }

  function lastNDays(n) {
    const arr = [];
    let cursor = keyToDate(todayKey());
    for (let i = 0; i < n; i++) {
      arr.unshift(formatDateKey(cursor));
      cursor = new Date(cursor.getTime() - DAY_MS);
    }
    return arr;
  }

  function renderAnalytics() {
    if (typeof Chart === "undefined") return;
    const c = chartColors();
    Chart.defaults.color = c.text;
    Chart.defaults.font.family = "Inter, sans-serif";

    // Weekly progress (last 7 days completion %)
    const week = lastNDays(7);
    const weekPct = week.map(k => {
      const d = state.days[k];
      return d && d.totalCount ? Math.round((d.completedCount / d.totalCount) * 100) : 0;
    });
    destroyChart("weekly");
    charts.weekly = new Chart($("#chartWeekly"), {
      type: "line",
      data: {
        labels: week.map(k => keyToDate(k).toLocaleDateString("en-US", { weekday: "short" })),
        datasets: [{ label: "Completion %", data: weekPct, borderColor: c.accent, backgroundColor: "rgba(34,197,94,0.15)", fill: true, tension: 0.35, pointRadius: 3 }],
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 100, grid: { color: c.grid } }, x: { grid: { display: false } } }, plugins: { legend: { display: false } } },
    });

    // Monthly progress (last 30 days completion %)
    const month = lastNDays(30);
    const monthPct = month.map(k => {
      const d = state.days[k];
      return d && d.totalCount ? Math.round((d.completedCount / d.totalCount) * 100) : 0;
    });
    destroyChart("monthly");
    charts.monthly = new Chart($("#chartMonthly"), {
      type: "line",
      data: {
        labels: month.map(k => keyToDate(k).getDate()),
        datasets: [{ label: "Completion %", data: monthPct, borderColor: "#3B82F6", backgroundColor: "rgba(59,130,246,0.12)", fill: true, tension: 0.3, pointRadius: 0 }],
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 100, grid: { color: c.grid } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } } }, plugins: { legend: { display: false } } },
    });

    // Completion rate pie (all-time)
    let totalDone = 0, totalTasks = 0;
    Object.values(state.days).forEach(d => { totalDone += d.completedCount; totalTasks += d.totalCount; });
    destroyChart("pie");
    charts.pie = new Chart($("#chartPie"), {
      type: "doughnut",
      data: { labels: ["Completed", "Pending"], datasets: [{ data: [totalDone, Math.max(totalTasks - totalDone, 0)], backgroundColor: [c.accent, "rgba(255,255,255,0.1)"], borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } },
    });

    // Daily completion bar (last 14 days, counts)
    const two = lastNDays(14);
    const counts = two.map(k => (state.days[k] ? state.days[k].completedCount : 0));
    destroyChart("bar");
    charts.bar = new Chart($("#chartBar"), {
      type: "bar",
      data: { labels: two.map(k => keyToDate(k).toLocaleDateString("en-US", { day: "numeric", month: "short" })), datasets: [{ label: "Completed", data: counts, backgroundColor: c.accent, borderRadius: 6, maxBarThickness: 22 }] },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, grid: { color: c.grid } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } } }, plugins: { legend: { display: false } } },
    });

    // Best / worst day
    const withData = Object.values(state.days).filter(d => d.totalCount > 0);
    if (withData.length) {
      const rate = d => d.completedCount / d.totalCount;
      const best = withData.reduce((a, b) => (rate(b) > rate(a) ? b : a));
      const worst = withData.reduce((a, b) => (rate(b) < rate(a) ? b : a));
      $("#bestDay").textContent = prettyDate(best.date, { year: undefined });
      $("#bestDaySub").textContent = `${best.completedCount} / ${best.totalCount} completed (${Math.round(rate(best) * 100)}%)`;
      $("#worstDay").textContent = prettyDate(worst.date, { year: undefined });
      $("#worstDaySub").textContent = `${worst.completedCount} / ${worst.totalCount} completed (${Math.round(rate(worst) * 100)}%)`;
    }
  }

  /* ============ CALENDAR (contribution graph) ============ */
  function renderCalendar() {
    const graph = $("#contributionGraph");
    graph.innerHTML = "";
    const days = lastNDays(371); // ~53 weeks, GitHub-style
    days.forEach(k => {
      const cell = document.createElement("div");
      cell.className = "contrib-cell";
      const d = state.days[k];
      if (d && d.totalCount > 0) {
        const rate = d.completedCount / d.totalCount;
        if (rate === 0) cell.classList.add("level-1"); // missed (red)
        else if (rate < 1) cell.classList.add("level-2"); // partial (orange)
        else cell.classList.add("level-4"); // completed (green)
      }
      cell.title = `${prettyDate(k)} — ${d ? `${d.completedCount}/${d.totalCount}` : "no data"}`;
      cell.addEventListener("click", () => {
        if (d) openDayModal(k);
        else toast("No data for this date yet");
      });
      graph.appendChild(cell);
    });
  }

  /* ============ POMODORO ============ */
  const pomodoro = {
    duration: 25 * 60,
    remaining: 25 * 60,
    interval: null,
    running: false,
  };

  function updateTimerDisplay() {
    const m = Math.floor(pomodoro.remaining / 60).toString().padStart(2, "0");
    const s = Math.floor(pomodoro.remaining % 60).toString().padStart(2, "0");
    $("#timerDisplay").textContent = `${m}:${s}`;
    const circumference = 565.5;
    const progress = 1 - pomodoro.remaining / pomodoro.duration;
    $("#timerRingFg").style.strokeDashoffset = circumference * (1 - progress);
  }

  function startTimer() {
    if (pomodoro.running) return;
    pomodoro.running = true;
    pomodoro.interval = setInterval(() => {
      pomodoro.remaining--;
      updateTimerDisplay();
      if (pomodoro.remaining <= 0) {
        clearInterval(pomodoro.interval);
        pomodoro.running = false;
        onTimerComplete();
      }
    }, 1000);
  }
  function pauseTimer() {
    pomodoro.running = false;
    clearInterval(pomodoro.interval);
  }
  function resetTimer() {
    pauseTimer();
    pomodoro.remaining = pomodoro.duration;
    updateTimerDisplay();
  }
  function onTimerComplete() {
    ensureToday();
    state.pomodoro.sessions++;
    saveState();
    $("#timerSessions").textContent = `${state.pomodoro.sessions} sessions completed today`;
    toast("🍅 Pomodoro session complete!");
    playBeep();
    if ("Notification" in window) {
      if (Notification.permission === "granted") {
        new Notification("AdyOS Pomodoro", { body: "Session complete — take a break!" });
      }
    }
    resetTimer();
  }
  function playBeep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.stop(ctx.currentTime + 0.6);
    } catch (e) { /* audio not available */ }
  }

  /* ============ SETTINGS ============ */
  function applySettings() {
    document.documentElement.setAttribute("data-theme", state.settings.theme);
    document.documentElement.style.setProperty("--accent", state.settings.accent);
    const rgb = hexToRgb(state.settings.accent);
    if (rgb) document.documentElement.style.setProperty("--accent-rgb", `${rgb.r}, ${rgb.g}, ${rgb.b}`);
    $$("#themeToggle .seg-btn").forEach(b => b.classList.toggle("active", b.dataset.theme === state.settings.theme));
    $$("#accentSwatches .swatch").forEach(s => s.classList.toggle("active", s.dataset.color.toLowerCase() === state.settings.accent.toLowerCase()));
  }
  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `adyos-backup-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("⬇️ Data exported");
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        if (!parsed.tasks || !parsed.days) throw new Error("Invalid file");
        state = parsed;
        saveState();
        applySettings();
        ensureToday();
        renderAll();
        toast("✅ Data imported successfully");
      } catch (err) {
        toast("⚠️ Invalid AdyOS backup file");
      }
    };
    reader.readAsText(file);
  }

  function resetData() {
    if (!confirm("This will permanently erase ALL AdyOS data on this device. Continue?")) return;
    if (!confirm("Are you absolutely sure? This cannot be undone.")) return;
    localStorage.removeItem(STORAGE_KEY);
    state = defaultState();
    saveState();
    applySettings();
    renderAll();
    toast("🔄 All data has been reset");
  }

  /* ============ RENDER ALL ============ */
  function renderAll() {
    renderGreetingClock();
    ensureToday();
    renderTodayList();
    renderSidebarStreak();
    if (currentView === "tasks") renderTasksView();
    if (currentView === "history") renderHistoryView();
    if (currentView === "analytics") renderAnalytics();
    if (currentView === "calendar") renderCalendar();
  }

  /* ============ EVENT WIRING ============ */
  function wireEvents() {
    $$(".nav-item").forEach(btn => btn.addEventListener("click", () => switchView(btn.dataset.view)));
    $("#menuToggle").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
    $("#quickAddBtn").addEventListener("click", () => openTaskModal());
    $("#addTaskBtnDash").addEventListener("click", () => openTaskModal());
    $("#addCustomTaskDash").addEventListener("click", () => openTaskModal());
    $("#addTaskBtnTasks").addEventListener("click", () => openTaskModal());

    $$(".btn").forEach(attachRipple);

    $("#overlay").addEventListener("click", () => closeModal());
    $("#taskModalClose").addEventListener("click", () => closeModal());
    $("#dayModalClose").addEventListener("click", () => closeModal());
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

    $("#taskSaveBtn").addEventListener("click", saveTaskFromModal);
    $("#taskDeleteBtn").addEventListener("click", () => {
      if (editingTaskId && confirm("Delete this task?")) {
        deleteTask(editingTaskId);
        closeModal();
        renderTodayList();
        renderTasksView();
      }
    });
    $$("#priorityToggle .seg-btn").forEach(b => b.addEventListener("click", () => setPriority(b.dataset.priority)));

    $("#dashFilter").addEventListener("input", renderTodayList);
    $("#taskSearch").addEventListener("input", renderTasksView);
    $("#filterStatus").addEventListener("change", renderTasksView);
    $("#filterCategory").addEventListener("change", renderTasksView);
    $("#filterPriority").addEventListener("change", renderTasksView);
    $("#historySearch").addEventListener("input", renderHistoryView);

    // Pomodoro
    $$(".pomodoro-presets .chip[data-min]").forEach(chip => {
      chip.addEventListener("click", () => {
        if (chip.dataset.min === "custom") {
          const val = prompt("Enter custom duration in minutes:", "45");
          const mins = parseInt(val, 10);
          if (!mins || mins <= 0 || mins > 240) { toast("⚠️ Enter a valid duration (1–240 min)"); return; }
          $$(".pomodoro-presets .chip").forEach(c => c.classList.remove("active"));
          chip.classList.add("active");
          pomodoro.duration = mins * 60;
        } else {
          $$(".pomodoro-presets .chip").forEach(c => c.classList.remove("active"));
          chip.classList.add("active");
          pomodoro.duration = parseInt(chip.dataset.min, 10) * 60;
        }
        resetTimer();
      });
    });
    $("#timerStart").addEventListener("click", () => {
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
      startTimer();
    });
    $("#timerPause").addEventListener("click", pauseTimer);
    $("#timerReset").addEventListener("click", resetTimer);

    // Settings
    $$("#themeToggle .seg-btn").forEach(b => b.addEventListener("click", () => {
      state.settings.theme = b.dataset.theme;
      saveState();
      applySettings();
    }));
    $$("#accentSwatches .swatch").forEach(s => s.addEventListener("click", () => {
      state.settings.accent = s.dataset.color;
      saveState();
      applySettings();
    }));
    $("#exportBtn").addEventListener("click", exportData);
    $("#importInput").addEventListener("change", (e) => {
      if (e.target.files[0]) importData(e.target.files[0]);
      e.target.value = "";
    });
    $("#resetBtn").addEventListener("click", resetData);
  }

  /* ============ AUTO NEW DAY WATCHER ============ */
  function watchForNewDay() {
    setInterval(() => {
      if (state.currentDate !== todayKey()) {
        ensureToday();
        renderAll();
        toast("🌅 A new day has begun — fresh checklist ready!");
      }
      renderGreetingClock();
    }, 30000);
    setInterval(renderGreetingClock, 1000);
  }

  /* ============ INIT ============ */
  function init() {
    state = loadState();
    ensureToday();
    applySettings();
    wireEvents();
    $("#timerSessions").textContent = `${state.pomodoro.sessions} sessions completed today`;
    updateTimerDisplay();
    renderAll();
    watchForNewDay();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
