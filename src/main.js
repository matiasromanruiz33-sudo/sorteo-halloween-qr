import "./style.css";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "@fontsource/oswald/latin-500.css";
import "@fontsource/oswald/latin-600.css";
import "@fontsource/oswald/latin-700.css";
import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  increment,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { firebaseConfig } from "./firebase-config.js";

const ADMIN_EMAIL = "matiasromanruiz33@gmail.com";
const TICKET_PREFIX = "SN2";
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
let qrModulePromise;
let scannerModulePromise;

const loadQrCode = () => (qrModulePromise ||= import("qrcode").then((module) => module.default));
const loadScanner = () => (scannerModulePromise ||= import("html5-qrcode").then((module) => module.Html5Qrcode));

const state = {
  user: null,
  events: [],
  event: null,
  participants: [],
  tickets: [],
  eventUnsubscribe: null,
  participantUnsubscribe: null,
  ticketUnsubscribe: null,
  scanner: null,
  scannerLocked: false,
  activeEventTab: "participants",
  activeView: "events",
};

document.querySelector("#app").innerHTML = `
  <div class="noise" aria-hidden="true"></div>

  <section class="login-screen" id="login-screen">
    <div class="login-brand">
      <span class="brand-mark" aria-hidden="true"><img src="./logo.png" alt="" /></span>
      <span>SORTEO<br><b>NOCTURNO</b></span>
    </div>
    <div class="login-card">
      <p class="eyebrow">PANEL PRIVADO</p>
      <h1>Control de<br>acceso.</h1>
      <p class="login-copy">Administra eventos, sorteos y entradas únicas desde cualquier dispositivo.</p>
      <form id="login-form">
        <label>Usuario autorizado</label>
        <div class="fixed-email">${ADMIN_EMAIL}</div>
        <label for="login-password">Contraseña</label>
        <input id="login-password" type="password" autocomplete="current-password" placeholder="Ingresa tu contraseña" required />
        <p class="form-error" id="login-error" role="alert"></p>
        <button class="primary-button" id="login-button" type="submit"><span>Ingresar al panel</span><span>→</span></button>
      </form>
    </div>
  </section>

  <div class="app-shell" id="app-shell" hidden>
    <header class="topbar">
      <button class="brand nav-home" type="button" aria-label="Ir a eventos">
        <span class="brand-mark" aria-hidden="true"><img src="./logo.png" alt="" /></span>
        <span>SORTEO<br><b>NOCTURNO</b></span>
      </button>
      <nav class="main-nav" aria-label="Navegación principal">
        <button class="nav-button active" type="button" data-view="events">Eventos</button>
        <button class="nav-button" type="button" data-view="scanner">Escáner</button>
      </nav>
      <button class="session-button" id="logout-button" type="button"><span class="online-dot"></span> Cerrar sesión</button>
    </header>

    <main class="shell">
      <section class="main-view active" id="events-view">
        <div id="event-list-screen">
          <div class="page-heading">
            <div>
              <p class="eyebrow">GESTIÓN CENTRAL</p>
              <h1>Eventos</h1>
              <p>Crea sorteos gratuitos y registra entradas vendidas para cada fiesta.</p>
            </div>
            <button class="primary-button compact" id="new-event-button" type="button"><span>Nuevo evento</span><span>＋</span></button>
          </div>
          <div class="event-grid" id="event-grid"></div>
        </div>

        <div id="event-detail-screen" hidden>
          <button class="back-button" id="back-events-button" type="button">← Todos los eventos</button>
          <div class="event-heading">
            <div>
              <p class="eyebrow" id="event-date-label"></p>
              <h1 id="event-title"></h1>
              <p id="event-status-copy"></p>
            </div>
            <div class="heading-actions">
              <button class="outline-button" id="edit-event-button" type="button">Editar</button>
              <button class="danger-button" id="delete-event-button" type="button">Eliminar</button>
            </div>
          </div>

          <div class="stats-grid">
            <article><span>Participantes</span><strong id="stat-participants">0</strong></article>
            <article><span>Ganadores</span><strong id="stat-winners">0</strong></article>
            <article><span>Entradas vendidas</span><strong id="stat-sales">0</strong></article>
            <article><span>Ingresos registrados</span><strong id="stat-used">0</strong></article>
          </div>

          <nav class="event-tabs" aria-label="Secciones del evento">
            <button class="active" type="button" data-event-tab="participants">Participantes</button>
            <button type="button" data-event-tab="draw">Sorteo gratis</button>
            <button type="button" data-event-tab="sales">Entradas vendidas</button>
            <button type="button" data-event-tab="tickets">Todos los QR</button>
          </nav>

          <section class="event-panel active" id="tab-participants">
            <div class="panel-heading">
              <div><p class="eyebrow">CRUD DE PARTICIPANTES</p><h2>Lista del sorteo</h2></div>
              <button class="outline-button" id="add-participant-button" type="button">＋ Agregar nombre</button>
            </div>
            <p class="notice" id="participant-lock-notice" hidden>Para modificar participantes primero debes reiniciar el sorteo.</p>
            <div class="data-list" id="participant-list"></div>
          </section>

          <section class="event-panel" id="tab-draw">
            <div id="draw-content"></div>
          </section>

          <section class="event-panel" id="tab-sales">
            <div class="split-layout">
              <form class="sale-form" id="sale-form">
                <p class="eyebrow">NUEVA VENTA</p>
                <h2>Generar entrada</h2>
                <label for="sale-name">Nombre del cliente</label>
                <input id="sale-name" maxlength="100" placeholder="Nombre completo" required />
                <label for="sale-reference">Referencia de compra <small>(opcional)</small></label>
                <input id="sale-reference" maxlength="80" placeholder="Ej. Efectivo / transferencia 4821" />
                <button class="primary-button" type="submit"><span>Crear QR vendido</span><span>→</span></button>
              </form>
              <div>
                <div class="panel-heading small-heading"><div><p class="eyebrow">VENTAS DEL EVENTO</p><h2>Clientes registrados</h2></div></div>
                <div class="data-list" id="sales-list"></div>
              </div>
            </div>
          </section>

          <section class="event-panel" id="tab-tickets">
            <div class="panel-heading">
              <div><p class="eyebrow">CONTROL DE CÓDIGOS</p><h2>Entradas del evento</h2></div>
              <label class="search"><span>⌕</span><input id="ticket-search" type="search" placeholder="Buscar cliente" /></label>
            </div>
            <div class="ticket-grid" id="ticket-grid"></div>
          </section>
        </div>
      </section>

      <section class="main-view" id="scanner-view">
        <div class="scanner-heading">
          <p class="eyebrow">VALIDACIÓN PROTEGIDA</p>
          <h1>Escanear entrada</h1>
          <p>Solo esta cuenta autorizada puede validar códigos. El primer ingreso queda registrado globalmente.</p>
        </div>
        <div class="scanner-layout">
          <div>
            <div class="scanner-frame">
              <div id="reader"></div>
              <div class="scanner-placeholder" id="scanner-placeholder"><div class="scan-corners"></div><span>Cámara detenida</span></div>
            </div>
            <button class="primary-button full-button" id="camera-button" type="button"><span>Activar cámara</span><span>◎</span></button>
          </div>
          <div class="manual-validator">
            <p class="eyebrow">ALTERNATIVA MANUAL</p>
            <h2>Pegar código</h2>
            <p>Úsalo si la cámara no puede enfocar el QR.</p>
            <form id="manual-code-form">
              <textarea id="manual-code" rows="4" placeholder="SN2:evento:entrada:código" required></textarea>
              <button class="outline-button full-button" type="submit">Validar código</button>
            </form>
          </div>
        </div>
      </section>
    </main>

    <footer><span>BASE DE DATOS SINCRONIZADA</span><span class="online-dot-label"><i></i> EN LÍNEA</span></footer>
  </div>

  <dialog id="event-dialog" class="form-dialog">
    <button class="dialog-close" type="button" data-close-dialog="event-dialog">×</button>
    <p class="eyebrow" id="event-dialog-kicker">NUEVO EVENTO</p>
    <h2 id="event-dialog-title">Crear evento</h2>
    <form id="event-form">
      <input id="event-edit-id" type="hidden" />
      <label for="event-name">Nombre del evento</label>
      <input id="event-name" maxlength="60" placeholder="Ej. Fiesta de Halloween" required />
      <label for="event-date">Fecha <small>(opcional)</small></label>
      <input id="event-date" type="date" />
      <label for="event-winner-count">Cantidad de ganadores gratuitos</label>
      <input id="event-winner-count" type="number" min="1" max="200" value="1" required />
      <div id="initial-participants-fields">
        <div class="label-row"><label for="event-participants">Participantes, uno por línea</label><span id="initial-name-count">0 nombres</span></div>
        <textarea id="event-participants" rows="7" placeholder="María López&#10;Carlos Pérez&#10;Ana Torres"></textarea>
      </div>
      <p class="form-error" id="event-form-error"></p>
      <button class="primary-button" id="save-event-button" type="submit"><span>Guardar evento</span><span>→</span></button>
    </form>
  </dialog>

  <dialog id="participant-dialog" class="form-dialog small-dialog">
    <button class="dialog-close" type="button" data-close-dialog="participant-dialog">×</button>
    <p class="eyebrow">PARTICIPANTE</p>
    <h2 id="participant-dialog-title">Agregar nombre</h2>
    <form id="participant-form">
      <input id="participant-edit-id" type="hidden" />
      <label for="participant-name">Nombre completo</label>
      <input id="participant-name" maxlength="100" required />
      <button class="primary-button" type="submit"><span>Guardar participante</span><span>→</span></button>
    </form>
  </dialog>

  <dialog id="ticket-edit-dialog" class="form-dialog small-dialog">
    <button class="dialog-close" type="button" data-close-dialog="ticket-edit-dialog">×</button>
    <p class="eyebrow">EDITAR VENTA</p>
    <h2>Datos de la entrada</h2>
    <form id="ticket-edit-form">
      <input id="ticket-edit-id" type="hidden" />
      <label for="ticket-edit-name">Nombre del cliente</label>
      <input id="ticket-edit-name" maxlength="100" required />
      <label for="ticket-edit-reference">Referencia</label>
      <input id="ticket-edit-reference" maxlength="80" />
      <button class="primary-button" type="submit"><span>Guardar cambios</span><span>→</span></button>
    </form>
  </dialog>

  <dialog id="qr-dialog" class="qr-dialog">
    <button class="dialog-close" type="button" data-close-dialog="qr-dialog">×</button>
    <p class="eyebrow" id="qr-type"></p>
    <h2 id="qr-holder"></h2>
    <div class="large-qr"><canvas id="qr-canvas"></canvas></div>
    <p class="ticket-code" id="qr-code-label"></p>
    <div class="dialog-actions">
      <button class="primary-button" id="download-qr-button" type="button"><span>Descargar QR</span><span>↓</span></button>
      <button class="outline-button" id="copy-code-button" type="button">Copiar código</button>
    </div>
  </dialog>

  <dialog id="result-dialog" class="result-dialog">
    <div class="result-symbol" id="result-symbol"></div>
    <p class="eyebrow" id="result-kicker"></p>
    <h2 id="result-title"></h2>
    <p id="result-copy"></p>
    <button class="primary-button full-button" id="result-close" type="button"><span>Escanear siguiente</span><span>→</span></button>
  </dialog>

  <div class="toast" id="toast" role="status" aria-live="polite"></div>
`;

const elements = {
  loginScreen: document.querySelector("#login-screen"),
  appShell: document.querySelector("#app-shell"),
  loginForm: document.querySelector("#login-form"),
  loginPassword: document.querySelector("#login-password"),
  loginError: document.querySelector("#login-error"),
  eventGrid: document.querySelector("#event-grid"),
  eventListScreen: document.querySelector("#event-list-screen"),
  eventDetailScreen: document.querySelector("#event-detail-screen"),
  eventDialog: document.querySelector("#event-dialog"),
  eventForm: document.querySelector("#event-form"),
  participantDialog: document.querySelector("#participant-dialog"),
  participantForm: document.querySelector("#participant-form"),
  participantList: document.querySelector("#participant-list"),
  drawContent: document.querySelector("#draw-content"),
  salesList: document.querySelector("#sales-list"),
  ticketGrid: document.querySelector("#ticket-grid"),
  qrDialog: document.querySelector("#qr-dialog"),
  resultDialog: document.querySelector("#result-dialog"),
  scannerPlaceholder: document.querySelector("#scanner-placeholder"),
  cameraButton: document.querySelector("#camera-button"),
  toast: document.querySelector("#toast"),
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseNames(value) {
  const seen = new Set();
  return value
    .split(/\r?\n|,/)
    .map((name) => name.trim().replace(/\s+/g, " "))
    .filter((name) => {
      const key = name.toLocaleLowerCase("es");
      if (!name || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 200);
}

function formatDate(value) {
  if (!value) return "Fecha por definir";
  const date = value.toDate ? value.toDate() : new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "Fecha por definir";
  return new Intl.DateTimeFormat("es", { dateStyle: "long" }).format(date);
}

function formatUsedAt(value) {
  if (!value) return "";
  const date = value.toDate ? value.toDate() : new Date(value);
  return new Intl.DateTimeFormat("es", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function ticketPayload(eventId, ticket) {
  return `${TICKET_PREFIX}:${eventId}:${ticket.id}:${ticket.code}`;
}

function createTicketCode() {
  return crypto.randomUUID().replaceAll("-", "").toUpperCase();
}

function safeFilename(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "");
}

let toastTimer;
function showToast(message, error = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", error);
  elements.toast.classList.add("show");
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 3500);
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  if (label) button.querySelector("span").textContent = label;
}

function closeEventSubscriptions() {
  state.participantUnsubscribe?.();
  state.ticketUnsubscribe?.();
  state.participantUnsubscribe = null;
  state.ticketUnsubscribe = null;
}

function subscribeEvents() {
  state.eventUnsubscribe?.();
  state.eventUnsubscribe = onSnapshot(
    collection(db, "events"),
    (snapshot) => {
      state.events = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      renderEvents();
      if (state.event) {
        const updated = state.events.find((event) => event.id === state.event.id);
        if (updated) {
          state.event = updated;
          renderEventHeader();
        }
      }
    },
    (error) => {
      console.error(error);
      showToast("No se pudieron sincronizar los eventos.", true);
    },
  );
}

function renderEvents() {
  if (!state.events.length) {
    elements.eventGrid.innerHTML = `
      <div class="empty-state">
        <span>◇</span><h2>Tu primer evento comienza aquí</h2>
        <p>Agrega participantes, sortea entradas gratis y registra ventas.</p>
        <button class="outline-button" type="button" data-action="new-event">Crear evento</button>
      </div>`;
    return;
  }

  elements.eventGrid.innerHTML = state.events
    .map((event, index) => {
      const drawn = event.status === "drawn";
      return `
        <article class="event-card" data-event-id="${escapeHtml(event.id)}">
          <div class="card-index">${String(index + 1).padStart(2, "0")}</div>
          <div class="event-state ${drawn ? "drawn" : "draft"}">${drawn ? "SORTEO REALIZADO" : "BORRADOR"}</div>
          <p>${escapeHtml(formatDate(event.eventDate))}</p>
          <h2>${escapeHtml(event.name)}</h2>
          <div class="event-card-stats">
            <span><b>${event.participantCount || 0}</b> participantes</span>
            <span><b>${event.winnerCount || 0}</b> ganadores</span>
          </div>
          <button class="card-link" type="button" data-action="open-event" data-event-id="${escapeHtml(event.id)}">Administrar <span>→</span></button>
        </article>`;
    })
    .join("");
}

function openEvent(eventOrId) {
  const event = typeof eventOrId === "string" ? state.events.find((item) => item.id === eventOrId) : eventOrId;
  if (!event) return;
  closeEventSubscriptions();
  state.event = event;
  state.participants = [];
  state.tickets = [];
  state.activeEventTab = "participants";
  elements.eventListScreen.hidden = true;
  elements.eventDetailScreen.hidden = false;
  renderEventHeader();
  switchEventTab("participants");
  elements.participantList.innerHTML = '<div class="loading">Cargando participantes...</div>';
  elements.ticketGrid.innerHTML = '<div class="loading">Cargando entradas...</div>';

  state.participantUnsubscribe = onSnapshot(
    collection(db, "events", event.id, "participants"),
    (snapshot) => {
      state.participants = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
      renderEventData();
    },
    (error) => {
      console.error(error);
      showToast("No se pudieron cargar los participantes.", true);
    },
  );
  state.ticketUnsubscribe = onSnapshot(
    collection(db, "events", event.id, "tickets"),
    (snapshot) => {
      state.tickets = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      renderEventData();
    },
    (error) => {
      console.error(error);
      showToast("No se pudieron cargar las entradas.", true);
    },
  );
}

function renderEventHeader() {
  if (!state.event) return;
  document.querySelector("#event-title").textContent = state.event.name;
  document.querySelector("#event-date-label").textContent = formatDate(state.event.eventDate).toUpperCase();
  document.querySelector("#event-status-copy").textContent =
    state.event.status === "drawn"
      ? `Sorteo realizado para ${state.event.winnerCount || 0} ganadores.`
      : `Sorteo pendiente: ${state.event.winnerCount || 0} entradas gratuitas.`;
}

function renderEventData() {
  if (!state.event) return;
  const winners = state.participants.filter((person) => person.winner);
  const sales = state.tickets.filter((ticket) => ticket.type === "paid");
  const used = state.tickets.filter((ticket) => ticket.status === "used");
  document.querySelector("#stat-participants").textContent = state.participants.length;
  document.querySelector("#stat-winners").textContent = winners.length;
  document.querySelector("#stat-sales").textContent = sales.length;
  document.querySelector("#stat-used").textContent = used.length;
  renderParticipants();
  renderDraw();
  renderSales();
  renderTickets();
}

function renderParticipants() {
  const locked = state.event?.status === "drawn";
  document.querySelector("#participant-lock-notice").hidden = !locked;
  document.querySelector("#add-participant-button").disabled = locked;
  if (!state.participants.length) {
    elements.participantList.innerHTML = '<div class="loading">No hay participantes registrados.</div>';
    return;
  }

  elements.participantList.innerHTML = state.participants
    .map(
      (person, index) => `
        <div class="data-row">
          <span class="row-number">${String(index + 1).padStart(2, "0")}</span>
          <div class="row-main"><b>${escapeHtml(person.name)}</b><small>${person.winner ? "Ganador de entrada gratuita" : "Participante"}</small></div>
          ${person.winner ? '<span class="status-chip active">GANADOR</span>' : ""}
          <div class="row-actions">
            <button type="button" data-action="edit-participant" data-id="${escapeHtml(person.id)}" ${locked ? "disabled" : ""}>Editar</button>
            <button type="button" class="text-danger" data-action="delete-participant" data-id="${escapeHtml(person.id)}" ${locked ? "disabled" : ""}>Eliminar</button>
          </div>
        </div>`,
    )
    .join("");
}

function renderDraw() {
  if (!state.event) return;
  const winners = state.participants.filter((person) => person.winner);
  if (state.event.status !== "drawn") {
    elements.drawContent.innerHTML = `
      <div class="draw-stage">
        <p class="eyebrow">SORTEO ALEATORIO</p>
        <h2>${state.event.winnerCount || 0} ganadores entre ${state.participants.length} participantes</h2>
        <p>La selección usa aleatoriedad criptográfica. Cada ganador recibirá inmediatamente un QR gratuito único.</p>
        <div class="draw-visual"><span>${state.participants.length}</span><i>→</i><strong>${state.event.winnerCount || 0}</strong></div>
        <button class="primary-button" type="button" data-action="run-draw" ${state.participants.length < (state.event.winnerCount || 0) ? "disabled" : ""}><span>Realizar sorteo y generar QR</span><span>★</span></button>
      </div>`;
    return;
  }

  elements.drawContent.innerHTML = `
    <div class="panel-heading">
      <div><p class="eyebrow">RESULTADO DEL SORTEO</p><h2>${winners.length} ganadores</h2></div>
      <button class="danger-button" type="button" data-action="reset-draw">Reiniciar sorteo</button>
    </div>
    <div class="winner-grid">
      ${winners
        .map((person, index) => {
          const ticket = state.tickets.find((item) => item.id === person.ticketId);
          return `
            <article class="winner-card">
              <span>${String(index + 1).padStart(2, "0")}</span>
              <div><small>GANADOR</small><h3>${escapeHtml(person.name)}</h3></div>
              ${ticket ? `<button type="button" data-action="show-qr" data-id="${escapeHtml(ticket.id)}">Ver QR →</button>` : "<em>Generando QR...</em>"}
            </article>`;
        })
        .join("")}
    </div>`;
}

function renderSales() {
  const sales = state.tickets.filter((ticket) => ticket.type === "paid");
  if (!sales.length) {
    elements.salesList.innerHTML = '<div class="loading">Aún no hay entradas vendidas.</div>';
    return;
  }
  elements.salesList.innerHTML = sales
    .map(
      (ticket) => `
        <div class="data-row sale-row">
          <span class="ticket-kind">$</span>
          <div class="row-main"><b>${escapeHtml(ticket.holderName)}</b><small>${escapeHtml(ticket.reference || "Sin referencia")} · ${statusLabel(ticket.status)}</small></div>
          <div class="row-actions">
            <button type="button" data-action="show-qr" data-id="${escapeHtml(ticket.id)}">QR</button>
            <button type="button" data-action="edit-ticket" data-id="${escapeHtml(ticket.id)}">Editar</button>
            <button type="button" class="text-danger" data-action="delete-ticket" data-id="${escapeHtml(ticket.id)}">Eliminar</button>
          </div>
        </div>`,
    )
    .join("");
}

function statusLabel(status) {
  return { active: "Válida", used: "Utilizada", revoked: "Revocada" }[status] || "Desconocida";
}

function renderTickets() {
  const query = document.querySelector("#ticket-search").value.trim().toLocaleLowerCase("es");
  const tickets = state.tickets.filter((ticket) => ticket.holderName.toLocaleLowerCase("es").includes(query));
  if (!tickets.length) {
    elements.ticketGrid.innerHTML = '<div class="loading">No hay códigos para mostrar.</div>';
    return;
  }
  elements.ticketGrid.innerHTML = tickets
    .map(
      (ticket) => `
        <article class="ticket-card ${escapeHtml(ticket.status)}">
          <div class="ticket-top"><span>${ticket.type === "free" ? "ENTRADA GRATIS" : "ENTRADA VENDIDA"}</span><span class="status-chip ${escapeHtml(ticket.status)}">${statusLabel(ticket.status)}</span></div>
          <div class="mini-code">${escapeHtml(ticket.code.slice(0, 4))}<i></i>${escapeHtml(ticket.code.slice(-4))}</div>
          <small>TITULAR</small>
          <h3>${escapeHtml(ticket.holderName)}</h3>
          ${ticket.status === "used" ? `<p>Ingreso: ${escapeHtml(formatUsedAt(ticket.usedAt))}</p>` : `<p>${escapeHtml(ticket.reference || "Código individual protegido")}</p>`}
          <div class="ticket-actions">
            <button type="button" data-action="show-qr" data-id="${escapeHtml(ticket.id)}">Ver QR</button>
            <button type="button" data-action="toggle-ticket" data-id="${escapeHtml(ticket.id)}">${ticket.status === "revoked" ? "Reactivar" : "Revocar"}</button>
            <button type="button" data-action="regenerate-ticket" data-id="${escapeHtml(ticket.id)}">Regenerar</button>
          </div>
        </article>`,
    )
    .join("");
}

function switchMainView(view) {
  state.activeView = view;
  document.querySelectorAll(".main-view").forEach((panel) => panel.classList.toggle("active", panel.id === `${view}-view`));
  document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  if (view !== "scanner") stopScanner();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function switchEventTab(tab) {
  state.activeEventTab = tab;
  document.querySelectorAll("[data-event-tab]").forEach((button) => button.classList.toggle("active", button.dataset.eventTab === tab));
  document.querySelectorAll(".event-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${tab}`));
}

function backToEvents() {
  closeEventSubscriptions();
  state.event = null;
  state.participants = [];
  state.tickets = [];
  elements.eventDetailScreen.hidden = true;
  elements.eventListScreen.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openNewEventDialog() {
  elements.eventForm.reset();
  document.querySelector("#event-edit-id").value = "";
  document.querySelector("#event-dialog-kicker").textContent = "NUEVO EVENTO";
  document.querySelector("#event-dialog-title").textContent = "Crear evento";
  document.querySelector("#initial-participants-fields").hidden = false;
  document.querySelector("#event-form-error").textContent = "";
  document.querySelector("#initial-name-count").textContent = "0 nombres";
  elements.eventDialog.showModal();
}

function openEditEventDialog() {
  if (!state.event) return;
  document.querySelector("#event-edit-id").value = state.event.id;
  document.querySelector("#event-name").value = state.event.name;
  document.querySelector("#event-date").value = state.event.eventDate || "";
  document.querySelector("#event-winner-count").value = state.event.winnerCount || 1;
  document.querySelector("#event-winner-count").disabled = state.event.status === "drawn";
  document.querySelector("#event-dialog-kicker").textContent = "EDITAR EVENTO";
  document.querySelector("#event-dialog-title").textContent = state.event.name;
  document.querySelector("#initial-participants-fields").hidden = true;
  document.querySelector("#event-form-error").textContent = "";
  elements.eventDialog.showModal();
}

async function saveEvent(event) {
  event.preventDefault();
  const button = document.querySelector("#save-event-button");
  const editId = document.querySelector("#event-edit-id").value;
  const name = document.querySelector("#event-name").value.trim();
  const eventDate = document.querySelector("#event-date").value;
  const winnerCount = Number(document.querySelector("#event-winner-count").value);
  const errorElement = document.querySelector("#event-form-error");
  const names = editId ? [] : parseNames(document.querySelector("#event-participants").value);
  const participantTotal = editId ? state.participants.length : names.length;

  if (!name || !Number.isInteger(winnerCount) || winnerCount < 1) {
    errorElement.textContent = "Completa el nombre y una cantidad válida de ganadores.";
    return;
  }
  if (!editId && !names.length) {
    errorElement.textContent = "Agrega al menos un participante.";
    return;
  }
  if (winnerCount > participantTotal) {
    errorElement.textContent = "Los ganadores no pueden superar el total de participantes.";
    return;
  }

  setBusy(button, true, "Guardando...");
  try {
    if (editId) {
      await updateDoc(doc(db, "events", editId), {
        name,
        eventDate,
        ...(state.event.status === "drawn" ? {} : { winnerCount }),
        updatedAt: serverTimestamp(),
      });
      showToast("Evento actualizado.");
    } else {
      const eventRef = doc(collection(db, "events"));
      const batch = writeBatch(db);
      batch.set(eventRef, {
        name,
        eventDate,
        winnerCount,
        participantCount: names.length,
        status: "draft",
        drawAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      names.forEach((participantName) => {
        const participantRef = doc(collection(db, "events", eventRef.id, "participants"));
        batch.set(participantRef, {
          name: participantName,
          winner: false,
          ticketId: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      showToast(`${names.length} participantes registrados.`);
      elements.eventDialog.close();
      openEvent({
        id: eventRef.id,
        name,
        eventDate,
        winnerCount,
        participantCount: names.length,
        status: "draft",
        drawAt: null,
      });
      return;
    }
    elements.eventDialog.close();
  } catch (error) {
    console.error(error);
    errorElement.textContent = "No se pudo guardar. Revisa la conexión.";
  } finally {
    setBusy(button, false, "Guardar evento");
  }
}

function openParticipantDialog(participant = null) {
  document.querySelector("#participant-edit-id").value = participant?.id || "";
  document.querySelector("#participant-name").value = participant?.name || "";
  document.querySelector("#participant-dialog-title").textContent = participant ? "Editar nombre" : "Agregar nombre";
  elements.participantDialog.showModal();
}

async function saveParticipant(event) {
  event.preventDefault();
  if (!state.event || state.event.status === "drawn") return;
  const participantId = document.querySelector("#participant-edit-id").value;
  const name = document.querySelector("#participant-name").value.trim().replace(/\s+/g, " ");
  if (!name) return;
  try {
    if (participantId) {
      await updateDoc(doc(db, "events", state.event.id, "participants", participantId), { name, updatedAt: serverTimestamp() });
      showToast("Participante actualizado.");
    } else {
      if (state.participants.length >= 200) {
        showToast("El máximo es de 200 participantes.", true);
        return;
      }
      const participantRef = doc(collection(db, "events", state.event.id, "participants"));
      const batch = writeBatch(db);
      batch.set(participantRef, { name, winner: false, ticketId: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      batch.update(doc(db, "events", state.event.id), { participantCount: increment(1), updatedAt: serverTimestamp() });
      await batch.commit();
      showToast("Participante agregado.");
    }
    elements.participantDialog.close();
  } catch (error) {
    console.error(error);
    showToast("No se pudo guardar el participante.", true);
  }
}

async function deleteParticipant(participantId) {
  if (!state.event || state.event.status === "drawn") return;
  const participant = state.participants.find((item) => item.id === participantId);
  if (!participant || !confirm(`¿Eliminar a ${participant.name} del sorteo?`)) return;
  if (state.participants.length - 1 < state.event.winnerCount) {
    showToast("Reduce primero la cantidad de ganadores del evento.", true);
    return;
  }
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, "events", state.event.id, "participants", participantId));
    batch.update(doc(db, "events", state.event.id), { participantCount: increment(-1), updatedAt: serverTimestamp() });
    await batch.commit();
    showToast("Participante eliminado.");
  } catch (error) {
    console.error(error);
    showToast("No se pudo eliminar el participante.", true);
  }
}

function secureShuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    const swapIndex = random[0] % (index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

async function runDraw() {
  if (!state.event || state.event.status === "drawn") return;
  const winnerCount = state.event.winnerCount || 0;
  if (winnerCount < 1 || winnerCount > state.participants.length) {
    showToast("La cantidad de ganadores no es válida.", true);
    return;
  }
  if (!confirm(`¿Sortear ${winnerCount} ganadores? El resultado quedará registrado.`)) return;
  try {
    const winners = secureShuffle(state.participants).slice(0, winnerCount);
    const batch = writeBatch(db);
    winners.forEach((person) => {
      const ticketRef = doc(collection(db, "events", state.event.id, "tickets"));
      batch.set(ticketRef, {
        type: "free",
        holderName: person.name,
        participantId: person.id,
        reference: "Ganador del sorteo",
        code: createTicketCode(),
        status: "active",
        usedAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(db, "events", state.event.id, "participants", person.id), {
        winner: true,
        ticketId: ticketRef.id,
        updatedAt: serverTimestamp(),
      });
    });
    batch.update(doc(db, "events", state.event.id), { status: "drawn", drawAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await batch.commit();
    switchEventTab("draw");
    showToast(`${winnerCount} ganadores y QR gratuitos generados.`);
  } catch (error) {
    console.error(error);
    showToast("No se pudo completar el sorteo.", true);
  }
}

async function resetDraw() {
  if (!state.event || state.event.status !== "drawn") return;
  if (!confirm("¿Reiniciar el sorteo? Se eliminarán los QR gratuitos actuales. Las entradas vendidas no cambian.")) return;
  try {
    const batch = writeBatch(db);
    state.participants
      .filter((person) => person.winner)
      .forEach((person) => {
        batch.update(doc(db, "events", state.event.id, "participants", person.id), {
          winner: false,
          ticketId: null,
          updatedAt: serverTimestamp(),
        });
      });
    state.tickets
      .filter((ticket) => ticket.type === "free")
      .forEach((ticket) => batch.delete(doc(db, "events", state.event.id, "tickets", ticket.id)));
    batch.update(doc(db, "events", state.event.id), { status: "draft", drawAt: null, updatedAt: serverTimestamp() });
    await batch.commit();
    showToast("Sorteo reiniciado. Ya puedes editar participantes.");
  } catch (error) {
    console.error(error);
    showToast("No se pudo reiniciar el sorteo.", true);
  }
}

async function createSale(event) {
  event.preventDefault();
  if (!state.event) return;
  const nameInput = document.querySelector("#sale-name");
  const referenceInput = document.querySelector("#sale-reference");
  const name = nameInput.value.trim().replace(/\s+/g, " ");
  const reference = referenceInput.value.trim();
  if (!name) return;
  const button = event.submitter;
  setBusy(button, true, "Generando...");
  try {
    const ticketRef = doc(collection(db, "events", state.event.id, "tickets"));
    const batch = writeBatch(db);
    batch.set(ticketRef, {
      type: "paid",
      holderName: name,
      participantId: null,
      reference,
      code: createTicketCode(),
      status: "active",
      usedAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, "events", state.event.id), { updatedAt: serverTimestamp() });
    await batch.commit();
    event.target.reset();
    showToast(`Entrada vendida creada para ${name}.`);
    setTimeout(() => showQr(ticketRef.id), 400);
  } catch (error) {
    console.error(error);
    showToast("No se pudo generar la entrada.", true);
  } finally {
    setBusy(button, false, "Crear QR vendido");
  }
}

function openTicketEditDialog(ticketId) {
  const ticket = state.tickets.find((item) => item.id === ticketId && item.type === "paid");
  if (!ticket) return;
  document.querySelector("#ticket-edit-id").value = ticket.id;
  document.querySelector("#ticket-edit-name").value = ticket.holderName;
  document.querySelector("#ticket-edit-reference").value = ticket.reference || "";
  document.querySelector("#ticket-edit-dialog").showModal();
}

async function saveTicketEdit(event) {
  event.preventDefault();
  if (!state.event) return;
  const ticketId = document.querySelector("#ticket-edit-id").value;
  const holderName = document.querySelector("#ticket-edit-name").value.trim().replace(/\s+/g, " ");
  const reference = document.querySelector("#ticket-edit-reference").value.trim();
  try {
    await updateDoc(doc(db, "events", state.event.id, "tickets", ticketId), { holderName, reference, updatedAt: serverTimestamp() });
    document.querySelector("#ticket-edit-dialog").close();
    showToast("Entrada actualizada.");
  } catch (error) {
    console.error(error);
    showToast("No se pudo actualizar la entrada.", true);
  }
}

async function deleteTicket(ticketId) {
  if (!state.event) return;
  const ticket = state.tickets.find((item) => item.id === ticketId && item.type === "paid");
  if (!ticket || !confirm(`¿Eliminar definitivamente la entrada de ${ticket.holderName}?`)) return;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, "events", state.event.id, "tickets", ticket.id));
    batch.update(doc(db, "events", state.event.id), { updatedAt: serverTimestamp() });
    await batch.commit();
    showToast("Entrada eliminada.");
  } catch (error) {
    console.error(error);
    showToast("No se pudo eliminar la entrada.", true);
  }
}

async function toggleTicket(ticketId) {
  if (!state.event) return;
  const ticket = state.tickets.find((item) => item.id === ticketId);
  if (!ticket) return;
  const nextStatus = ticket.status === "revoked" ? "active" : "revoked";
  try {
    await updateDoc(doc(db, "events", state.event.id, "tickets", ticket.id), {
      status: nextStatus,
      usedAt: nextStatus === "active" ? null : ticket.usedAt || null,
      updatedAt: serverTimestamp(),
    });
    showToast(nextStatus === "active" ? "Entrada reactivada." : "Entrada revocada.");
  } catch (error) {
    console.error(error);
    showToast("No se pudo cambiar el estado.", true);
  }
}

async function regenerateTicket(ticketId) {
  if (!state.event) return;
  const ticket = state.tickets.find((item) => item.id === ticketId);
  if (!ticket || !confirm(`¿Invalidar el QR anterior de ${ticket.holderName} y generar uno nuevo?`)) return;
  try {
    await updateDoc(doc(db, "events", state.event.id, "tickets", ticket.id), {
      code: createTicketCode(),
      status: "active",
      usedAt: null,
      updatedAt: serverTimestamp(),
    });
    showToast("QR regenerado. El código anterior ya no funciona.");
    setTimeout(() => showQr(ticket.id), 350);
  } catch (error) {
    console.error(error);
    showToast("No se pudo regenerar el QR.", true);
  }
}

async function showQr(ticketId) {
  const ticket = state.tickets.find((item) => item.id === ticketId);
  if (!ticket || !state.event) return;
  const payload = ticketPayload(state.event.id, ticket);
  const QRCode = await loadQrCode();
  document.querySelector("#qr-type").textContent = ticket.type === "free" ? "ENTRADA GRATUITA" : "ENTRADA VENDIDA";
  document.querySelector("#qr-holder").textContent = ticket.holderName;
  document.querySelector("#qr-code-label").textContent = `${ticket.code.slice(0, 8)} · ${statusLabel(ticket.status)}`;
  const canvas = document.querySelector("#qr-canvas");
  await QRCode.toCanvas(canvas, payload, {
    width: 330,
    margin: 2,
    errorCorrectionLevel: "H",
    color: { dark: "#080808", light: "#ffffff" },
  });
  elements.qrDialog.dataset.ticketId = ticket.id;
  elements.qrDialog.dataset.payload = payload;
  elements.qrDialog.showModal();
}

async function downloadQr() {
  const ticket = state.tickets.find((item) => item.id === elements.qrDialog.dataset.ticketId);
  if (!ticket || !state.event) return;
  const QRCode = await loadQrCode();
  const canvas = document.createElement("canvas");
  await QRCode.toCanvas(canvas, ticketPayload(state.event.id, ticket), {
    width: 1200,
    margin: 5,
    errorCorrectionLevel: "H",
    color: { dark: "#080808", light: "#ffffff" },
  });
  const link = document.createElement("a");
  link.download = `${safeFilename(state.event.name)}-${safeFilename(ticket.holderName)}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

async function deleteEvent() {
  if (!state.event || !confirm(`¿Eliminar ${state.event.name} y todos sus participantes, ventas y códigos? Esta acción no se puede deshacer.`)) return;
  const eventId = state.event.id;
  try {
    const participantSnapshot = await getDocs(collection(db, "events", eventId, "participants"));
    const ticketSnapshot = await getDocs(collection(db, "events", eventId, "tickets"));
    const references = [...participantSnapshot.docs, ...ticketSnapshot.docs].map((item) => item.ref);
    for (let index = 0; index < references.length; index += 400) {
      const batch = writeBatch(db);
      references.slice(index, index + 400).forEach((reference) => batch.delete(reference));
      await batch.commit();
    }
    const finalBatch = writeBatch(db);
    finalBatch.delete(doc(db, "events", eventId));
    await finalBatch.commit();
    backToEvents();
    showToast("Evento eliminado completamente.");
  } catch (error) {
    console.error(error);
    showToast("No se pudo eliminar el evento.", true);
  }
}

async function startScanner() {
  if (state.scanner?.isScanning) {
    await stopScanner();
    return;
  }
  const Html5Qrcode = await loadScanner();
  state.scanner ||= new Html5Qrcode("reader");
  try {
    elements.cameraButton.disabled = true;
    await state.scanner.start(
      { facingMode: "environment" },
      {
        fps: 12,
        qrbox: (width, height) => ({ width: Math.min(width, height) * 0.7, height: Math.min(width, height) * 0.7 }),
      },
      handleScan,
      () => {},
    );
    elements.scannerPlaceholder.hidden = true;
    elements.cameraButton.querySelector("span").textContent = "Detener cámara";
  } catch (error) {
    console.error(error);
    showToast("No fue posible abrir la cámara. Revisa el permiso del navegador.", true);
  } finally {
    elements.cameraButton.disabled = false;
  }
}

async function stopScanner() {
  if (!state.scanner?.isScanning) return;
  await state.scanner.stop();
  elements.scannerPlaceholder.hidden = false;
  elements.cameraButton.querySelector("span").textContent = "Activar cámara";
}

function parseTicket(rawValue) {
  const [prefix, eventId, ticketId, code] = rawValue.trim().split(":");
  if (prefix !== TICKET_PREFIX || !eventId || !ticketId || !code) return null;
  return { eventId, ticketId, code };
}

async function handleScan(rawValue) {
  if (state.scannerLocked) return;
  state.scannerLocked = true;
  if (state.scanner?.isScanning) state.scanner.pause(true);
  const parsed = parseTicket(rawValue);
  if (!parsed) {
    showResult("invalid", "Código desconocido", "Este QR no fue generado por el sistema.");
    return;
  }
  await redeemTicket(parsed);
}

async function redeemTicket({ eventId, ticketId, code }) {
  try {
    const result = await runTransaction(db, async (transaction) => {
      const eventRef = doc(db, "events", eventId);
      const ticketRef = doc(db, "events", eventId, "tickets", ticketId);
      const [eventSnapshot, ticketSnapshot] = await Promise.all([transaction.get(eventRef), transaction.get(ticketRef)]);
      if (!eventSnapshot.exists() || !ticketSnapshot.exists()) return { status: "invalid" };
      const ticket = ticketSnapshot.data();
      if (ticket.code !== code) return { status: "invalid" };
      if (ticket.status === "used") return { status: "used", ticket, eventName: eventSnapshot.data().name };
      if (ticket.status === "revoked") return { status: "revoked", ticket, eventName: eventSnapshot.data().name };
      transaction.update(ticketRef, { status: "used", usedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      return { status: "valid", ticket, eventName: eventSnapshot.data().name };
    });

    if (result.status === "valid") {
      showResult("valid", "Ingreso autorizado", `${result.ticket.holderName} · ${result.eventName}`);
      navigator.vibrate?.([100, 50, 100]);
    } else if (result.status === "used") {
      showResult("used", "Entrada ya utilizada", `${result.ticket.holderName} ya registró su ingreso.`);
      navigator.vibrate?.(400);
    } else if (result.status === "revoked") {
      showResult("revoked", "Entrada revocada", `El código de ${result.ticket.holderName} fue desactivado.`);
      navigator.vibrate?.(400);
    } else {
      showResult("invalid", "Código falsificado o inválido", "Los datos del QR no coinciden con ninguna entrada activa.");
    }
  } catch (error) {
    console.error(error);
    showResult("error", "No se pudo validar", "Comprueba la conexión e inténtalo nuevamente.");
  }
}

function showResult(type, title, copy) {
  const content = {
    valid: ["✓", "ENTRADA CONFIRMADA"],
    used: ["!", "ACCESO DENEGADO"],
    revoked: ["×", "CÓDIGO REVOCADO"],
    invalid: ["×", "CÓDIGO NO VÁLIDO"],
    error: ["…", "ERROR DE CONEXIÓN"],
  }[type];
  elements.resultDialog.dataset.type = type;
  document.querySelector("#result-symbol").textContent = content[0];
  document.querySelector("#result-kicker").textContent = content[1];
  document.querySelector("#result-title").textContent = title;
  document.querySelector("#result-copy").textContent = copy;
  elements.resultDialog.showModal();
}

function closeResult() {
  elements.resultDialog.close();
  setTimeout(() => {
    state.scannerLocked = false;
    if (state.scanner?.isScanning) {
      try {
        state.scanner.resume();
      } catch {
        // The camera may have been stopped while the result was open.
      }
    }
  }, 700);
}

async function handleLogin(event) {
  event.preventDefault();
  const button = document.querySelector("#login-button");
  elements.loginError.textContent = "";
  setBusy(button, true, "Verificando...");
  try {
    await signInWithEmailAndPassword(auth, ADMIN_EMAIL, elements.loginPassword.value);
    elements.loginForm.reset();
  } catch (error) {
    console.error(error);
    elements.loginError.textContent = "Contraseña incorrecta o acceso no disponible.";
  } finally {
    setBusy(button, false, "Ingresar al panel");
  }
}

async function handleLogout() {
  await stopScanner();
  await signOut(auth);
}

elements.loginForm.addEventListener("submit", handleLogin);
document.querySelector("#logout-button").addEventListener("click", handleLogout);
document.querySelector(".nav-home").addEventListener("click", () => {
  switchMainView("events");
  backToEvents();
});
document.querySelectorAll(".nav-button").forEach((button) => button.addEventListener("click", () => switchMainView(button.dataset.view)));
document.querySelector("#new-event-button").addEventListener("click", openNewEventDialog);
document.querySelector("#back-events-button").addEventListener("click", backToEvents);
document.querySelector("#edit-event-button").addEventListener("click", openEditEventDialog);
document.querySelector("#delete-event-button").addEventListener("click", deleteEvent);
document.querySelector("#add-participant-button").addEventListener("click", () => openParticipantDialog());
document.querySelectorAll("[data-event-tab]").forEach((button) => button.addEventListener("click", () => switchEventTab(button.dataset.eventTab)));
document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => document.querySelector(`#${button.dataset.closeDialog}`).close()));
elements.eventForm.addEventListener("submit", saveEvent);
elements.participantForm.addEventListener("submit", saveParticipant);
document.querySelector("#sale-form").addEventListener("submit", createSale);
document.querySelector("#ticket-edit-form").addEventListener("submit", saveTicketEdit);
document.querySelector("#ticket-search").addEventListener("input", renderTickets);
document.querySelector("#event-participants").addEventListener("input", (event) => {
  const count = parseNames(event.target.value).length;
  document.querySelector("#initial-name-count").textContent = `${count} nombre${count === 1 ? "" : "s"}`;
});
elements.cameraButton.addEventListener("click", startScanner);
document.querySelector("#manual-code-form").addEventListener("submit", (event) => {
  event.preventDefault();
  handleScan(document.querySelector("#manual-code").value);
  event.target.reset();
});
document.querySelector("#download-qr-button").addEventListener("click", downloadQr);
document.querySelector("#copy-code-button").addEventListener("click", async () => {
  await navigator.clipboard.writeText(elements.qrDialog.dataset.payload);
  showToast("Código copiado.");
});
document.querySelector("#result-close").addEventListener("click", closeResult);
elements.resultDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeResult();
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, id, eventId } = button.dataset;
  if (action === "new-event") openNewEventDialog();
  if (action === "open-event") openEvent(eventId);
  if (action === "edit-participant") openParticipantDialog(state.participants.find((item) => item.id === id));
  if (action === "delete-participant") deleteParticipant(id);
  if (action === "run-draw") runDraw();
  if (action === "reset-draw") resetDraw();
  if (action === "show-qr") showQr(id);
  if (action === "edit-ticket") openTicketEditDialog(id);
  if (action === "delete-ticket") deleteTicket(id);
  if (action === "toggle-ticket") toggleTicket(id);
  if (action === "regenerate-ticket") regenerateTicket(id);
});

setPersistence(auth, browserLocalPersistence).catch(console.error);
onAuthStateChanged(auth, (user) => {
  state.user = user;
  if (user) {
    elements.loginScreen.hidden = true;
    elements.appShell.hidden = false;
    subscribeEvents();
  } else {
    state.eventUnsubscribe?.();
    closeEventSubscriptions();
    state.events = [];
    state.event = null;
    elements.appShell.hidden = true;
    elements.loginScreen.hidden = false;
  }
});
