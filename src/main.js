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
  collection,
  doc,
  getFirestore,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { firebaseConfig } from "./firebase-config.js";

const STORAGE_KEY = "sorteo-nocturno-events-v1";
const TICKET_PREFIX = "SN1";
const isConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
const db = isConfigured ? getFirestore(initializeApp(firebaseConfig)) : null;
let qrModulePromise;
let scannerModulePromise;

const loadQrCode = () => (qrModulePromise ||= import("qrcode").then((module) => module.default));
const loadScanner = () => (scannerModulePromise ||= import("html5-qrcode").then((module) => module.Html5Qrcode));

const state = {
  activeView: "create",
  event: null,
  participants: [],
  scanner: null,
  scannerLocked: false,
  unsubscribe: null,
};

document.querySelector("#app").innerHTML = `
  <div class="noise" aria-hidden="true"></div>
  <header class="topbar">
    <a class="brand" href="./" aria-label="Sorteo Nocturno, inicio">
      <span class="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 48 48"><path d="M24 4 29 14l11 2-8 8 2 12-10-6-10 6 2-12-8-8 11-2 5-10Z"/></svg>
      </span>
      <span>SORTEO<br><b>NOCTURNO</b></span>
    </a>
    <button class="icon-button" id="help-button" type="button" aria-label="Cómo funciona">?</button>
  </header>

  <main class="shell">
    <section class="hero">
      <p class="eyebrow">PASES DIGITALES / ACCESO ÚNICO</p>
      <h1>Una entrada.<br><span>Una oportunidad.</span></h1>
      <p class="hero-copy">Carga los nombres, entrega cada código y controla el ingreso desde la cámara de cualquier celular.</p>
    </section>

    <nav class="tabs" aria-label="Secciones">
      <button class="tab active" type="button" data-view="create"><span>01</span> Crear</button>
      <button class="tab" type="button" data-view="passes"><span>02</span> Pases</button>
      <button class="tab" type="button" data-view="scan"><span>03</span> Escanear</button>
    </nav>

    <section class="panel active" id="view-create">
      <div class="section-heading">
        <div>
          <p class="eyebrow">NUEVO SORTEO</p>
          <h2>Lista de participantes</h2>
        </div>
        <span class="step-badge">PASO 1</span>
      </div>
      <form id="create-form">
        <label for="event-name">Nombre del evento</label>
        <input id="event-name" maxlength="60" autocomplete="off" placeholder="Ej. Noche de Halloween" required />
        <div class="label-row">
          <label for="names">Nombres, uno por línea</label>
          <span id="name-count">0 participantes</span>
        </div>
        <textarea id="names" rows="8" placeholder="María López&#10;Carlos Pérez&#10;Ana Torres" required></textarea>
        <p class="field-hint">Los nombres repetidos se agregarán una sola vez. Máximo 200.</p>
        <button class="primary-button" type="submit" id="create-button">
          <span>Generar pases QR</span><span aria-hidden="true">→</span>
        </button>
      </form>
      <div class="saved-events" id="saved-events"></div>
    </section>

    <section class="panel" id="view-passes">
      <div id="passes-empty" class="empty-state">
        <div class="empty-icon" aria-hidden="true">◇</div>
        <h2>Aún no hay pases</h2>
        <p>Crea un sorteo o abre uno guardado en este dispositivo.</p>
        <button class="secondary-button" type="button" data-go="create">Crear sorteo</button>
      </div>
      <div id="passes-content" hidden>
        <div class="event-summary">
          <div>
            <p class="eyebrow">SORTEO ACTIVO</p>
            <h2 id="active-event-name"></h2>
            <p id="active-event-date" class="muted"></p>
          </div>
          <div class="counter"><strong id="available-count">0</strong><span>disponibles</span></div>
        </div>
        <div class="toolbar">
          <label class="search"><span aria-hidden="true">⌕</span><input id="participant-search" type="search" placeholder="Buscar nombre" /></label>
          <button class="small-button" id="print-button" type="button">Imprimir todos</button>
        </div>
        <div class="passes-grid" id="passes-grid"></div>
      </div>
    </section>

    <section class="panel" id="view-scan">
      <div class="scanner-heading">
        <p class="eyebrow">CONTROL DE ACCESO</p>
        <h2>Escanear un pase</h2>
        <p>Apunta la cámara al código QR. La primera lectura lo invalida en todos los dispositivos.</p>
      </div>
      <div class="scanner-frame" id="scanner-frame">
        <div id="reader"></div>
        <div class="scanner-placeholder" id="scanner-placeholder">
          <div class="scan-corners" aria-hidden="true"></div>
          <p>La cámara está detenida</p>
        </div>
      </div>
      <button class="primary-button" id="camera-button" type="button">Activar cámara</button>
      <p class="camera-note">El navegador solicitará permiso para usar la cámara trasera.</p>
    </section>
  </main>

  <footer>
    <span>ESTADO GLOBAL EN TIEMPO REAL</span>
    <span class="live-dot">EN LÍNEA</span>
  </footer>

  <dialog id="result-dialog" class="result-dialog">
    <div id="result-symbol" class="result-symbol"></div>
    <p class="eyebrow" id="result-kicker"></p>
    <h2 id="result-title"></h2>
    <p id="result-copy"></p>
    <button class="primary-button" id="result-close" type="button">Escanear siguiente</button>
  </dialog>

  <dialog id="help-dialog" class="help-dialog">
    <button class="dialog-close" type="button" aria-label="Cerrar">×</button>
    <p class="eyebrow">CÓMO FUNCIONA</p>
    <h2>Tres pasos. Sin complicaciones.</h2>
    <ol>
      <li><b>Crea:</b> escribe el nombre del evento y pega la lista de invitados.</li>
      <li><b>Comparte:</b> descarga o imprime el QR individual de cada persona.</li>
      <li><b>Valida:</b> abre el escáner en cualquier celular. Un QR aceptado no vuelve a funcionar.</li>
    </ol>
  </dialog>

  <div class="toast" id="toast" role="status" aria-live="polite"></div>
`;

const elements = {
  form: document.querySelector("#create-form"),
  nameInput: document.querySelector("#event-name"),
  namesInput: document.querySelector("#names"),
  nameCount: document.querySelector("#name-count"),
  createButton: document.querySelector("#create-button"),
  savedEvents: document.querySelector("#saved-events"),
  passesEmpty: document.querySelector("#passes-empty"),
  passesContent: document.querySelector("#passes-content"),
  passesGrid: document.querySelector("#passes-grid"),
  eventName: document.querySelector("#active-event-name"),
  eventDate: document.querySelector("#active-event-date"),
  availableCount: document.querySelector("#available-count"),
  search: document.querySelector("#participant-search"),
  cameraButton: document.querySelector("#camera-button"),
  scannerPlaceholder: document.querySelector("#scanner-placeholder"),
  resultDialog: document.querySelector("#result-dialog"),
  resultSymbol: document.querySelector("#result-symbol"),
  resultKicker: document.querySelector("#result-kicker"),
  resultTitle: document.querySelector("#result-title"),
  resultCopy: document.querySelector("#result-copy"),
  toast: document.querySelector("#toast"),
};

function getNames() {
  const seen = new Set();
  return elements.namesInput.value
    .split(/\r?\n|,/)
    .map((name) => name.trim().replace(/\s+/g, " "))
    .filter((name) => {
      const normalized = name.toLocaleLowerCase("es");
      if (!name || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .slice(0, 200);
}

function getSavedEvents() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveEventLocally(event) {
  const events = getSavedEvents().filter((item) => item.id !== event.id);
  events.unshift(event);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(0, 10)));
  renderSavedEvents();
}

function renderSavedEvents() {
  const events = getSavedEvents();
  if (!events.length) {
    elements.savedEvents.innerHTML = "";
    return;
  }

  elements.savedEvents.innerHTML = `
    <div class="saved-title"><span>Sorteos guardados</span><span>${events.length}</span></div>
    ${events
      .map(
        (event) => `
          <button class="saved-event" type="button" data-event-id="${escapeHtml(event.id)}">
            <span><b>${escapeHtml(event.name)}</b><small>${event.count} participantes</small></span>
            <span aria-hidden="true">→</span>
          </button>`,
      )
      .join("")}
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setView(view) {
  state.activeView = view;
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === `view-${view}`));
  if (view !== "scan" && state.scanner?.isScanning) stopScanner();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function ensureConfigured() {
  if (isConfigured) return true;
  showToast("Firebase aún no está configurado en esta publicación.", true);
  return false;
}

async function createEvent(event) {
  event.preventDefault();
  if (!ensureConfigured()) return;

  const name = elements.nameInput.value.trim();
  const names = getNames();
  if (!name || !names.length) return;
  if (names.length > 200) {
    showToast("El máximo es de 200 participantes.", true);
    return;
  }

  elements.createButton.disabled = true;
  elements.createButton.firstElementChild.textContent = "Creando sorteo...";
  try {
    const eventRef = doc(collection(db, "events"));
    const batch = writeBatch(db);
    batch.set(eventRef, {
      name,
      participantCount: names.length,
      createdAt: serverTimestamp(),
    });

    names.forEach((participantName) => {
      const participantRef = doc(collection(db, "events", eventRef.id, "participants"));
      batch.set(participantRef, {
        name: participantName,
        usedAt: null,
        createdAt: serverTimestamp(),
      });
    });
    await batch.commit();

    const localEvent = {
      id: eventRef.id,
      name,
      count: names.length,
      createdAt: new Date().toISOString(),
    };
    saveEventLocally(localEvent);
    openEvent(localEvent);
    elements.form.reset();
    elements.nameCount.textContent = "0 participantes";
    showToast(`${names.length} pases creados correctamente.`);
    setView("passes");
  } catch (error) {
    console.error(error);
    showToast("No se pudo crear el sorteo. Revisa la conexión.", true);
  } finally {
    elements.createButton.disabled = false;
    elements.createButton.firstElementChild.textContent = "Generar pases QR";
  }
}

function openEvent(event) {
  if (!ensureConfigured()) return;
  state.unsubscribe?.();
  state.event = event;
  state.participants = [];
  elements.passesEmpty.hidden = true;
  elements.passesContent.hidden = false;
  elements.eventName.textContent = event.name;
  elements.eventDate.textContent = `Creado ${new Intl.DateTimeFormat("es", { dateStyle: "medium" }).format(new Date(event.createdAt))}`;
  elements.passesGrid.innerHTML = '<div class="loading">Cargando pases...</div>';

  state.unsubscribe = onSnapshot(
    collection(db, "events", event.id, "participants"),
    (snapshot) => {
      state.participants = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
      renderParticipants();
    },
    (error) => {
      console.error(error);
      showToast("No se pudieron cargar los pases.", true);
    },
  );
}

function ticketUrl(eventId, ticketId) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("ticket", `${eventId}.${ticketId}`);
  return url.toString();
}

function renderParticipants() {
  const query = elements.search.value.trim().toLocaleLowerCase("es");
  const participants = state.participants.filter((person) => person.name.toLocaleLowerCase("es").includes(query));
  const available = state.participants.filter((person) => !person.usedAt).length;
  elements.availableCount.textContent = available;

  if (!participants.length) {
    elements.passesGrid.innerHTML = '<div class="loading">No hay coincidencias.</div>';
    return;
  }

  elements.passesGrid.innerHTML = participants
    .map(
      (person, index) => `
        <article class="pass-card ${person.usedAt ? "used" : ""}">
          <div class="pass-topline"><span>PASE ${String(index + 1).padStart(3, "0")}</span><span>${person.usedAt ? "UTILIZADO" : "VÁLIDO"}</span></div>
          <div class="qr-wrap"><canvas data-qr="${escapeHtml(person.id)}"></canvas></div>
          <div class="pass-name">
            <small>INVITADO</small>
            <h3>${escapeHtml(person.name)}</h3>
          </div>
          <div class="pass-actions">
            <button type="button" data-download="${escapeHtml(person.id)}" ${person.usedAt ? "disabled" : ""}>Descargar QR</button>
            <button type="button" data-copy="${escapeHtml(person.id)}">Copiar enlace</button>
          </div>
        </article>`,
    )
    .join("");

  loadQrCode().then((QRCode) => participants.forEach((person) => {
    const canvas = elements.passesGrid.querySelector(`[data-qr="${CSS.escape(person.id)}"]`);
    if (!canvas) return;
    QRCode.toCanvas(canvas, ticketUrl(state.event.id, person.id), {
      width: 190,
      margin: 1,
      color: { dark: "#080808", light: "#ffffff" },
      errorCorrectionLevel: "M",
    });
  }));
}

async function downloadTicket(ticketId) {
  const person = state.participants.find((item) => item.id === ticketId);
  if (!person) return;
  const QRCode = await loadQrCode();
  const canvas = document.createElement("canvas");
  await QRCode.toCanvas(canvas, ticketUrl(state.event.id, ticketId), {
    width: 1000,
    margin: 4,
    color: { dark: "#080808", light: "#ffffff" },
    errorCorrectionLevel: "H",
  });
  const link = document.createElement("a");
  link.download = `${safeFilename(state.event.name)}-${safeFilename(person.name)}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function safeFilename(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
}

async function startScanner() {
  if (!ensureConfigured()) return;
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
      { fps: 12, qrbox: (width, height) => ({ width: Math.min(width, height) * 0.7, height: Math.min(width, height) * 0.7 }) },
      handleScan,
      () => {},
    );
    elements.scannerPlaceholder.hidden = true;
    elements.cameraButton.textContent = "Detener cámara";
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
  elements.cameraButton.textContent = "Activar cámara";
}

function parseTicket(rawValue) {
  try {
    const url = new URL(rawValue);
    const value = url.searchParams.get("ticket");
    if (value) {
      const [eventId, ticketId] = value.split(".");
      if (eventId && ticketId) return { eventId, ticketId };
    }
  } catch {
    // The QR may contain the compact internal format instead of a URL.
  }

  const [prefix, eventId, ticketId] = rawValue.trim().split(":");
  return prefix === TICKET_PREFIX && eventId && ticketId ? { eventId, ticketId } : null;
}

async function handleScan(decodedText) {
  if (state.scannerLocked) return;
  state.scannerLocked = true;
  const ticket = parseTicket(decodedText);
  if (!ticket) {
    showResult("invalid", "Código desconocido", "Este QR no pertenece a Sorteo Nocturno.");
    return;
  }
  await redeemTicket(ticket.eventId, ticket.ticketId);
}

async function redeemTicket(eventId, ticketId) {
  if (!ensureConfigured()) return;
  try {
    const participantRef = doc(db, "events", eventId, "participants", ticketId);
    const result = await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(participantRef);
      if (!snapshot.exists()) return { status: "invalid" };
      const participant = snapshot.data();
      if (participant.usedAt) return { status: "used", name: participant.name };
      transaction.update(participantRef, { usedAt: serverTimestamp() });
      return { status: "valid", name: participant.name };
    });

    if (result.status === "valid") {
      showResult("valid", "Acceso autorizado", result.name);
      navigator.vibrate?.([100, 50, 100]);
    } else if (result.status === "used") {
      showResult("used", "Pase ya utilizado", `${result.name} ya registró su ingreso.`);
      navigator.vibrate?.(400);
    } else {
      showResult("invalid", "Código no válido", "No encontramos este pase en el sorteo.");
    }
  } catch (error) {
    console.error(error);
    showResult("error", "Sin conexión", "No se pudo comprobar el pase. Inténtalo de nuevo.");
  }
}

function showResult(type, title, copy) {
  const content = {
    valid: ["✓", "PASE CONFIRMADO"],
    used: ["!", "ACCESO DENEGADO"],
    invalid: ["×", "CÓDIGO INVÁLIDO"],
    error: ["…", "ERROR DE CONEXIÓN"],
  }[type];
  elements.resultDialog.dataset.type = type;
  elements.resultSymbol.textContent = content[0];
  elements.resultKicker.textContent = content[1];
  elements.resultTitle.textContent = title;
  elements.resultCopy.textContent = copy;
  elements.resultDialog.showModal();
}

function closeResult() {
  elements.resultDialog.close();
  setTimeout(() => {
    state.scannerLocked = false;
  }, 900);
}

let toastTimer;
function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.classList.add("show");
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 3500);
}

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.view)));
document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.go)));
elements.namesInput.addEventListener("input", () => {
  const count = getNames().length;
  elements.nameCount.textContent = `${count} participante${count === 1 ? "" : "s"}`;
});
elements.form.addEventListener("submit", createEvent);
elements.search.addEventListener("input", renderParticipants);
elements.cameraButton.addEventListener("click", startScanner);
document.querySelector("#print-button").addEventListener("click", () => window.print());
document.querySelector("#result-close").addEventListener("click", closeResult);
elements.resultDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeResult();
});
elements.passesGrid.addEventListener("click", async (event) => {
  const downloadButton = event.target.closest("[data-download]");
  const copyButton = event.target.closest("[data-copy]");
  if (downloadButton) await downloadTicket(downloadButton.dataset.download);
  if (copyButton) {
    await navigator.clipboard.writeText(ticketUrl(state.event.id, copyButton.dataset.copy));
    showToast("Enlace del pase copiado.");
  }
});
elements.savedEvents.addEventListener("click", (event) => {
  const button = event.target.closest("[data-event-id]");
  if (!button) return;
  const savedEvent = getSavedEvents().find((item) => item.id === button.dataset.eventId);
  if (savedEvent) {
    openEvent(savedEvent);
    setView("passes");
  }
});

const helpDialog = document.querySelector("#help-dialog");
document.querySelector("#help-button").addEventListener("click", () => helpDialog.showModal());
document.querySelector(".dialog-close").addEventListener("click", () => helpDialog.close());

renderSavedEvents();

const directTicket = new URLSearchParams(window.location.search).get("ticket");
if (directTicket) {
  const [eventId, ticketId] = directTicket.split(".");
  setView("scan");
  if (eventId && ticketId && ensureConfigured()) redeemTicket(eventId, ticketId);
}
