import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
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
await mkdir(results, { recursive: true });
let context;

try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: path.join(process.env.ProgramFiles, 'BraveSoftware/Brave-Browser/Application/brave.exe'),
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${bundle}`, `--load-extension=${bundle}`,
      '--no-first-run', '--disable-component-update',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
    ],
    timeout: 15000,
  });
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;

  if (!navigationOnly && !popupRacesOnly && !feesOnly) {
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
  await context.route('https://**.mercadolibre.com.ar/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
  const page = await context.newPage();
  await page.goto('https://articulo.mercadolibre.com.ar/MLA-123456789-camara-_JM');
  const panel = page.locator('meli-extension-panel');
  await panel.getByRole('heading', { name: 'Camara de prueba', exact: true }).waitFor();
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://*.mercadolibre.com.ar/*' }))[0].id);
  const panelRequest = operation => worker.evaluate(async ({ tabId, operation }) => chrome.tabs.sendMessage(tabId, {
    version: 1, requestId: crypto.randomUUID(), operation, payload: {},
  }), { tabId, operation });

  if (feesOnly) {
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
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ phase: 'complete', pageErrors: errors }));
} finally {
  if (context) await context.close();
  await rm(profile, { recursive: true, force: true });
}