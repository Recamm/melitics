import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

if (!process.env.MELI_BROWSER_TOOLS) throw new Error('Set MELI_BROWSER_TOOLS to the temporary playwright-core installation.');
const { chromium } = createRequire(path.join(process.env.MELI_BROWSER_TOOLS, 'package.json'))('playwright-core');
const bundle = path.resolve('.output/chrome-mv3');
const profile = await mkdtemp(path.join(tmpdir(), 'meli-brave-ui-'));
const results = process.env.MELI_BROWSER_RESULTS ?? await mkdtemp(path.join(tmpdir(), 'meli-browser-results-'));
const navigationOnly = process.argv.includes('--navigation-only');
const popupRacesOnly = process.argv.includes('--popup-races-only');
const feesOnly = process.argv.includes('--fees-only');
const historyOnly = process.argv.includes('--history-only');
const marketOnly = process.argv.includes('--market-only');
const assistantOnly = process.argv.includes('--assistant-only');
const publicPagesOnly = process.argv.includes('--public-pages-only');
await mkdir(results, { recursive: true });
let context;

function launchBrowser() {
  return chromium.launchPersistentContext(profile, {
    executablePath: path.join(process.env.ProgramFiles, 'BraveSoftware/Brave-Browser/Application/brave.exe'),
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${bundle}`, `--load-extension=${bundle}`,
      '--no-first-run', '--disable-component-update',
      ...(publicPagesOnly ? [] : ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1']),
    ],
    timeout: 15000,
  });
}

async function checkPublicPages(browserContext) {
  let blockedRequests = 0;
  await browserContext.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!/^https?:$/.test(url.protocol)) return route.continue();
    const publicHost = ['mercadolibre.com.ar', 'mlstatic.com', 'meliassets.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
    const publicResource = ['document', 'script', 'stylesheet', 'image', 'font'].includes(request.resourceType());
    const privatePath = /\/(?:auth|login|registration|my-account|myaccount|api|p\/api)(?:\/|$)/i.test(url.pathname);
    if (url.protocol !== 'https:' || !publicHost || !publicResource || privatePath) {
      blockedRequests += 1;
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  const worker = browserContext.serviceWorkers()[0] ?? await browserContext.waitForEvent('serviceworker', { timeout: 15000 });
  const page = await browserContext.newPage();
  const report = { phase: 'public-pages', synthetic: false, temporaryProfile: true, readOnly: true, pages: [] };
  const searchUrl = 'https://listado.mercadolibre.com.ar/camaras-fotograficas';
  try {
    const response = await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.screenshot({ path: path.join(results, 'public-search.png') });
    const urls = await page.locator('a[href]').evaluateAll(elements => {
      const candidates = elements.flatMap(element => {
        try {
          const url = new URL(element.href);
          if (url.protocol !== 'https:' || !(url.hostname === 'mercadolibre.com.ar' || url.hostname.endsWith('.mercadolibre.com.ar'))) return [];
          if (!/^(?:\/MLA-[1-9]\d{4,19}|\/p\/MLA[1-9]\d{4,19})(?:[-/]|$)/.test(url.pathname)) return [];
          url.search = ''; url.hash = '';
          return [url.href];
        } catch { return []; }
      });
      return [...new Set(candidates)].slice(0, 2);
    });
    report.search = { url: searchUrl, httpStatus: response?.status() ?? null, publicationsFound: urls.length };
    for (const [index, url] of urls.entries()) {
      const observation = { url, verified: false };
      try {
        const publication = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        observation.httpStatus = publication?.status() ?? null;
        const title = await page.locator('.ui-pdp-title').first().innerText({ timeout: 10000 });
        const panel = page.locator('meli-extension-panel');
        await panel.getByRole('heading', { name: title.trim(), exact: true }).waitFor({ timeout: 10000 });
        const response = await worker.evaluate(async targetUrl => {
          const tabs = await chrome.tabs.query({ url: 'https://*.mercadolibre.com.ar/*' });
          const tab = tabs.find(candidate => candidate.url === targetUrl);
          if (!tab?.id) return null;
          return chrome.tabs.sendMessage(tab.id, { version: 1, requestId: crypto.randomUUID(), operation: 'panel.get', payload: {} });
        }, page.url());
        const snapshot = response?.ok ? response.data.snapshot : null;
        observation.titleMatches = snapshot?.title === title.trim();
        observation.pricePresent = snapshot?.price !== null && snapshot?.price !== undefined;
        observation.verified = observation.httpStatus === 200 && observation.titleMatches && observation.pricePresent;
        if (!observation.verified) observation.reason = 'incomplete-public-capture';
      } catch {
        observation.reason = 'public-page-blocked-or-incompatible';
      }
      await page.screenshot({ path: path.join(results, `public-publication-${index + 1}.png`) });
      report.pages.push(observation);
    }
    if (!urls.length) report.reason = 'no-accessible-public-publications';
  } catch {
    report.reason = 'public-search-unavailable';
  }
  report.blockedRequests = blockedRequests;
  report.verifiedPublications = report.pages.filter(page => page.verified).length;
  report.screenshots = results;
  await writeFile(path.join(results, 'public-pages.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report));
}

try {
  context = await launchBrowser();
  if (publicPagesOnly) {
    await checkPublicPages(context);
  } else {
  const errors = [];
  const requestHosts = [];
  const chartRequests = [];
  context.on('request', request => { if (request.url().includes('/chunks/HistoryChart-')) chartRequests.push(request.url()); });
  if (assistantOnly) context.on('request', request => { if (/^https?:/.test(request.url())) requestHosts.push(new URL(request.url()).hostname); });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;

  if (!navigationOnly && !popupRacesOnly && !feesOnly && !historyOnly && !marketOnly && !assistantOnly) {
    const preview = await context.newPage();
    for (const [state, text] of [
      ['ready', 'Captura actual'], ['partial', 'Datos parciales'], ['loading', 'Actualizando'],
      ['stale', 'Desactualizados'], ['error', 'Error de captura'], ['unsupported', 'No compatible'],
    ]) {
      await preview.goto(`http://localhost:5173/src/ui/preview.html?state=${state}`, { waitUntil: 'networkidle' });
      await preview.getByText(text, { exact: true }).waitFor();
      assert.equal(await preview.locator('.meli-app').evaluate(el => el.scrollWidth <= el.clientWidth), true);
      await preview.screenshot({ path: path.join(results, `state-${state}.png`) });
    }
    console.log(JSON.stringify({ phase: 'preview-states', states: 6, passed: true }));
  }

  const fixture = (await readFile('tests/fixtures/listing.html', 'utf8'))
    .replace('<body>', '<body style="margin:24px;background:#f8faf9;font-family:sans-serif"><main style="border-bottom:1px solid #d9e1dd"><button id="return-focus">Volver al contenido</button>')
    .replace('</body>', '</main></body>');
  const catalogFixture = marketOnly ? await readFile('tests/fixtures/catalog.html', 'utf8') : '';
  await context.route('https://**.mercadolibre.com.ar/**', route => {
    let body = fixture;
    if ((historyOnly || marketOnly) && route.request().url().includes('987654321')) {
      body = fixture.replaceAll('123456789', '987654321');
      if (marketOnly) body = body.replace('"identifier": "98765"', '"identifier": "12345"').replaceAll('TIENDA_PRUEBA', 'TIENDA_B');
    }
    if (marketOnly && route.request().url().includes('/p/MLA24681012')) body = catalogFixture;
    return route.fulfill({ status: 200, contentType: 'text/html', body });
  });
  const page = await context.newPage();
  await page.goto('https://articulo.mercadolibre.com.ar/MLA-123456789-camara-_JM');
  const panel = page.locator('meli-extension-panel');
  await panel.getByRole('heading', { name: 'Camara de prueba', exact: true }).waitFor();
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://*.mercadolibre.com.ar/*' }))[0].id);
  const panelRequest = operation => worker.evaluate(async ({ tabId, operation }) => chrome.tabs.sendMessage(tabId, {
    version: 1, requestId: crypto.randomUUID(), operation, payload: {},
  }), { tabId, operation });

  if (assistantOnly) {
    async function openAssistance(surface) {
      await surface.getByRole('tab', { name: 'Mercado', exact: true }).click();
      await surface.locator('.assistant-details > summary').click();
      const assistance = surface.getByRole('region', { name: 'Asistencia de IA', exact: true });
      await assistance.getByText('Asistencia desactivada', { exact: true }).waitFor();
      assert.equal(await assistance.getByText('USD 0', { exact: true }).count(), 1);
      assert.equal(await assistance.getByText('Ninguno', { exact: true }).count(), 1);
      const consent = assistance.getByRole('checkbox', { name: 'Consentimiento de env\u00edo', exact: true });
      assert.equal(await consent.isDisabled(), true); assert.equal(await consent.isChecked(), false);
      for (const task of ['title', 'description', 'attributes']) {
        await assistance.getByLabel('Tarea de asistencia', { exact: true }).selectOption(task);
        assert.equal(await assistance.getByRole('button', { name: 'Generar propuesta', exact: true }).isDisabled(), true);
      }
      assert.equal(await assistance.getByRole('button', { name: /Copiar/ }).count(), 0);
      return assistance;
    }
    const assistance = await openAssistance(panel);
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await assistance.getByRole('heading', { name: 'Asistencia de IA', exact: true }).scrollIntoViewIfNeeded();
      assert.equal(await panel.locator('.app-scroll').evaluate(el => el.scrollWidth <= el.clientWidth), true);
      await page.screenshot({ path: path.join(results, `assistant-panel-${width}.png`) });
    }
    await worker.evaluate(tabId => chrome.tabs.setZoom(tabId, 2), tabId);
    await assistance.getByRole('heading', { name: 'Asistencia de IA', exact: true }).scrollIntoViewIfNeeded();
    assert.equal(await panel.locator('.app-scroll').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.equal(await panel.locator('.app-scroll').evaluate(el => el.getBoundingClientRect().height >= 120), true);
    await page.screenshot({ path: path.join(results, 'assistant-panel-zoom-200.png') });
    await assistance.getByRole('button', { name: 'Generar propuesta', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(results, 'assistant-controls-zoom-200.png') });
    await worker.evaluate(tabId => chrome.tabs.setZoom(tabId, 1), tabId); await page.setViewportSize({ width: 1280, height: 900 });
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront(); await popup.reload();
    await popup.getByRole('heading', { name: 'Camara de prueba', exact: true }).waitFor();
    const popupAssistance = await openAssistance(popup);
    await popup.setViewportSize({ width: 380, height: 700 });
    await popupAssistance.getByRole('heading', { name: 'Asistencia de IA', exact: true }).scrollIntoViewIfNeeded();
    assert.equal(await popup.locator('.app-scroll').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await popup.screenshot({ path: path.join(results, 'assistant-popup-380.png') });
    const popupId = await popup.evaluate(async () => (await chrome.tabs.getCurrent()).id);
    await worker.evaluate(tabId => chrome.tabs.setZoom(tabId, 2), popupId);
    await popupAssistance.getByRole('button', { name: 'Generar propuesta', exact: true }).scrollIntoViewIfNeeded();
    assert.equal(await popup.locator('.app-scroll').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await popup.screenshot({ path: path.join(results, 'assistant-popup-zoom-200.png') });
    assert.equal(requestHosts.every(host => host.endsWith('.mercadolibre.com.ar')), true);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ phase: 'assistant', policyDisabled: true, noGeneratedData: true, noProviderRequests: true, tasks: 3, consentBlocked: true, panel: true, popup: true, mobile: true, zoom200: true, screenshots: results }));
  } else if (marketOnly) {
    await panel.getByRole('tab', { name: 'Mercado', exact: true }).click();
    await panel.getByText('Sin contactos guardados', { exact: true }).waitFor();
    assert.equal(await panel.getByRole('link', { name: 'Perfil guardado', exact: true }).count(), 0);
    await panel.getByRole('button', { name: 'Guardar perfil p\u00fablico', exact: true }).click();
    await panel.getByRole('link', { name: 'Perfil guardado', exact: true }).waitFor();
    const second = await context.newPage(); await second.goto('https://articulo.mercadolibre.com.ar/MLA-987654321-camara-_JM');
    const secondPanel = second.locator('meli-extension-panel'); await secondPanel.getByRole('tab', { name: 'Mercado', exact: true }).click();
    await secondPanel.getByText('Sin contactos guardados', { exact: true }).waitFor();
    assert.equal(await secondPanel.getByRole('link', { name: 'Perfil guardado', exact: true }).count(), 0);
    await page.reload(); await panel.getByRole('tab', { name: 'Mercado', exact: true }).click();
    await panel.getByRole('link', { name: 'Perfil guardado', exact: true }).waitFor();
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await panel.locator('.app-scroll').evaluate(el => el.scrollWidth <= el.clientWidth), true);
      await page.screenshot({ path: path.join(results, `market-panel-${width}.png`) });
    }
    await worker.evaluate(tabId => chrome.tabs.setZoom(tabId, 2), tabId);
    assert.equal(await panel.locator('.app-scroll').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.equal(await panel.locator('.view-tabs').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.equal(await panel.locator('.view-tab span').evaluateAll(elements => elements.every(el => el.getBoundingClientRect().height <= Number.parseFloat(getComputedStyle(el).lineHeight) * 1.1)), true);
    assert.equal(await panel.locator('.app-toolbar').evaluate(el => el.getBoundingClientRect().height <= 140), true);
    assert.equal(await panel.locator('.app-scroll').evaluate(el => el.getBoundingClientRect().height >= 120), true);
    await page.screenshot({ path: path.join(results, 'market-panel-zoom-200.png') });
    await worker.evaluate(tabId => chrome.tabs.setZoom(tabId, 1), tabId); await page.setViewportSize({ width: 1280, height: 900 });
    await panel.getByRole('button', { name: 'Eliminar contacto', exact: true }).click();
    const dialog = panel.getByRole('dialog', { name: 'Eliminar contacto', exact: true }); await dialog.waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Cancelar', exact: true }).evaluate(el => el === el.getRootNode().activeElement), true);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    assert.equal(await panel.getByRole('link', { name: 'Perfil guardado', exact: true }).count(), 1);
    assert.equal(await panel.getByRole('button', { name: 'Eliminar contacto', exact: true }).evaluate(el => el === el.getRootNode().activeElement), true);
    await panel.getByRole('button', { name: 'Eliminar contacto', exact: true }).click();
    await dialog.getByRole('button', { name: 'Confirmar borrado', exact: true }).click();
    await panel.getByText('Sin contactos guardados', { exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Guardar perfil p\u00fablico', exact: true }).click(); await panel.getByRole('link', { name: 'Perfil guardado', exact: true }).waitFor();
    await page.evaluate(() => {
      const node = document.querySelector('script[type="application/ld+json"]'); const data = JSON.parse(node.textContent);
      data.sku = 'MLA987654321'; data.offers.url = 'https://articulo.mercadolibre.com.ar/MLA-987654321-camara-_JM';
      data.offers.seller.identifier = '12345'; data.offers.seller.url = 'https://www.mercadolibre.com.ar/perfil/TIENDA_B';
      node.textContent = JSON.stringify(data); document.querySelector('link[rel="canonical"]').href = data.offers.url;
      history.pushState({}, '', '/MLA-987654321-camara-_JM');
    });
    await panel.getByRole('tabpanel', { name: 'Mercado', exact: true }).getByText('12345', { exact: true }).waitFor();
    await panel.getByText('Sin contactos guardados', { exact: true }).waitFor();
    assert.equal(await panel.getByRole('link', { name: 'Perfil guardado', exact: true }).count(), 0);
    const catalogPage = await context.newPage(); await catalogPage.goto('https://www.mercadolibre.com.ar/p/MLA24681012');
    const catalogPanel = catalogPage.locator('meli-extension-panel'); await catalogPanel.getByRole('tab', { name: 'Mercado', exact: true }).click();
    await catalogPanel.getByText('Sin fuente autorizada', { exact: true }).waitFor();
    assert.equal(await catalogPanel.getByRole('table', { name: 'Ofertas observadas', exact: true }).count(), 0);
    assert.equal(await catalogPanel.getByRole('button', { name: 'Guardar perfil p\u00fablico', exact: true }).isDisabled(), true);
    await catalogPage.screenshot({ path: path.join(results, 'market-unavailable.png') });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ phase: 'market', unavailableSource: true, explicitSave: true, reloadPersistence: true, twoSellers: true, spaIsolation: true, confirmations: true, escapeFocus: true, mobile: true, zoom200: true, screenshots: results }));
  } else if (historyOnly) {
    const second = await context.newPage();
    await second.goto('https://articulo.mercadolibre.com.ar/MLA-987654321-camara-_JM');
    const secondPanel = second.locator('meli-extension-panel');
    await secondPanel.getByRole('heading', { name: 'Camara de prueba', exact: true }).waitFor();
    for (const surface of [panel, secondPanel]) {
      await surface.getByRole('tab', { name: 'Historial', exact: true }).click();
      await surface.getByRole('button', { name: 'Seguir publicaci\u00f3n', exact: true }).click();
      await surface.getByRole('button', { name: 'Dejar de seguir', exact: true }).waitFor();
    }
    await Promise.all([panel, secondPanel].map(surface => surface.getByRole('button', { name: 'Guardar captura', exact: true }).click()));
    for (const surface of [panel, secondPanel]) await surface.getByText('Captura guardada.', { exact: true }).waitFor();
    assert.equal(chartRequests.length, 0, 'History in the content panel must not load the chart');
    const managementEvent = context.waitForEvent('page');
    await panel.getByRole('button', { name: 'Gr\u00e1fico y archivos', exact: true }).click();
    const management = await managementEvent;
    await management.getByText('2 / 100 publicaciones', { exact: true }).waitFor();
    const admin = (operation, payload = {}) => management.evaluate(async ({ operation, payload }) => {
      const response = await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation, payload });
      if (!response.ok) throw new Error(response.error.code);
      return response.data;
    }, { operation, payload });
    const initial = (await admin('history.export')).archive;
    assert.equal(initial.observations.length, 2);
    const input = management.getByLabel('Importar archivo', { exact: true });
    await input.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...initial, schemaVersion: 99 })) });
    await management.getByText('Archivo no valido. No se modificaron los datos.', { exact: true }).waitFor();
    assert.equal((await admin('history.info')).observationCount, 2);
    const original = initial.observations.find(item => item.publicationKey === 'MLA:listing:MLA123456789');
    const extra = [ [-4 * 86400000, 1000, 'ARS'], [-2 * 86400000, 800, 'ARS'], [-86400000, null, 'ARS'], [-43200000, 100, 'USD'] ].map(([offset, amount, currency]) => {
      const snapshot = { ...original.snapshot, observedAt: new Date(Date.now() + offset).toISOString(), title: '=SUM(A1)\n"fixture, propia"',
        price: amount === null ? null : { amountMinor: amount, currency, exponent: 2 } };
      return { publicationKey: original.publicationKey, snapshot, id: JSON.stringify([original.publicationKey, snapshot.observedAt, snapshot.price?.currency ?? null, snapshot.provenance.price?.source ?? snapshot.extractorRevision]) };
    });
    const imported = { ...initial, observations: [...initial.observations, ...extra] };
    await input.setInputFiles({ name: 'history.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
    await management.getByRole('dialog').waitFor();
    assert.equal(await management.getByRole('button', { name: 'Cancelar', exact: true }).evaluate(el => el === document.activeElement), true);
    assert.equal((await admin('history.info')).observationCount, 2);
    await management.getByRole('button', { name: 'Confirmar importaci\u00f3n', exact: true }).click();
    await management.getByText('6 / 50000 capturas', { exact: true }).waitFor();
    await management.locator('.history-chart svg').waitFor();
    assert.equal(chartRequests.length, 1, 'The own history page loads one deferred chart chunk');
    assert.equal(await management.locator('.history-chart svg').evaluate(svg => [...svg.querySelectorAll('path')].some(path => path.getAttribute('stroke') === '#12675f' && path.getAttribute('d')?.length > 4)), true);
    for (const width of [1280, 320]) {
      await management.setViewportSize({ width, height: 900 });
      assert.equal(await management.locator('.meli-app').evaluate(el => el.scrollWidth <= el.clientWidth), true);
      await management.screenshot({ path: path.join(results, `history-options-${width}.png`), fullPage: true });
    }
    await management.getByLabel('Moneda', { exact: true }).selectOption('USD');
    assert.equal(await management.locator('.history-chart figcaption').innerText(), 'Precios observados \u00b7 USD');
    await management.getByLabel('Moneda', { exact: true }).selectOption('ARS');
    const optionsId = await management.evaluate(async () => (await chrome.tabs.getCurrent()).id);
    await worker.evaluate(tabId => chrome.tabs.setZoom(tabId, 2), optionsId);
    assert.equal(await management.evaluate(() => innerWidth), 160);
    assert.equal(await management.locator('.meli-app').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.equal(await management.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await management.screenshot({ path: path.join(results, 'history-options-zoom-200.png') });
    await management.locator('.history-chart').evaluate(el => el.scrollIntoView({ block: 'center' }));
    await management.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await management.locator('.history-chart').evaluate(el => { const rect = el.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight; }), true);
    const screenshotSession = await context.newCDPSession(management);
    const visibleScreenshot = await screenshotSession.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    await writeFile(path.join(results, 'history-chart-zoom-200.png'), Buffer.from(visibleScreenshot.data, 'base64'));
    await screenshotSession.detach();
    await worker.evaluate(tabId => chrome.tabs.setZoom(tabId, 1), optionsId);
    await management.setViewportSize({ width: 1280, height: 900 });
    for (const format of ['json', 'csv']) {
      await management.getByLabel('Formato', { exact: true }).selectOption(format);
      const downloadEvent = management.waitForEvent('download');
      await management.getByRole('button', { name: 'Exportar historial', exact: true }).click();
      const download = await downloadEvent; const filename = path.join(results, `history-export.${format}`);
      await download.saveAs(filename);
      const text = await readFile(filename, 'utf8');
      if (format === 'json') assert.equal(JSON.parse(text).observations.length, 6);
      else {
        const Papa = createRequire(path.resolve('package.json'))('papaparse');
        const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
        assert.equal(parsed.errors.length, 0);
        assert.equal(parsed.data.find(row => row.title.includes('fixture, propia')).title.startsWith("'=SUM"), true);
        await input.setInputFiles(filename); await management.getByRole('dialog').waitFor();
        await management.getByRole('button', { name: 'Confirmar importaci\u00f3n', exact: true }).click();
        await management.getByText('0 capturas importadas; 6 duplicadas.', { exact: true }).waitFor();
      }
    }
    await management.getByLabel('Retenci\u00f3n propuesta', { exact: true }).selectOption('7');
    await management.getByRole('dialog').waitFor(); await management.keyboard.press('Escape');
    await management.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal((await admin('history.info')).retentionDays, 90);
    await management.getByRole('button', { name: 'Borrar todos los datos', exact: true }).click();
    await management.getByRole('button', { name: 'Cancelar', exact: true }).click();
    assert.equal(await management.getByRole('button', { name: 'Borrar todos los datos', exact: true }).evaluate(el => el === document.activeElement), true);
    assert.equal((await admin('history.info')).observationCount, 6);
    await secondPanel.getByRole('button', { name: 'Dejar de seguir', exact: true }).click();
    await secondPanel.getByRole('button', { name: 'Seguir publicaci\u00f3n', exact: true }).waitFor();
    assert.equal(await secondPanel.getByRole('button', { name: 'Guardar captura', exact: true }).isDisabled(), true);
    const beforeRestart = (await admin('history.export')).archive;
    await context.close(); context = await launchBrowser();
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    await context.setOffline(true);
    const offline = await context.newPage(); await offline.goto(`chrome-extension://${extensionId}/options.html`);
    await offline.getByText('6 / 50000 capturas', { exact: true }).waitFor();
    const afterRestart = await offline.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({ version: 1, requestId: crypto.randomUUID(), operation: 'history.export', payload: {} });
      if (!response.ok) throw new Error(response.error.code); return response.data.archive;
    });
    assert.deepEqual(afterRestart.observations, beforeRestart.observations);
    assert.deepEqual(afterRestart.publications, beforeRestart.publications);
    await offline.getByRole('button', { name: 'Eliminar MLA:listing:MLA123456789', exact: true }).click();
    await offline.getByRole('button', { name: 'Confirmar borrado', exact: true }).click();
    await offline.getByText('1 / 100 publicaciones', { exact: true }).waitFor();
    await offline.getByText('1 / 50000 capturas', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ phase: 'history', concurrentTabs: true, actualBrowserRestart: true, offline: true, safeTransfers: true, duplicates: true, confirmations: true, chartSvg: true, zoom200: true, screenshots: results }));
  } else if (feesOnly) {
    const fillScenario = async surface => {
      for (const [label, value] of [
        ['Precio de venta', '100'], ['Costo del producto', '40'], ['Comisi\u00f3n (%)', '10'],
        ['Cargo fijo', '2'], ['Env\u00edo a tu cargo', '5'], ['Impuestos fijos', '3'], ['Financiaci\u00f3n fija', '0'],
      ]) await surface.getByLabel(label, { exact: true }).fill(value);
      assert.equal(await surface.getByLabel('Ganancia neta', { exact: true }).innerText(), '$\u00a040,00');
      assert.equal(await surface.getByLabel('Monto recibido', { exact: true }).innerText(), '$\u00a080,00');
      assert.equal(await surface.getByLabel('Margen sobre venta', { exact: true }).innerText(), '40,00%');
      assert.equal(await surface.getByLabel('Retorno sobre costo', { exact: true }).innerText(), '100,00%');
    };
    await panel.getByRole('tab', { name: 'Rentabilidad', exact: true }).click();
    assert.equal(await panel.getByLabel('Ganancia neta', { exact: true }).innerText(), 'No calculable');
    await fillScenario(panel);
    for (const width of [1280, 1920, 320]) {
      await page.setViewportSize({ width, height: width === 320 ? 640 : 900 });
      await panel.getByRole('heading', { name: 'Rentabilidad', exact: true }).scrollIntoViewIfNeeded();
      assert.equal(await panel.locator('.app-scroll').evaluate(el => el.scrollWidth <= el.clientWidth), true);
      await page.screenshot({ path: path.join(results, `fees-panel-${width}.png`) });
    }
    await panel.getByRole('tab', { name: 'Resumen', exact: true }).click();
    await page.keyboard.press('ArrowRight');
    assert.equal(await panel.getByLabel('Costo del producto', { exact: true }).inputValue(), '40');
    await panel.getByLabel('Costo del producto', { exact: true }).fill('90');
    assert.equal(await panel.getByLabel('Ganancia neta', { exact: true }).innerText(), '-$\u00a010,00');
    await panel.getByLabel('Costo del producto', { exact: true }).fill('-1');
    assert.equal(await panel.getByLabel('Costo del producto', { exact: true }).getAttribute('aria-invalid'), 'true');
    assert.equal(await panel.getByLabel('Ganancia neta', { exact: true }).innerText(), 'No calculable');
    await fillScenario(panel);
    await page.setViewportSize({ width: 1280, height: 900 });
    await worker.evaluate(tabId => chrome.tabs.setZoom(tabId, 2), tabId);
    assert.equal(await worker.evaluate(tabId => chrome.tabs.getZoom(tabId), tabId), 2);
    assert.equal(await panel.locator('.app-scroll').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await panel.getByRole('heading', { name: 'Rentabilidad', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(results, 'fees-panel-zoom-200.png') });
    await worker.evaluate(tabId => chrome.tabs.setZoom(tabId, 1), tabId);
    await panel.getByRole('button', { name: 'Restablecer escenario', exact: true }).click();
    assert.equal(await panel.getByLabel('Costo del producto', { exact: true }).inputValue(), '');
    await fillScenario(panel);
    await page.locator('#return-focus').focus();
    await panelRequest('panel.open');
    assert.equal(await panel.getByRole('heading', { name: 'Rentabilidad', exact: true }).evaluate(el => el.getRootNode().activeElement === el), true);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront();
    await popup.reload();
    await popup.getByRole('heading', { name: 'Camara de prueba', exact: true }).waitFor();
    await popup.getByRole('tab', { name: 'Rentabilidad', exact: true }).click();
    await fillScenario(popup);
    await popup.setViewportSize({ width: 380, height: 600 });
    await popup.getByRole('heading', { name: 'Rentabilidad', exact: true }).scrollIntoViewIfNeeded();
    await popup.screenshot({ path: path.join(results, 'fees-popup-380.png') });
    const popupId = await popup.evaluate(async () => (await chrome.tabs.getCurrent()).id);
    await worker.evaluate(tabId => chrome.tabs.setZoom(tabId, 2), popupId);
    assert.equal(await popup.evaluate(() => innerWidth), 190);
    assert.equal(await popup.getByRole('tab', { name: 'Rentabilidad', exact: true }).locator('span').evaluate(el => {
      const range = document.createRange(); range.selectNodeContents(el); return range.getClientRects().length;
    }), 1);
    assert.equal(await popup.locator('.app-scroll').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await popup.getByRole('heading', { name: 'Rentabilidad', exact: true }).scrollIntoViewIfNeeded();
    await popup.screenshot({ path: path.join(results, 'fees-popup-zoom-200.png') });
    await popup.getByLabel('Ganancia neta', { exact: true }).scrollIntoViewIfNeeded();
    await popup.screenshot({ path: path.join(results, 'fees-popup-results-zoom-200.png') });
    assert.equal(await popup.getByLabel('Ganancia neta', { exact: true }).innerText(), '$\u00a040,00');
    await worker.evaluate(tabId => chrome.tabs.setZoom(tabId, 1), popupId);
    await popup.getByLabel('Moneda', { exact: true }).selectOption('CLP');
    assert.equal(await popup.getByLabel('Precio de venta', { exact: true }).inputValue(), '');
    assert.equal(await popup.getByLabel('Costo del producto', { exact: true }).inputValue(), '');
    await page.evaluate(() => {
      document.head.querySelectorAll('script,meta,link').forEach(el => el.remove());
      history.pushState({}, '', '/MLA-234567890-publicacion-b-_JM');
      document.querySelector('.ui-pdp-title').textContent = 'Otra publicacion';
    });
    await panel.getByRole('tabpanel', { name: 'Rentabilidad', exact: true }).getByText('Otra publicacion', { exact: true }).waitFor();
    assert.equal(await panel.getByLabel('Costo del producto', { exact: true }).inputValue(), '');
    console.log(JSON.stringify({ phase: 'fees', scenario: true, loss: true, invalid: true, tabs: true, reset: true, currency: true, navigationReset: true, focus: true, zoom200: true, screenshots: results }));
  } else if (popupRacesOnly) {
    const firstState = (await panelRequest('panel.get')).data;
    const popupWithDeferredRequests = async deferInitial => {
      const popup = await context.newPage();
      await popup.addInitScript(({ firstState, deferInitial }) => {
        const secondState = { ...firstState, snapshot: { ...firstState.snapshot, title: 'Segunda publicacion de prueba' } };
        const test = { active: 1, queryCount: 0, activated: null, rejectRefresh: null, resolveInitial: null };
        globalThis.__meliPopupTest = test;
        chrome.tabs.query = () => {
          if (deferInitial && test.queryCount++ === 0) return new Promise(resolve => { test.resolveInitial = resolve; });
          return Promise.resolve([{ id: test.active, url: 'https://articulo.mercadolibre.com.ar/MLA-123456789-camara-_JM' }]);
        };
        chrome.tabs.onActivated.addListener = callback => { test.activated = callback; };
        chrome.tabs.sendMessage = (tabId, message) => {
          if (message.operation === 'panel.refresh') return new Promise((resolve, reject) => { test.rejectRefresh = reject; });
          return Promise.resolve({ version: 1, requestId: message.requestId, ok: true, data: tabId === 1 ? firstState : secondState });
        };
      }, { firstState, deferInitial });
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      await popup.waitForFunction(() => Boolean(globalThis.__meliPopupTest?.activated));
      return popup;
    };
    const popup = await popupWithDeferredRequests(false);
    await popup.getByRole('heading', { name: 'Camara de prueba', exact: true }).waitFor();
    await popup.getByRole('button', { name: 'Actualizar datos' }).click();
    await popup.evaluate(() => { globalThis.__meliPopupTest.active = 2; globalThis.__meliPopupTest.activated({ tabId: 2 }); });
    await popup.getByRole('heading', { name: 'Segunda publicacion de prueba', exact: true }).waitFor();
    await popup.evaluate(() => globalThis.__meliPopupTest.rejectRefresh(new Error('fixture-old-tab-error')));
    await popup.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const settledStatus = await popup.getByRole('status').innerText();
    await popup.close();
    const loading = await popupWithDeferredRequests(true);
    await loading.evaluate(() => { globalThis.__meliPopupTest.active = 2; globalThis.__meliPopupTest.activated({ tabId: 2 }); });
    await loading.getByRole('heading', { name: 'Segunda publicacion de prueba', exact: true }).waitFor();
    await loading.evaluate(() => globalThis.__meliPopupTest.resolveInitial([{ id: 1, url: 'https://articulo.mercadolibre.com.ar/MLA-123456789-camara-_JM' }]));
    await loading.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const settledTitle = await loading.getByRole('heading', { level: 1 }).innerText();
    assert.deepEqual({ settledStatus, settledTitle }, { settledStatus: 'Captura actual\nMLA', settledTitle: 'Segunda publicacion de prueba' });
    console.log(JSON.stringify({ phase: 'popup-races', oldRefreshErrorIgnored: true, oldTabQueryIgnored: true }));
  } else if (navigationOnly) {
    await page.evaluate(() => history.pushState({}, '', '/my-account/orders'));
    await panel.getByText('No compatible', { exact: true }).waitFor({ timeout: 5000 });
    assert.equal((await panelRequest('panel.get')).data.snapshot, null);
    console.log(JSON.stringify({ phase: 'url-only-navigation', snapshotCleared: true }));
  } else {
    assert.equal(await panel.count(), 1);
    assert.equal(await page.locator('main').getAttribute('style'), 'border-bottom:1px solid #d9e1dd');
    assert.equal(await page.locator('body').getAttribute('style'), 'margin:24px;background:#f8faf9;font-family:sans-serif');
    const bounds = await panel.locator('.meli-app').boundingBox();
    assert.equal(Math.round(bounds.y), 12);
    assert.equal(Math.round(bounds.x + bounds.width), 1268);
    for (const width of [1280, 1920, 320]) {
      await page.setViewportSize({ width, height: width === 320 ? 640 : 900 });
      assert.equal(await panel.locator('.meli-app').evaluate(el => el.scrollWidth <= el.clientWidth), true);
      await page.screenshot({ path: path.join(results, `panel-${width}.png`) });
    }
    await page.locator('#return-focus').focus();
    assert.equal((await panelRequest('panel.open')).ok, true);
    assert.equal(await panel.getByRole('heading', { name: 'Camara de prueba' }).evaluate(el => el.getRootNode().activeElement === el), true);
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'detached' });
    assert.equal(await page.locator('#return-focus').evaluate(el => document.activeElement === el), true);
    await panelRequest('panel.open');
    await panel.getByRole('heading', { name: 'Camara de prueba' }).waitFor();
    await page.setViewportSize({ width: 1280, height: 900 });
    const zoom = await worker.evaluate(async tabId => { await chrome.tabs.setZoom(tabId, 2); return chrome.tabs.getZoom(tabId); }, tabId);
    assert.equal(zoom, 2);
    assert.equal(await page.evaluate(() => innerWidth), 640);
    assert.equal(await panel.locator('.meli-app').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await page.screenshot({ path: path.join(results, 'panel-zoom-200.png') });
    await worker.evaluate(tabId => chrome.tabs.setZoom(tabId, 1), tabId);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront();
    await popup.reload();
    await popup.getByRole('heading', { name: 'Camara de prueba' }).waitFor();
    await popup.setViewportSize({ width: 380, height: 600 });
    await popup.screenshot({ path: path.join(results, 'popup-380.png') });
    const popupId = await popup.evaluate(async () => (await chrome.tabs.getCurrent()).id);
    const popupZoom = await worker.evaluate(async tabId => { await chrome.tabs.setZoom(tabId, 2); return chrome.tabs.getZoom(tabId); }, popupId);
    assert.equal(popupZoom, 2);
    assert.equal(await popup.evaluate(() => innerWidth), 190);
    assert.equal(await popup.locator('.meli-app').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await popup.screenshot({ path: path.join(results, 'popup-zoom-200.png') });
    await worker.evaluate(tabId => chrome.tabs.setZoom(tabId, 1), popupId);
    await popup.getByText('Panel en publicaciones', { exact: true }).click();
    await panel.waitFor({ state: 'detached' });
    assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('preferences')).preferences.panelEnabled), false);
    await popup.getByText('Panel en publicaciones', { exact: true }).click();
    await panel.getByRole('heading', { name: 'Camara de prueba' }).waitFor();

    await page.evaluate(() => {
      document.head.querySelectorAll('script,meta,link').forEach(el => el.remove());
      history.pushState({}, '', '/MLA-234567890-publicacion-b-_JM');
      const main = document.createElement('main');
      main.className = 'ui-pdp-container';
      main.innerHTML = '<h1 class="ui-pdp-title">Publicacion B</h1>';
      document.querySelector('main').replaceWith(main);
    });
    await panel.getByRole('heading', { name: 'Publicacion B', exact: true }).waitFor({ timeout: 5000 });
    await page.locator('.ui-pdp-title').evaluate(el => { el.textContent = 'Publicacion B revisada'; });
    await panel.getByRole('heading', { name: 'Publicacion B revisada', exact: true }).waitFor({ timeout: 5000 });
    await popup.getByRole('heading', { name: 'Publicacion B revisada', exact: true }).waitFor();
    assert.equal(await panel.count(), 1);
    await panel.getByText('Datos parciales', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(results, 'spa-partial.png') });

    const longTitle = 'W'.repeat(500);
    await page.locator('.ui-pdp-title').evaluate((el, title) => { el.textContent = title; }, longTitle);
    await panel.getByRole('heading', { name: longTitle, exact: true }).waitFor();
    await page.setViewportSize({ width: 320, height: 900 });
    await worker.evaluate(tabId => chrome.tabs.setZoom(tabId, 2), tabId);
    assert.equal(await panel.locator('.app-scroll').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.equal(await panel.getByRole('heading', { name: longTitle, exact: true }).evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await page.screenshot({ path: path.join(results, 'long-title-500-zoom-200.png') });
    await worker.evaluate(tabId => chrome.tabs.setZoom(tabId, 1), tabId);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('.ui-pdp-title').evaluate(el => { el.textContent = 'Publicacion B revisada'; });
    await panel.getByRole('heading', { name: 'Publicacion B revisada', exact: true }).waitFor();

    await context.route('https://mlstatic.com/fixture.png', route => {
      assert.equal(route.request().headers()['referer'], undefined);
      return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ1sAAAAASUVORK5CYII=', 'base64') });
    });
    await page.evaluate(() => {
      const meta = document.createElement('meta');
      meta.setAttribute('property', 'og:image');
      meta.content = 'https://mlstatic.com/fixture.png';
      document.head.append(meta);
    });
    await panel.locator('.product-image img').waitFor();
    await panel.locator('.product-image img').evaluate(async el => { await el.decode(); });
    await popup.locator('.product-image img').waitFor();
    await popup.locator('.product-image img').evaluate(async el => { await el.decode(); });
    const closed = popup.waitForEvent('close', { timeout: 5000 });
    await popup.getByRole('button', { name: 'Abrir panel' }).click();
    await closed;
    await page.evaluate(() => history.pushState({}, '', '/my-account/orders'));
    await panel.getByText('No compatible', { exact: true }).waitFor({ timeout: 5000 });
    assert.equal((await panelRequest('panel.get')).data.snapshot, null);
    const unsupportedPopup = await context.newPage();
    await unsupportedPopup.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront();
    await unsupportedPopup.reload();
    await unsupportedPopup.getByText('No compatible', { exact: true }).waitFor();
    await unsupportedPopup.getByText('Panel en publicaciones', { exact: true }).click();
    await panel.waitFor({ state: 'detached' });
    await unsupportedPopup.getByText('Panel en publicaciones', { exact: true }).click();
    assert.equal(await panel.count(), 0);
    console.log(JSON.stringify({ phase: 'integration', shadowDOM: true, keyboard: true, popup: true, preferences: true, spa: true, zoom200: true, syntheticImage: true, unsupported: true, screenshots: results }));
  }
  if (!historyOnly) assert.equal(chartRequests.length, 0, 'Initial views must not load the history chart');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ phase: 'complete', pageErrors: errors, deferredChartRequests: chartRequests.length }));
  }
} finally {
  if (context) await context.close();
  await rm(profile, { recursive: true, force: true });
}