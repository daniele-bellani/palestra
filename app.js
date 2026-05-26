"use strict";

const STORAGE_KEY = "palestra.app.v1";
const app = document.getElementById("app");
const state = {
  view: "home",
  sessionId: null,
  selectedExerciseId: null,
  modal: null,
  ticker: null
};

const emptyDb = () => ({ sessions: [], history: [] });
let db = loadDb();

function loadDb() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeDb(JSON.parse(raw)) : emptyDb();
  } catch {
    return emptyDb();
  }
}

function saveDb() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

function normalizeDb(value) {
  const next = value && typeof value === "object" ? value : emptyDb();
  next.sessions = Array.isArray(next.sessions) ? next.sessions : [];
  next.history = Array.isArray(next.history) ? next.history : [];
  next.sessions.forEach((session) => {
    session.id = session.id || uid("session");
    session.name = session.name || "Sessione";
    session.createdAt = session.createdAt || new Date().toISOString();
    session.updatedAt = session.updatedAt || session.createdAt;
    session.exercises = Array.isArray(session.exercises) ? session.exercises : [];
    session.exercises.forEach((exercise) => {
      exercise.id = exercise.id || uid("exercise");
      exercise.name = typeof exercise.name === "string" ? exercise.name : "Esercizio";
      exercise.note = exercise.note || "";
      exercise.mode = exercise.mode === "timer" ? "timer" : "reps";
      exercise.restSeconds = toInt(exercise.restSeconds, 60);
      exercise.sets = Array.isArray(exercise.sets) ? exercise.sets : [];
      exercise.sets.forEach((set) => {
        set.id = set.id || uid("set");
        set.reps = toInt(set.reps, 10);
        set.weight = toNumber(set.weight, 0);
        set.durationSeconds = toInt(set.durationSeconds, 60);
      });
    });
  });
  return next;
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatDuration(seconds) {
  const safe = Math.max(0, toInt(seconds, 0));
  const mm = String(Math.floor(safe / 60)).padStart(2, "0");
  const ss = String(safe % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function parseDuration(min, sec) {
  return Math.max(0, toInt(min, 0) * 60 + clamp(toInt(sec, 0), 0, 59));
}

function splitDuration(seconds) {
  const safe = Math.max(0, toInt(seconds, 0));
  return { min: Math.floor(safe / 60), sec: safe % 60 };
}

function sessionById(id) {
  return db.sessions.find((session) => session.id === id);
}

function exerciseById(session, id) {
  return session?.exercises.find((exercise) => exercise.id === id);
}

function displayExerciseName(exercise) {
  const name = String(exercise?.name || "").trim();
  return name || "Esercizio senza nome";
}

function setById(exercise, id) {
  return exercise?.sets.find((set) => set.id === id);
}

function touchSession(session) {
  session.updatedAt = nowIso();
}

function parseRoute() {
  const raw = decodeURIComponent(window.location.hash || "#/");
  const parts = raw.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "session" && parts[1]) {
    return { view: "session", sessionId: parts[1] };
  }
  if (parts[0] === "train" && parts[1]) {
    return { view: "train", sessionId: parts[1] };
  }
  return { view: "home", sessionId: null };
}

function routeHash(view, sessionId) {
  if (view === "session" && sessionId) return `#/session/${encodeURIComponent(sessionId)}`;
  if (view === "train" && sessionId) return `#/train/${encodeURIComponent(sessionId)}`;
  return "#/";
}

function navigate(view, sessionId = null, replace = false) {
  const target = routeHash(view, sessionId);
  if (window.location.hash === target) {
    applyRoute();
    return;
  }
  if (replace) {
    window.location.replace(`${window.location.pathname}${window.location.search}${target}`);
    return;
  }
  window.location.hash = target;
}

function applyRoute() {
  const route = parseRoute();
  const session = route.sessionId ? sessionById(route.sessionId) : null;

  if ((route.view === "session" || route.view === "train") && !session) {
    state.view = "home";
    state.sessionId = null;
    state.selectedExerciseId = null;
    state.modal = null;
    navigate("home", null, true);
    return;
  }

  state.view = route.view;
  state.sessionId = session?.id || null;
  state.modal = null;

  if (route.view === "train" && session) {
    ensureRun(session);
    if (!state.selectedExerciseId || !exerciseById(session, state.selectedExerciseId)) {
      state.selectedExerciseId = nextExercise(session)?.id || null;
    }
  } else {
    state.selectedExerciseId = null;
  }

  render();
}

function render() {
  const content = state.view === "session"
    ? renderSession()
    : state.view === "train"
      ? renderTraining()
      : renderHome();

  app.innerHTML = content + renderModal();
  syncTicker();
}

function shell(title, subtitle, body, actions = "") {
  return `
    <header class="topbar">
      <div>
        <h1>${escapeHtml(title)}</h1>
        ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
      </div>
      <div class="row-actions">
        ${actions}
        <button class="button ghost icon" type="button" data-action="fullscreen" title="Schermo intero">⛶</button>
      </div>
    </header>
    <main class="main">${body}</main>
  `;
}

function renderHome() {
  const sessions = db.sessions.map((session, index) => `
    <article class="card">
      <div class="card-body">
        <div class="item-head">
          <div>
            <h2 class="item-title">${escapeHtml(session.name)}</h2>
            <div class="meta">${session.exercises.length} esercizi · aggiornata ${formatDate(session.updatedAt)}</div>
          </div>
          <div class="row-actions">
            <button class="button icon" type="button" data-action="move-session" data-id="${session.id}" data-dir="-1" ${index === 0 ? "disabled" : ""} title="Sposta su">↑</button>
            <button class="button icon" type="button" data-action="move-session" data-id="${session.id}" data-dir="1" ${index === db.sessions.length - 1 ? "disabled" : ""} title="Sposta giu">↓</button>
          </div>
        </div>
        <div class="toolbar">
          <button class="button primary" type="button" data-action="train-session" data-id="${session.id}">Avvia</button>
          <button class="button" type="button" data-action="open-session" data-id="${session.id}">Modifica</button>
          <button class="button" type="button" data-action="export-session" data-id="${session.id}">Esporta</button>
          <button class="button danger" type="button" data-action="delete-session" data-id="${session.id}">Elimina</button>
        </div>
      </div>
    </article>
  `).join("");

  const body = `
    <section class="toolbar">
      <button class="button primary" type="button" data-action="new-session">Nuova sessione</button>
      <button class="button" type="button" data-action="import-session">Importa JSON</button>
      <input class="hidden" id="import-file" type="file" accept="application/json,.json">
    </section>
    <section class="list">
      ${sessions || `<div class="empty">Nessuna sessione salvata.</div>`}
    </section>
  `;

  return shell("Palestra", "Sessioni di allenamento", body);
}

function renderSession() {
  const session = sessionById(state.sessionId);
  if (!session) {
    state.view = "home";
    return renderHome();
  }

  const exercises = session.exercises.map((exercise, index) => {
    const total = exercise.sets.length;
    const summary = exercise.mode === "timer"
      ? `${total} serie a tempo · riposo ${formatDuration(exercise.restSeconds)}`
      : `${total} serie a ripetizioni · riposo ${formatDuration(exercise.restSeconds)}`;
    return `
      <article class="card">
        <div class="card-body">
          <div class="item-head">
            <div>
              <h2 class="item-title">${escapeHtml(displayExerciseName(exercise))}</h2>
              <div class="meta">${summary}</div>
              ${exercise.note ? `<p class="muted">${escapeHtml(exercise.note)}</p>` : ""}
            </div>
            <div class="row-actions">
              <button class="button icon" type="button" data-action="move-exercise" data-id="${exercise.id}" data-dir="-1" ${index === 0 ? "disabled" : ""} title="Sposta su">↑</button>
              <button class="button icon" type="button" data-action="move-exercise" data-id="${exercise.id}" data-dir="1" ${index === session.exercises.length - 1 ? "disabled" : ""} title="Sposta giu">↓</button>
            </div>
          </div>
          <div class="toolbar">
            <button class="button" type="button" data-action="edit-exercise" data-id="${exercise.id}">Modifica</button>
            <button class="button" type="button" data-action="history-exercise" data-id="${exercise.id}">Storico</button>
            <button class="button danger" type="button" data-action="delete-exercise" data-id="${exercise.id}">Elimina</button>
          </div>
        </div>
      </article>
    `;
  }).join("");

  const body = `
    <section class="toolbar">
      <button class="button" type="button" data-action="back-home">Indietro</button>
      <button class="button primary" type="button" data-action="train-session" data-id="${session.id}">Avvia allenamento</button>
      <button class="button" type="button" data-action="add-exercise">Aggiungi esercizio</button>
      <button class="button" type="button" data-action="export-session" data-id="${session.id}">Esporta JSON</button>
    </section>
    <section class="card">
      <div class="card-body">
        <div class="field">
          <label for="session-name">Nome sessione</label>
          <input id="session-name" data-action="rename-session" value="${escapeHtml(session.name)}">
        </div>
      </div>
    </section>
    <h2 class="screen-title">Esercizi</h2>
    <section class="list">
      ${exercises || `<div class="empty">Aggiungi il primo esercizio a questa sessione.</div>`}
    </section>
  `;

  return shell(session.name, "Configurazione sessione", body);
}

function renderTraining() {
  const session = sessionById(state.sessionId);
  if (!session) {
    state.view = "home";
    return renderHome();
  }

  const run = ensureRun(session);
  const remaining = remainingExercises(session);
  if (remaining.length === 0) {
    run.finishedAt = run.finishedAt || nowIso();
    run.timer = null;
    saveDb();
    const body = `
      <section class="toolbar">
        <button class="button" type="button" data-action="open-session" data-id="${session.id}">Torna alla sessione</button>
        <button class="button primary" type="button" data-action="new-workout" data-id="${session.id}">Nuovo allenamento</button>
      </section>
      <div class="notice">Allenamento terminato il ${formatDate(run.finishedAt)}.</div>
    `;
    return shell(session.name, "Allenamento completato", body);
  }

  const next = nextExercise(session);
  if (!state.selectedExerciseId || isExerciseComplete(session, state.selectedExerciseId)) {
    state.selectedExerciseId = next?.id || remaining[0].id;
  }

  const selected = exerciseById(session, state.selectedExerciseId) || next || remaining[0];
  const currentSet = firstOpenSet(run, selected);
  const timer = run.timer;
  const timerHtml = timer ? renderTimer(timer) : "";
  const picker = remaining.map((exercise) => `
    <button class="picker-button ${exercise.id === selected.id ? "active" : ""}" type="button" data-action="choose-exercise" data-id="${exercise.id}">
      <span>${escapeHtml(displayExerciseName(exercise))}</span>
      <small>${completedCount(run, exercise)}/${exercise.sets.length}</small>
    </button>
  `).join("");

  const setRows = selected.sets.map((set, index) => {
    const done = isSetDone(run, selected.id, set.id);
    const label = selected.mode === "timer"
      ? `Tempo ${formatDuration(set.durationSeconds)}`
      : `${set.reps} rip. · ${set.weight} kg`;
    return `
      <div class="set-row">
        <span class="status-dot ${done ? "done" : ""}"></span>
        <div>
          <strong>Serie ${index + 1}</strong>
          <div class="meta set-value">${label}</div>
        </div>
        <span class="muted">${done ? "Fatta" : "Da fare"}</span>
      </div>
    `;
  }).join("");

  const actionHtml = currentSet && !timer ? renderSetAction(selected, currentSet) : "";
  const body = `
    <section class="toolbar">
      <button class="button" type="button" data-action="open-session" data-id="${session.id}">Esci</button>
      <button class="button" type="button" data-action="new-workout" data-id="${session.id}">Ricomincia</button>
    </section>
    <section class="card">
      <div class="card-body">
        <div class="item-head">
          <div>
            <h2 class="screen-title">${escapeHtml(displayExerciseName(selected))}</h2>
            ${selected.note ? `<p class="muted">${escapeHtml(selected.note)}</p>` : ""}
          </div>
          <div class="meta">${completedCount(run, selected)}/${selected.sets.length} serie</div>
        </div>
      </div>
    </section>
    <section class="card training-control">
      <div class="card-body">
        ${timerHtml}
        ${actionHtml}
        <div class="set-actions">
          ${currentSet ? `<button class="button" type="button" data-action="edit-current-set" data-id="${currentSet.id}">Modifica serie corrente</button>` : ""}
        </div>
      </div>
    </section>
    <section class="card">
      <div class="card-body">
        <h2 class="item-title">Serie</h2>
        ${setRows}
      </div>
    </section>
    <section>
      <h2 class="screen-title">Scegli un altro esercizio</h2>
      <div class="exercise-picker">${picker}</div>
    </section>
  `;

  return shell(session.name, "Allenamento in corso", body);
}

function renderSetAction(exercise, set) {
  if (exercise.mode === "timer") {
    return `
      <div class="timer-face">
        <div>
          <strong>${formatDuration(set.durationSeconds)}</strong>
          <div class="timer-label">Tempo serie</div>
        </div>
      </div>
      <div class="timer-actions">
        <button class="button primary" type="button" data-action="start-work" data-set-id="${set.id}">Avvia timer serie</button>
      </div>
    `;
  }

  return `
    <div class="notice">Prossima serie: ${set.reps} ripetizioni con ${set.weight} kg.</div>
    <div class="timer-actions">
      <button class="button primary" type="button" data-action="complete-reps" data-set-id="${set.id}">Serie completata</button>
    </div>
  `;
}

function renderTimer(timer) {
  const remaining = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
  const label = timer.kind === "work" ? "Timer serie" : "Riposo";
  return `
    <div class="timer-face">
      <div>
        <strong id="timer-time">${formatDuration(remaining)}</strong>
        <div class="timer-label">${label}</div>
      </div>
    </div>
  `;
}

function renderModal() {
  if (!state.modal) return "";
  const { type } = state.modal;
  if (type === "session") return renderSessionModal();
  if (type === "exercise") return renderExerciseModal();
  if (type === "history") return renderHistoryModal();
  if (type === "current-set") return renderCurrentSetModal();
  return "";
}

function modalShell(title, content) {
  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true">
      <section class="modal">
        <header>
          <h2>${escapeHtml(title)}</h2>
          <button class="button icon" type="button" data-action="close-modal" title="Chiudi">×</button>
        </header>
        <div class="modal-content">${content}</div>
      </section>
    </div>
  `;
}

function renderSessionModal() {
  return modalShell("Nuova sessione", `
    <form id="session-form">
      <div class="field">
        <label for="new-session-name">Nome</label>
        <input id="new-session-name" name="name" required autocomplete="off">
      </div>
      <button class="button primary" type="submit">Crea sessione</button>
    </form>
  `);
}

function renderExerciseModal() {
  const session = sessionById(state.sessionId);
  const exercise = exerciseById(session, state.modal.exerciseId);
  if (!session || !exercise) return "";
  const rest = splitDuration(exercise.restSeconds);
  const setRows = exercise.sets.map((set, index) => {
    const duration = splitDuration(set.durationSeconds);
    const inputs = exercise.mode === "timer"
      ? `
        <div class="grid-2">
          <div class="field">
            <label>Minuti</label>
            <input type="number" min="0" data-set-id="${set.id}" data-set-field="durationMin" value="${duration.min}">
          </div>
          <div class="field">
            <label>Secondi</label>
            <input type="number" min="0" max="59" data-set-id="${set.id}" data-set-field="durationSec" value="${duration.sec}">
          </div>
        </div>
      `
      : `
        <div class="grid-2">
          <div class="field">
            <label>Ripetizioni</label>
            <input type="number" min="0" data-set-id="${set.id}" data-set-field="reps" value="${set.reps}">
          </div>
          <div class="field">
            <label>Peso kg</label>
            <input type="number" min="0" step="0.5" data-set-id="${set.id}" data-set-field="weight" value="${set.weight}">
          </div>
        </div>
      `;
    return `
      <div class="set-row">
        <strong>${index + 1}</strong>
        <div>${inputs}</div>
        <div class="row-actions">
          <button class="button icon" type="button" data-action="move-set" data-id="${set.id}" data-dir="-1" ${index === 0 ? "disabled" : ""} title="Sposta su">↑</button>
          <button class="button icon" type="button" data-action="move-set" data-id="${set.id}" data-dir="1" ${index === exercise.sets.length - 1 ? "disabled" : ""} title="Sposta giu">↓</button>
          <button class="button icon danger" type="button" data-action="delete-set" data-id="${set.id}" title="Elimina">×</button>
        </div>
      </div>
    `;
  }).join("");

  const blockFields = exercise.mode === "timer"
    ? `
      <div class="grid-3">
        <div class="field">
          <label>Serie</label>
          <input id="block-count" type="number" min="1" value="3">
        </div>
        <div class="field">
          <label>Minuti</label>
          <input id="block-min" type="number" min="0" value="1">
        </div>
        <div class="field">
          <label>Secondi</label>
          <input id="block-sec" type="number" min="0" max="59" value="0">
        </div>
      </div>
    `
    : `
      <div class="grid-3">
        <div class="field">
          <label>Serie</label>
          <input id="block-count" type="number" min="1" value="3">
        </div>
        <div class="field">
          <label>Ripetizioni</label>
          <input id="block-reps" type="number" min="0" value="10">
        </div>
        <div class="field">
          <label>Peso kg</label>
          <input id="block-weight" type="number" min="0" step="0.5" value="0">
        </div>
      </div>
    `;

  return modalShell("Esercizio", `
    <form id="exercise-form">
      <div class="field">
        <label for="exercise-name">Nome</label>
        <input id="exercise-name" name="name" required placeholder="Nome esercizio" value="${escapeHtml(exercise.name)}">
      </div>
      <div class="field">
        <label for="exercise-note">Nota</label>
        <textarea id="exercise-note" name="note">${escapeHtml(exercise.note)}</textarea>
      </div>
      <div class="tabs">
        <button class="${exercise.mode === "reps" ? "active" : ""}" type="button" data-action="set-mode" data-mode="reps">Ripetizioni</button>
        <button class="${exercise.mode === "timer" ? "active" : ""}" type="button" data-action="set-mode" data-mode="timer">Timer</button>
      </div>
      <div class="grid-2">
        <div class="field">
          <label>Riposo minuti</label>
          <input name="restMin" type="number" min="0" value="${rest.min}">
        </div>
        <div class="field">
          <label>Riposo secondi</label>
          <input name="restSec" type="number" min="0" max="59" value="${rest.sec}">
        </div>
      </div>
      <h3 class="item-title">Serie configurate</h3>
      ${setRows || `<div class="empty">Nessuna serie configurata.</div>`}
      <button class="button primary" type="submit">Salva esercizio</button>
    </form>
    <hr>
    <h3 class="item-title">Aggiungi serie in blocco</h3>
    ${blockFields}
    <button class="button" type="button" data-action="add-set-block">Aggiungi blocco</button>
  `);
}

function renderHistoryModal() {
  const session = sessionById(state.sessionId);
  const exercise = exerciseById(session, state.modal.exerciseId);
  if (!session || !exercise) return "";
  const entries = db.history
    .filter((entry) => entry.exerciseId === exercise.id)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .map((entry) => `
      <div class="history-entry">
        <strong>${formatDate(entry.at)}</strong>
        <span>${escapeHtml(entry.sessionName)} · serie ${entry.setIndex + 1}</span>
        <span class="muted">${escapeHtml(entry.label)}: ${escapeHtml(entry.oldValue)} → ${escapeHtml(entry.newValue)}</span>
      </div>
    `).join("");
  return modalShell(`Storico ${displayExerciseName(exercise)}`, entries || `<div class="empty">Nessuna modifica registrata durante gli allenamenti.</div>`);
}

function renderCurrentSetModal() {
  const session = sessionById(state.sessionId);
  const exercise = exerciseById(session, state.selectedExerciseId);
  const set = setById(exercise, state.modal.setId);
  if (!session || !exercise || !set) return "";
  const body = exercise.mode === "timer"
    ? (() => {
      const duration = splitDuration(set.durationSeconds);
      return `
        <form id="current-set-form">
          <div class="grid-2">
            <div class="field">
              <label>Minuti</label>
              <input name="durationMin" type="number" min="0" value="${duration.min}">
            </div>
            <div class="field">
              <label>Secondi</label>
              <input name="durationSec" type="number" min="0" max="59" value="${duration.sec}">
            </div>
          </div>
          <button class="button primary" type="submit">Salva tempo</button>
        </form>
      `;
    })()
    : `
      <form id="current-set-form">
        <div class="field">
          <label>Peso kg</label>
          <input name="weight" type="number" min="0" step="0.5" value="${set.weight}">
        </div>
        <button class="button primary" type="submit">Salva peso</button>
      </form>
    `;
  return modalShell("Modifica serie corrente", body);
}

function ensureRun(session) {
  if (!session.activeRun || session.activeRun.finishedAt) {
    session.activeRun = {
      id: uid("run"),
      startedAt: nowIso(),
      finishedAt: null,
      completedSets: {},
      timer: null
    };
    saveDb();
  }
  return session.activeRun;
}

function resetRun(session) {
  session.activeRun = {
    id: uid("run"),
    startedAt: nowIso(),
    finishedAt: null,
    completedSets: {},
    timer: null
  };
  state.selectedExerciseId = null;
  saveDb();
}

function isSetDone(run, exerciseId, setId) {
  return Boolean(run.completedSets?.[exerciseId]?.[setId]);
}

function markSetDone(session, exercise, set) {
  const run = ensureRun(session);
  run.completedSets[exercise.id] = run.completedSets[exercise.id] || {};
  run.completedSets[exercise.id][set.id] = true;
  saveDb();
}

function firstOpenSet(run, exercise) {
  return exercise.sets.find((set) => !isSetDone(run, exercise.id, set.id));
}

function completedCount(run, exercise) {
  return exercise.sets.filter((set) => isSetDone(run, exercise.id, set.id)).length;
}

function isExerciseComplete(session, exerciseId) {
  const run = ensureRun(session);
  const exercise = exerciseById(session, exerciseId);
  return !exercise || exercise.sets.length > 0 && completedCount(run, exercise) === exercise.sets.length;
}

function remainingExercises(session) {
  const run = ensureRun(session);
  return session.exercises.filter((exercise) => exercise.sets.length > 0 && completedCount(run, exercise) < exercise.sets.length);
}

function nextExercise(session) {
  return remainingExercises(session)[0] || null;
}

function startTimer(session, kind, exercise, set, seconds) {
  const run = ensureRun(session);
  run.timer = {
    kind,
    exerciseId: exercise.id,
    setId: set.id,
    total: Math.max(0, seconds),
    endAt: Date.now() + Math.max(0, seconds) * 1000
  };
  saveDb();
  syncTicker();
  render();
}

function finishTimer(session) {
  const run = ensureRun(session);
  const timer = run.timer;
  if (!timer) return;
  run.timer = null;
  const exercise = exerciseById(session, timer.exerciseId);
  const set = setById(exercise, timer.setId);
  saveDb();
  beep();

  if (timer.kind === "work" && exercise && set) {
    markSetDone(session, exercise, set);
    beginRestOrAdvance(session, exercise, set);
    return;
  }

  if (timer.kind === "rest" && exercise && !isExerciseComplete(session, exercise.id)) {
    state.selectedExerciseId = exercise.id;
  } else if (timer.kind === "rest") {
    state.selectedExerciseId = nextExercise(session)?.id || null;
  }
  saveDb();
  render();
}

function beginRestOrAdvance(session, exercise, set) {
  if (exercise.restSeconds > 0 && remainingExercises(session).length > 0) {
    startTimer(session, "rest", exercise, set, exercise.restSeconds);
    return;
  }
  state.selectedExerciseId = isExerciseComplete(session, exercise.id)
    ? nextExercise(session)?.id || null
    : exercise.id;
  saveDb();
  render();
}

function syncTicker() {
  const session = sessionById(state.sessionId);
  const timer = session?.activeRun?.timer;
  if (!timer) {
    if (state.ticker) clearInterval(state.ticker);
    state.ticker = null;
    return;
  }
  if (Date.now() >= timer.endAt) {
    if (state.ticker) clearInterval(state.ticker);
    state.ticker = null;
    setTimeout(() => finishTimer(session), 0);
    return;
  }
  if (!state.ticker) {
    state.ticker = setInterval(() => {
      const activeSession = sessionById(state.sessionId);
      const activeTimer = activeSession?.activeRun?.timer;
      if (!activeTimer) {
        syncTicker();
        return;
      }
      const remaining = Math.max(0, Math.ceil((activeTimer.endAt - Date.now()) / 1000));
      const node = document.getElementById("timer-time");
      if (node) node.textContent = formatDuration(remaining);
      if (remaining <= 0) finishTimer(activeSession);
    }, 250);
  }
}

function beep() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    ctx.resume?.();
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.9, ctx.currentTime);
    master.connect(ctx.destination);

    [0, 0.34, 0.68, 1.02, 1.36, 1.7, 2.04].forEach((offset, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + offset;
      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(index % 2 ? 1180 : 880, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.85, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.24);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(start);
      oscillator.stop(start + 0.28);
    });

    window.setTimeout(() => ctx.close?.(), 2800);
  } catch {
    /* Audio feedback is best-effort on mobile browsers. */
  }
}

function moveItem(list, id, dir) {
  const index = list.findIndex((item) => item.id === id);
  const target = index + dir;
  if (index < 0 || target < 0 || target >= list.length) return false;
  const [item] = list.splice(index, 1);
  list.splice(target, 0, item);
  return true;
}

function downloadSession(session) {
  const payload = JSON.stringify({ type: "palestra-session", version: 1, session }, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${session.name.replace(/[^a-z0-9_-]+/gi, "_") || "sessione"}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function importSessionFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      const imported = normalizeImportedSession(parsed);
      const existingIndex = db.sessions.findIndex((session) =>
        session.id === imported.id || session.name.toLowerCase() === imported.name.toLowerCase()
      );
      imported.updatedAt = nowIso();
      if (existingIndex >= 0) {
        db.sessions[existingIndex] = imported;
      } else {
        db.sessions.push(imported);
      }
      saveDb();
      state.view = "home";
      state.modal = null;
      render();
    } catch (error) {
      window.alert(`JSON non valido: ${error.message}`);
    }
  };
  reader.readAsText(file);
}

function normalizeImportedSession(parsed) {
  const session = parsed?.type === "palestra-session" ? parsed.session : parsed;
  if (!session || typeof session !== "object") throw new Error("sessione mancante");
  const clean = normalizeDb({ sessions: [session], history: [] }).sessions[0];
  clean.activeRun = null;
  return clean;
}

function recordHistory(session, exercise, set, field, oldValue, newValue) {
  if (String(oldValue) === String(newValue)) return;
  const setIndex = exercise.sets.findIndex((item) => item.id === set.id);
  db.history.push({
    id: uid("history"),
    at: nowIso(),
    sessionId: session.id,
    sessionName: session.name,
    exerciseId: exercise.id,
    exerciseName: displayExerciseName(exercise),
    setId: set.id,
    setIndex,
    field,
    label: field === "weight" ? "Peso" : "Tempo",
    oldValue: field === "durationSeconds" ? formatDuration(oldValue) : `${oldValue} kg`,
    newValue: field === "durationSeconds" ? formatDuration(newValue) : `${newValue} kg`
  });
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  const session = sessionById(state.sessionId);

  if (action === "fullscreen") {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
    return;
  }

  if (action === "new-session") {
    state.modal = { type: "session" };
    render();
    return;
  }

  if (action === "close-modal") {
    state.modal = null;
    render();
    return;
  }

  if (action === "back-home") {
    navigate("home");
    return;
  }

  if (action === "open-session") {
    navigate("session", id || button.dataset.id);
    return;
  }

  if (action === "train-session") {
    const target = sessionById(id);
    if (!target || target.exercises.length === 0) {
      window.alert("Aggiungi almeno un esercizio prima di avviare l'allenamento.");
      return;
    }
    if (!target.exercises.some((exercise) => exercise.sets.length > 0)) {
      window.alert("Aggiungi almeno una serie a un esercizio.");
      return;
    }
    ensureRun(target);
    state.selectedExerciseId = nextExercise(target)?.id || null;
    navigate("train", id);
    return;
  }

  if (action === "new-workout") {
    const target = sessionById(id);
    if (target) {
      resetRun(target);
      state.selectedExerciseId = nextExercise(target)?.id || null;
      navigate("train", target.id);
    }
    return;
  }

  if (action === "import-session") {
    document.getElementById("import-file")?.click();
    return;
  }

  if (action === "export-session") {
    const target = sessionById(id);
    if (target) downloadSession(target);
    return;
  }

  if (action === "delete-session") {
    const target = sessionById(id);
    if (target && window.confirm(`Eliminare "${target.name}"?`)) {
      db.sessions = db.sessions.filter((item) => item.id !== id);
      saveDb();
      render();
    }
    return;
  }

  if (action === "move-session") {
    if (moveItem(db.sessions, id, toInt(button.dataset.dir, 0))) {
      saveDb();
      render();
    }
    return;
  }

  if (!session) return;

  if (action === "add-exercise") {
    const exercise = {
      id: uid("exercise"),
      name: "",
      note: "",
      mode: "reps",
      restSeconds: 60,
      sets: []
    };
    session.exercises.push(exercise);
    touchSession(session);
    saveDb();
    state.modal = { type: "exercise", exerciseId: exercise.id };
    render();
    return;
  }

  if (action === "edit-exercise") {
    state.modal = { type: "exercise", exerciseId: id };
    render();
    return;
  }

  if (action === "history-exercise") {
    state.modal = { type: "history", exerciseId: id };
    render();
    return;
  }

  if (action === "delete-exercise") {
    const exercise = exerciseById(session, id);
    if (exercise && window.confirm(`Eliminare "${displayExerciseName(exercise)}"?`)) {
      session.exercises = session.exercises.filter((item) => item.id !== id);
      touchSession(session);
      saveDb();
      render();
    }
    return;
  }

  if (action === "move-exercise") {
    if (moveItem(session.exercises, id, toInt(button.dataset.dir, 0))) {
      touchSession(session);
      saveDb();
      render();
    }
    return;
  }

  if (action === "set-mode") {
    const exercise = exerciseById(session, state.modal?.exerciseId);
    if (exercise) {
      applyExerciseFormValues(document.getElementById("exercise-form"), exercise);
      exercise.mode = button.dataset.mode === "timer" ? "timer" : "reps";
      touchSession(session);
      saveDb();
      render();
    }
    return;
  }

  if (action === "add-set-block") {
    addSetBlock(session);
    return;
  }

  if (action === "delete-set") {
    const exercise = exerciseById(session, state.modal?.exerciseId);
    if (exercise) {
      applyExerciseFormValues(document.getElementById("exercise-form"), exercise);
      exercise.sets = exercise.sets.filter((set) => set.id !== id);
      touchSession(session);
      saveDb();
      render();
    }
    return;
  }

  if (action === "move-set") {
    const exercise = exerciseById(session, state.modal?.exerciseId);
    if (exercise) {
      applyExerciseFormValues(document.getElementById("exercise-form"), exercise);
    }
    if (exercise && moveItem(exercise.sets, id, toInt(button.dataset.dir, 0))) {
      touchSession(session);
      saveDb();
      render();
    }
    return;
  }

  if (action === "choose-exercise") {
    state.selectedExerciseId = id;
    render();
    return;
  }

  if (action === "complete-reps") {
    const exercise = exerciseById(session, state.selectedExerciseId);
    const set = setById(exercise, button.dataset.setId);
    if (exercise && set) {
      markSetDone(session, exercise, set);
      beginRestOrAdvance(session, exercise, set);
    }
    return;
  }

  if (action === "start-work") {
    const exercise = exerciseById(session, state.selectedExerciseId);
    const set = setById(exercise, button.dataset.setId);
    if (exercise && set) startTimer(session, "work", exercise, set, set.durationSeconds);
    return;
  }

  if (action === "edit-current-set") {
    state.modal = { type: "current-set", setId: id };
    render();
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "import-file" && event.target.files?.[0]) {
    importSessionFile(event.target.files[0]);
    event.target.value = "";
  }
});

document.addEventListener("input", (event) => {
  if (event.target.dataset.action !== "rename-session") return;
  const session = sessionById(state.sessionId);
  if (!session) return;
  session.name = event.target.value.trim() || "Sessione";
  touchSession(session);
  saveDb();
});

document.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;

  if (form.id === "session-form") {
    const data = new FormData(form);
    const session = {
      id: uid("session"),
      name: String(data.get("name") || "Sessione").trim() || "Sessione",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      exercises: [],
      activeRun: null
    };
    db.sessions.push(session);
    saveDb();
    state.modal = null;
    navigate("session", session.id);
    return;
  }

  if (form.id === "exercise-form") {
    saveExerciseForm(form);
    return;
  }

  if (form.id === "current-set-form") {
    saveCurrentSetForm(form);
  }
});

function addSetBlock(session) {
  const exercise = exerciseById(session, state.modal?.exerciseId);
  if (!exercise) return;
  applyExerciseFormValues(document.getElementById("exercise-form"), exercise);
  const count = clamp(toInt(document.getElementById("block-count")?.value, 1), 1, 100);
  for (let i = 0; i < count; i += 1) {
    if (exercise.mode === "timer") {
      exercise.sets.push({
        id: uid("set"),
        reps: 0,
        weight: 0,
        durationSeconds: parseDuration(
          document.getElementById("block-min")?.value,
          document.getElementById("block-sec")?.value
        )
      });
    } else {
      exercise.sets.push({
        id: uid("set"),
        reps: toInt(document.getElementById("block-reps")?.value, 10),
        weight: toNumber(document.getElementById("block-weight")?.value, 0),
        durationSeconds: 0
      });
    }
  }
  touchSession(session);
  saveDb();
  render();
}

function saveExerciseForm(form) {
  const session = sessionById(state.sessionId);
  const exercise = exerciseById(session, state.modal?.exerciseId);
  if (!session || !exercise) return;
  applyExerciseFormValues(form, exercise);
  touchSession(session);
  saveDb();
  state.modal = null;
  render();
}

function applyExerciseFormValues(form, exercise) {
  if (!form || !exercise) return;
  const data = new FormData(form);
  exercise.name = String(data.get("name") || "").trim();
  exercise.note = String(data.get("note") || "");
  exercise.restSeconds = parseDuration(data.get("restMin"), data.get("restSec"));

  exercise.sets.forEach((set) => {
    if (exercise.mode === "timer") {
      const min = form.querySelector(`[data-set-id="${set.id}"][data-set-field="durationMin"]`)?.value;
      const sec = form.querySelector(`[data-set-id="${set.id}"][data-set-field="durationSec"]`)?.value;
      set.durationSeconds = parseDuration(min, sec);
    } else {
      set.reps = toInt(form.querySelector(`[data-set-id="${set.id}"][data-set-field="reps"]`)?.value, set.reps);
      set.weight = toNumber(form.querySelector(`[data-set-id="${set.id}"][data-set-field="weight"]`)?.value, set.weight);
    }
  });
}

function saveCurrentSetForm(form) {
  const session = sessionById(state.sessionId);
  const exercise = exerciseById(session, state.selectedExerciseId);
  const set = setById(exercise, state.modal?.setId);
  if (!session || !exercise || !set) return;
  const data = new FormData(form);

  if (exercise.mode === "timer") {
    const oldValue = set.durationSeconds;
    const newValue = parseDuration(data.get("durationMin"), data.get("durationSec"));
    set.durationSeconds = newValue;
    recordHistory(session, exercise, set, "durationSeconds", oldValue, newValue);
    if (session.activeRun?.timer?.kind === "work" && session.activeRun.timer.setId === set.id) {
      session.activeRun.timer.endAt = Date.now() + newValue * 1000;
      session.activeRun.timer.total = newValue;
    }
  } else {
    const oldValue = set.weight;
    const newValue = toNumber(data.get("weight"), oldValue);
    set.weight = newValue;
    recordHistory(session, exercise, set, "weight", oldValue, newValue);
  }

  touchSession(session);
  saveDb();
  state.modal = null;
  render();
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

window.addEventListener("hashchange", applyRoute);

if (!window.location.hash) {
  navigate("home", null, true);
} else {
  applyRoute();
}
