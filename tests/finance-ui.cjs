const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const puppeteer = require("puppeteer-core");
const ExcelJS = require("exceljs");

(async () => {
  process.env.VITE_USE_EMULATORS = "true";
  const { createServer } = await import("vite");
  const { initializeTestEnvironment } = await import("@firebase/rules-unit-testing");
  const { doc, getDocs, collection, serverTimestamp, writeBatch } = await import("firebase/firestore");
  const { OWNER_UID, OPERATOR_UID, OPERATOR_EMAIL, today } = await import("../src/finance-core.js");
  const { recordActivity } = await import("../src/audit-store.js");
  const env = await initializeTestEnvironment({ projectId: "demo-mirage-finance", firestore: { host: "127.0.0.1", port: 8085 } });
  const ownerDb = env.authenticatedContext(OWNER_UID, { email: "matiasromanruiz33@gmail.com" }).firestore();
  const password = "LocalTestOnly!2026";
  async function authApi(endpoint, input) {
    const response = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/${endpoint}?key=demo-key`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer owner" }, body: JSON.stringify(input) });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return body;
  }
  await authApi("accounts:signUp", { localId: OWNER_UID, email: "matiasromanruiz33@gmail.com", password, emailVerified: true });
  await authApi("accounts:signUp", { localId: OPERATOR_UID, email: OPERATOR_EMAIL, password, emailVerified: false });
  await authApi("accounts:signUp", { localId: "9GPk0CuI60fz8oQ7FAtPvcX49VI3", email: "anderson.2008.cobos@gmail.com", password });
  const profileBatch = writeBatch(ownerDb), profileAudit = doc(collection(ownerDb, "userAudit"));
  profileBatch.set(profileAudit, { actorUid: OWNER_UID, actorEmail: "matiasromanruiz33@gmail.com", subjectUid: OPERATOR_UID, action: "Perfil de prueba", createdAt: serverTimestamp() });
  profileBatch.set(doc(ownerDb, "users", OPERATOR_UID), { email: OPERATOR_EMAIL, role: "operator", active: true, auditId: profileAudit.id, updatedAt: serverTimestamp() });
  await profileBatch.commit();

  const output = path.join(process.env.TEMP || process.env.TMP || "/tmp", "opencode", "finance-ui-downloads");
  await fs.mkdir(output, { recursive: true });
  const initialFiles = new Set(await fs.readdir(output));
  const server = await createServer({ server: { host: "127.0.0.1", port: 4173, strictPort: true } });
  await server.listen();
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const errors = [];
    page.on("dialog", (dialog) => dialog.accept());
    page.on("pageerror", (error) => errors.push(error.message));
    const session = await page.createCDPSession();
    await session.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: output });
    await page.goto("http://127.0.0.1:4173", { waitUntil: "networkidle0" });
    async function fill(selector, value) {
      await page.$eval(selector, (input, value) => { input.value = String(value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); }, value);
    }
    async function login(email) {
      await fill("#login-email", email); await fill("#login-password", password); await page.click("#login-button");
    }
    async function logout() {
      await page.click("#logout-button"); await page.waitForSelector("#login-screen:not([hidden])");
    }
    async function modalFill(values) {
      await page.waitForSelector(".fin-dialog[open] #fin-modal-form");
      for (const [key, value] of Object.entries(values)) await fill(`.fin-dialog [name="${key}"]`, value);
    }
    async function saveModal() {
      await page.click("#fin-submit");
      await page.waitForFunction(() => !document.querySelector(".fin-dialog").open || Boolean(document.querySelector("#fin-modal-error")?.textContent));
      const error = await page.$eval("#fin-modal-error", (el) => el.textContent).catch(() => "");
      assert.equal(error, "");
      await page.waitForFunction(() => !document.querySelector(".fin-dialog").open);
    }
    await login("matiasromanruiz33@gmail.com");
    await page.waitForSelector("#app-shell:not([hidden])");
    await page.click("#new-event-button");
    await fill("#event-name", "Evento financiero de prueba UI");
    await fill("#event-date", today());
    await fill("#event-participants", "Participante temporal");
    await page.click("#save-event-button");
    await page.waitForFunction(() => !document.querySelector("#event-dialog").open);
    const [automaticallyLinked] = (await getDocs(collection(ownerDb, "financeEvents"))).docs;
    assert.ok(automaticallyLinked.data().assignedUids.includes(OPERATOR_UID), "VMC must be linked at creation, before opening financial settings");
    await page.waitForSelector('#participant-list [data-action="edit-participant"]');
    await page.click('#participant-list [data-action="edit-participant"]');
    await fill("#participant-name", "Ganador temporal");
    await page.click('#participant-form button[type="submit"]');
    await page.waitForFunction(() => !document.querySelector("#participant-dialog").open);
    await page.click("#add-participant-button"); await fill("#participant-name", "Eliminar temporal");
    await page.click('#participant-form button[type="submit"]');
    await page.waitForFunction(() => document.querySelectorAll("#participant-list .data-row").length === 2);
    await page.$$eval('#participant-list [data-action="delete-participant"]', (buttons) => buttons[0].click());
    await page.waitForFunction(() => document.querySelectorAll("#participant-list .data-row").length === 1);
    await page.click('[data-event-tab="draw"]');
    await page.click('[data-action="run-draw"]');
    await page.waitForSelector('[data-action="show-qr"]');
    await page.click('#draw-content [data-action="show-qr"]');
    await page.waitForSelector("#qr-dialog[open]");
    await page.click("#download-qr-button");
    await page.click('#qr-dialog [data-close-dialog]');
    const [ticketForScan] = (await getDocs(collection(ownerDb, "events", automaticallyLinked.id, "tickets"))).docs;
    const scanPayload = `SN2:${automaticallyLinked.id}:${ticketForScan.id}:${ticketForScan.data().code}`;
    await page.click('[data-view="finance"]');
    await page.click('[data-fin="section"][data-id="events"]');
    await page.waitForSelector('[data-fin="configure"]');
    await page.click('[data-fin="configure"]');
    await modalFill({ budget: 500, location: "Quito", eventTime: "20:00" });
    for (const key of ["allowDiscounts", "allowRefunds"]) await page.$eval(`.fin-dialog [name="${key}"]`, (input) => { input.checked = true; });
    await saveModal();
    const [financialEvent] = (await getDocs(collection(ownerDb, "financeEvents"))).docs;
    assert.ok(financialEvent.data().assignedUids.includes(OPERATOR_UID));
    await logout();

    await login(OPERATOR_EMAIL);
    await page.waitForSelector("#verification-panel:not([hidden])");
    assert.equal(await page.$eval("#app-shell", (el) => el.hidden), true);
    await authApi("accounts:update", { localId: OPERATOR_UID, emailVerified: true });
    const account = await authApi("accounts:lookup", { localId: [OPERATOR_UID] });
    assert.equal(account.users[0].emailVerified, true);
    await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(async (error) => {
      console.error("Verification UI:", await page.$eval("#verification-message", (el) => el.textContent));
      throw error;
    }), page.click("#verification-refresh")]);
    await page.waitForSelector("#finance-view.active", { timeout: 30000 });
    assert.equal(await page.$eval('[data-view="events"]', (el) => el.hidden), true);
    assert.equal(await page.$eval('[data-view="scanner"]', (el) => el.hidden), true);
    await page.waitForFunction(() => document.querySelector("#fin-event-select").options.length === 2);
    await page.select("#fin-event-select", financialEvent.id);
    await page.waitForFunction(() => !document.querySelector("#finance-view").textContent.includes("Sincronizando registros"));
    await page.click('[data-fin="section"][data-id="funding"]');
    await page.click('[data-fin="funding"]');
    await modalFill({ concept: "Capital inicial", amount: 500 }); await saveModal();
    await page.click('[data-fin="section"][data-id="products"]');
    await page.click('[data-fin="new-product"]');
    await modalFill({ name: "Agua de prueba", category: "Bebidas", quantity: 100, unitCost: 1, salePrice: 3, supplier: "Proveedor demo" }); await saveModal();
    await page.waitForFunction(() => document.querySelector("#finance-view").textContent.includes("Agua de prueba"));
    await page.click('[data-fin="section"][data-id="expenses"]');
    await page.click('[data-fin="expense"]');
    await modalFill({ concept: "DJ", category: "Artistas", amount: 50 }); await saveModal();
    await page.click('[data-fin="section"][data-id="sales"]');
    await page.click('[data-fin="sale"]');
    await modalFill({ quantity: 25, discount: 5 }); await saveModal();
    await page.click('[data-fin="section"][data-id="home"]');
    await page.waitForFunction(() => document.querySelector("#finance-view").textContent.includes("75"));
    const products = (await getDocs(collection(ownerDb, "financeEvents", financialEvent.id, "products"))).docs;
    assert.equal(products[0].data().stock, 75);
    await page.click('[data-fin="section"][data-id="cash"]');
    await page.click('[data-fin="closure"]'); await modalFill({ counted: 419, note: "Conteo de prueba" }); await saveModal();
    const closures = (await getDocs(collection(ownerDb, "financeEvents", financialEvent.id, "closures"))).docs;
    assert.equal(closures[0].data().expectedCents, 42000);
    assert.equal(closures[0].data().differenceCents, -100);

    await page.click('[data-fin="section"][data-id="reports"]');
    await page.click('[data-fin="excel"]');
    await page.click('[data-fin="pdf"]');
    async function waitDownload(extension, prefix = "Mirage-") {
      for (let retry = 0; retry < 120; retry++) {
        const match = (await fs.readdir(output)).find((file) => !initialFiles.has(file) && file.startsWith(prefix) && file.endsWith(extension));
        if (match) return path.join(output, match);
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error(`Reporte ${extension} no descargado`);
    }
    const excel = await waitDownload(".xlsx"), pdf = await waitDownload(".pdf");
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(excel);
    assert.equal(workbook.getWorksheet("Productos e inventario").getCell("E2").value, 75);
    assert.equal(workbook.getWorksheet("Resultados financieros").getCell("B6").value.result, -5);
    const pdfBytes = await fs.readFile(pdf); assert.ok(pdfBytes.toString("ascii", 0, 5).startsWith("%PDF-"));
    assert.ok(pdfBytes.length > 10000);
    await page.setViewport({ width: 375, height: 812 });
    await page.screenshot({ path: path.join(output, "operational-mobile.png"), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await logout();
    await login("matiasromanruiz33@gmail.com"); await page.waitForSelector("#events-view.active");
    await page.click('[data-view="finance"]');
    await page.waitForFunction(() => document.querySelector("#fin-event-select").options.length === 2);
    await page.select("#fin-event-select", financialEvent.id);
    await page.waitForFunction(() => document.querySelector("#finance-view").textContent.includes("75"));
    await page.setViewport({ width: 1280, height: 900 });
    await Promise.all(Array.from({ length: 255 }, (_, index) => recordActivity(ownerDb, { uid: OWNER_UID, email: "matiasromanruiz33@gmail.com" }, { action: "test.pagination", summary: `Lectura de prueba ${index}`, eventId: financialEvent.id })));
    await page.click('[data-view="audit"]');
    await page.waitForSelector('[data-audit="refresh"]:not([disabled])');
    await page.click('[data-audit="refresh"]');
    await page.waitForSelector('[data-audit="excel"]:not([disabled])');
    const auditCount = await page.$eval(".audit-metrics article:first-child strong", (el) => Number(el.textContent));
    assert.ok(auditCount > 250);
    assert.equal(await page.$$eval(".audit-table tbody tr", (rows) => rows.length), 50);
    await page.click('[data-audit="next"]');
    await page.click('[data-audit="excel"]');
    const auditExcel = await waitDownload(".xlsx", "Mirage-Auditoria-");
    await page.waitForSelector('[data-audit="pdf"]:not([disabled])');
    await page.click('[data-audit="pdf"]');
    const auditPdf = await waitDownload(".pdf", "Mirage-Auditoria-");
    const auditBook = new ExcelJS.Workbook(); await auditBook.xlsx.readFile(auditExcel);
    assert.equal(auditBook.getWorksheet("Auditoría").rowCount, auditCount + 1);
    assert.equal(auditBook.getWorksheet("Resumen").getCell("B3").value, auditCount);
    const contents = JSON.stringify(auditBook.model);
    assert.ok(!contents.includes(ticketForScan.data().code));
    assert.ok(contents.includes("draw.run"));
    assert.ok(contents.includes("finance.sale"));
    assert.ok(contents.includes("cash.close"));
    assert.ok((await fs.readFile(auditPdf)).toString("ascii", 0, 5).startsWith("%PDF-"));
    await page.waitForSelector('[data-audit="refresh"]:not([disabled])');
    await page.setViewport({ width: 375, height: 812 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(output, "audit-mobile.png"), fullPage: true });
    await logout();
    await login("anderson.2008.cobos@gmail.com"); await page.waitForSelector("#scanner-view.active");
    assert.equal(await page.$eval('[data-view="finance"]', (el) => el.hidden), true);
    assert.equal(await page.$eval('[data-view="audit"]', (el) => el.hidden), true);
    await fill("#manual-code", scanPayload); await page.click('#manual-code-form button[type="submit"]');
    await page.waitForSelector("#result-dialog[open]");
    assert.equal(await page.$eval("#result-title", (el) => el.textContent), "Ingreso autorizado");
    await page.click("#result-close"); await new Promise((r) => setTimeout(r, 800));
    await fill("#manual-code", scanPayload); await page.click('#manual-code-form button[type="submit"]');
    await page.waitForSelector("#result-dialog[open]");
    assert.equal(await page.$eval("#result-title", (el) => el.textContent), "Entrada ya utilizada");
    const auditEntries = (await getDocs(collection(ownerDb, "systemAudit"))).docs.map((d) => d.data());
    assert.ok(auditEntries.some((log) => log.action === "qr.redeem" && log.role === "scanner"));
    assert.ok(auditEntries.some((log) => log.action === "qr.reject" && log.outcome === "rejected"));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ flow: "events and draw audited → operator finance → audit PDF/XLSX all pages → scanner success and rejection", stock: 75, profitUSD: -5, cashUSD: 420, mobileOverflow: false, auditCount, errors, excel, pdf, auditExcel, auditPdf }));
  } finally { await browser?.close(); await server.close(); await env.cleanup(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
