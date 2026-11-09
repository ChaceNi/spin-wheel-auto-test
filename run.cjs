#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { assess, summaryOf, visibleCode } = require('./checks.cjs');
const { selectBrowser } = require('./browser-mode.cjs');
const { createBatchGate } = require('./batch-gate.cjs');
const { options } = require('./options.cjs');
const { bootstrap, performApi, runPool } = require('./api-mode.cjs');
const { createPages } = require('./pages.cjs');

function playwright() {
  for (const name of ['playwright', process.env.PLAYWRIGHT_MODULE, '/Users/chace/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean)) {
    try { return require(name); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw Error('Playwright not installed. Run: npm install');
}
const config = options(process.argv.slice(2));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const root = __dirname;
const out = path.resolve(config.out || path.join(root, 'output', stamp));
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, '.run-lock'), stamp, { flag: 'wx' });
const rows = [];
const previousCodes = new Set();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let stopped = false;
process.on('SIGINT', () => { stopped = true; console.log('\nStop requested; finishing active requests without retrying.'); });
process.on('SIGTERM', () => { stopped = true; });
const log = event => console.log(JSON.stringify({ at: new Date().toISOString(), ...event }));
const summary = () => summaryOf(rows, { ...config, runId: stamp, actualConcurrency: Math.min(config.mode === 'api' ? config.concurrency : config.tabs, config.count) });
function save() {
  const value = summary();
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(value, null, 2));
  fs.writeFileSync(path.join(out, 'anomalies.json'), JSON.stringify(rows.filter(r => r.issues.length), null, 2));
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(rows, null, 2));
}
function event(value) {
  fs.appendFileSync(path.join(out, 'events.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n');
}
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /token|password|secret|authorization|cookie/i.test(key) ? '[redacted]' : redact(item)]));
  return value;
}
async function setupPage(context, navigate = true) {
  const page = await context.newPage();
  try {
    page.setDefaultTimeout(config.timeoutMs);
    await page.addLocatorHandler(page.getByRole('dialog', { name: 'POPUP Form', exact: true }), async dialog => {
      await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click({ force: true, timeout: 3000 }).catch(() => { });
    });
    if (navigate) await page.goto(config.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    return page;
  } catch (error) {
    await page.close().catch(() => { });
    throw error;
  }
}
async function frameWith(page, selector) {
  const deadline = Date.now() + config.timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) if (await frame.locator(selector).first().isVisible().catch(() => false)) return frame;
    await wait(250);
  }
  throw Error(`Visible control not found: ${selector}`);
}
async function authenticate(browser) {
  const context = await browser.newContext();
  try {
    const page = await setupPage(context);
    if (new URL(page.url()).pathname === '/password') {
      if (!process.env.SHOP_PASSWORD) throw Error('SHOP_PASSWORD is required; put it in .env');
      await page.getByRole('button', { name: 'Enter using password' }).click();
      await page.locator('input[type="password"]').fill(process.env.SHOP_PASSWORD);
      await page.locator('input[type="password"]').press('Enter');
      await page.waitForURL(url => url.pathname !== '/password', { waitUntil: 'domcontentloaded', timeout: 90000 });
    }
    if (new URL(page.url()).pathname !== '/pages/spin-to-win-test') await page.goto(config.url, { waitUntil: 'domcontentloaded' });
    return (await context.cookies()).filter(cookie => /(^|\.)lakeside\.com$/.test(cookie.domain.replace(/^\./, '')) && !/wheel|spin|carecart/i.test(cookie.name));
  } finally { await context.close(); }
}
async function perform(slot, round, gate, batch) {
  const { page } = slot;
  const alias = (process.env.TEST_EMAIL || 'Chace.N@onergroup.com').split('@');
  if (alias.length !== 2) throw Error('TEST_EMAIL must be an email address');
  const row = { round, batch, tab: slot.number, email: `${alias[0]}+ui${stamp.replace(/\D/g, '').slice(0, 17)}-${String(round).padStart(4, '0')}@${alias[1]}`, name: ['Alex', 'Jamie', 'Morgan', 'Taylor'][round % 4] + ' Test', startedAt: new Date().toISOString(), outcome: 'pending', code: null, base: null, issues: [], api: [], consoleErrors: [] };
  event({ event: 'round_started', round, tab: row.tab, email: row.email });
  const pending = new Set();
  let engine, coupon, customer, resultFrame;
  let clicked = false;
  let arrived = false;
  const errors = error => { if (row.consoleErrors.length < 30) row.consoleErrors.push(error.message); };
  page.on('pageerror', errors);
  const responseHandler = response => {
    const url = new URL(response.url());
    if (!clicked || url.origin !== 'https://dev.lakeside.com' || !['/apps/wheelify/postengine', '/apps/wheelify/getcoupons', '/apps/wheelify/postcustomerinfo'].includes(url.pathname)) return;
    const promise = (async () => {
      let body;
      try { body = await response.json(); } catch { body = { nonJson: true }; }
      const record = { endpoint: url.pathname, at: new Date().toISOString(), httpStatus: response.status(), body: redact(body) };
      row.api.push(record);
      event({ event: 'api_response', round, ...record });
      if (url.pathname.endsWith('/postengine')) engine = record;
      if (url.pathname.endsWith('/getcoupons')) coupon = record;
      if (url.pathname.endsWith('/postcustomerinfo')) customer = record;
    })().catch(error => row.api.push({ endpoint: url.pathname, error: error.message }));
    pending.add(promise); promise.finally(() => pending.delete(promise));
  };
  page.on('response', responseHandler);
  const requestHandler = request => {
    if (!clicked || request.method() !== 'POST' || new URL(request.url()).pathname !== '/apps/wheelify/postengine') return;
    row.drawRequestAt = new Date().toISOString();
    try { const data = request.postDataJSON(); row.requestEmail = data.email; row.visitorId = data.CData; } catch { }
    event({ event: 'draw_request', round, batch, at: row.drawRequestAt, email: row.requestEmail, visitorId: row.visitorId });
  };
  page.on('request', requestHandler);
  try {
    const trigger = await frameWith(page, '#wheelify-spin-trigger-cc');
    await trigger.locator('#wheelify-spin-trigger-cc').click();
    resultFrame = await frameWith(page, '#cc_spinner_full_name');
    await resultFrame.locator('#cc_spinner_full_name').fill(row.name);
    await resultFrame.locator('#cc_spinner_email').fill(row.email);
    await resultFrame.locator('#cc-spin-consent-checkbox').check();
    await resultFrame.locator('#spin_wheel_btn').waitFor({ state: 'visible' });
    arrived = true;
    event({ event: 'draw_ready', round, batch, tab: row.tab });
    await gate.arrive();
    if (stopped) throw Error('Stopped before submission');
    row.submittedAt = new Date().toISOString(); clicked = true;
    event({ event: 'draw_submitted', round, tab: row.tab, email: row.email });
    await resultFrame.locator('#spin_wheel_btn').click();
    const deadline = Date.now() + config.timeoutMs;
    while (Date.now() < deadline) {
      const widget = resultFrame.locator('#wheelify');
      const text = await (await widget.count() ? widget : resultFrame.locator('body')).innerText();
      const fields = await (await widget.count() ? widget : resultFrame.locator('body')).locator('input').evaluateAll(elements => elements.filter(element => element.type !== 'hidden' && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0).map(element => ({ value: element.value, id: element.id, name: element.name, placeholder: element.placeholder, readOnly: element.readOnly, type: element.type })));
      const code = visibleCode(text, fields, coupon?.body?.code);
      row.base = engine?.body?.couponValue || null;
      if (code && /You won/i.test(text)) {
        row.code = code; row.visibleResult = text.slice(-4000); row.outcome = 'code_received';
        const savedDeadline = Date.now() + Math.min(15000, config.timeoutMs);
        while (!customer && Date.now() < savedDeadline) await wait(250);
        break;
      }
      if (/quota|already.*spin|try again|sorry|out of stock|no.*coupon|exhaust/i.test(text)) {
        row.outcome = 'rejected'; row.visibleResult = text.slice(-4000); break;
      }
      if (/You won\s*["“]?\s*谢谢参与|better luck next time|you did not win/i.test(text) || engine?.body?._metadata?.outcome === 'SUCCESS' && engine.body.couponValue === '' && Date.now() - Date.parse(row.submittedAt) >= 15000) {
        row.outcome = 'no_win'; row.visibleResult = text.slice(-4000); break;
      }
      await wait(300);
    }
    if (row.outcome === 'pending') row.outcome = 'timeout';
  } catch (error) { row.outcome = 'error'; row.error = error.message; }
  finally {
    // Failed preparation also releases its place so the other tabs cannot deadlock.
    if (!arrived) await gate.arrive();
    await Promise.allSettled([...pending]);
    page.off('response', responseHandler); page.off('request', requestHandler); page.off('pageerror', errors);
  }
  row.base = engine?.body?.couponValue || null;
  row.networkCode = coupon?.body?.code || null;
  row.issues = assess({ code: row.code, base: row.base, networkCode: row.networkCode, previousCodes, drawSucceeded: engine?.body?._metadata?.outcome === 'SUCCESS', error: row.error, responseError: row.api.some(api => api.error || api.httpStatus >= 400 || api.body?._metadata?.outcome && api.body._metadata.outcome !== 'SUCCESS') });
  if (row.outcome === 'timeout') row.issues.push('result_timeout');
  if (row.outcome === 'rejected') row.issues.push('draw_rejected');
  if (row.code && !customer) row.issues.push('subscriber_response_missing');
  if (!engine && clicked) row.issues.push('draw_response_missing');
  if (row.code) previousCodes.add(row.code);
  row.completedAt = new Date().toISOString();
  event({ event: 'round_completed', round, outcome: row.outcome, code: row.code, issues: row.issues });
  row.durationMs = Date.parse(row.completedAt) - Date.parse(row.startedAt);
  if (row.issues.length || round === 1 || round === config.count) {
    const filename = `round-${String(round).padStart(4, '0')}.png`;
    try { await page.screenshot({ path: path.join(out, filename), timeout: 10000 }); row.screenshot = filename; }
    catch (error) { row.screenshotError = error.message; }
  }
  return row;
}
async function resetForBatch(context, slots, cookies, batch) {
  event({ event: 'reset_started', batch });
  // Stop every old page first; no previous tab can rewrite cleared shared storage.
  await Promise.all(slots.map(slot => slot.page.goto('about:blank')));
  const session = await context.newCDPSession(slots[0].page);
  try {
    await session.send('Storage.clearDataForOrigin', {
      origin: new URL(config.url).origin,
      storageTypes: 'local_storage,indexeddb,cache_storage,service_workers'
    });
    await session.send('Network.clearBrowserCache');
  } finally { await session.detach(); }
  await context.clearCookies();
  await context.addCookies(cookies);
  // The first batch already has fresh blank tabs; later batches replace them
  // to clear sessionStorage without loading the site twice at startup.
  if (batch > 1) {
    const newPages = await createPages(slots.length, () => setupPage(context, false));
    try {
      await Promise.all(slots.map(slot => slot.page.close()));
    } catch (error) {
      await Promise.allSettled(newPages.map(page => page.close()));
      throw error;
    }
    slots.forEach((slot, index) => { slot.page = newPages[index]; });
  }
  const loaded = await Promise.allSettled(slots.map(slot => slot.page.goto(config.url, { waitUntil: 'domcontentloaded', timeout: 90000 })));
  loaded.forEach((result, index) => {
    if (result.status === 'rejected') event({ event: 'page_load_error', batch, tab: slots[index].number, error: result.reason.message });
  });
  event({ event: 'reset_completed', batch });
}
async function mainApi() {
  config.email = process.env.TEST_EMAIL || 'Chace.N@onergroup.com';
  if (!/^[^\s@]+@[^\s@]+$/.test(config.email)) throw Error('TEST_EMAIL must be an email address');
  const pw = playwright();
  const browser = await pw.chromium.launch({ channel: 'chrome', headless: true });
  let seed;
  try { seed = await bootstrap({ browser, cookies: await authenticate(browser), config }); }
  finally { await browser.close(); }
  // APIRequestContext retains cookies without any browser pages or renderers.
  const request = await pw.request.newContext({ storageState: { cookies: seed.storageState.cookies, origins: [] } });
  try {
    log({ event: 'ready', mode: 'api', count: config.count, concurrency: Math.min(config.concurrency, config.count), browserClosed: true, output: out });
    event({ event: 'api_ready', campaignId: seed.settings.campaignId, visitorScope: 'shared_for_run' });
    await runPool({ count: config.count, concurrency: config.concurrency, delayMs: config.delayMs, stopped: () => stopped,
      perform: (round, worker) => performApi({ request, config, seed, round, worker, stamp, previousCodes, event, stopped: () => stopped }),
      onResult: row => {
        rows.push(row);
        fs.appendFileSync(path.join(out, 'results.jsonl'), JSON.stringify(row) + '\n');
        if (rows.length % 100 === 0) save();
        log({ event: 'result', round: row.round, worker: row.worker, outcome: row.outcome, code: row.code, issues: row.issues });
      }
    });
    save(); log({ event: 'complete', ...summary(), output: out, stopped });
  } finally { await request.dispose(); }
}
async function main() {
  config.browser ||= await selectBrowser();
  config.headed = config.browser === 'chrome';
  log({ event: 'browser_mode', mode: config.browser, headless: !config.headed });
  const { chromium } = playwright();
  const browser = await chromium.launch({ channel: 'chrome', headless: !config.headed });
  let context;
  try {
    const cookies = await authenticate(browser);
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', timezoneId: 'Asia/Shanghai' });
    await context.addCookies(cookies);
    const pages = await createPages(Math.min(config.tabs, config.count), () => setupPage(context, false));
    const slots = pages.map((page, index) => ({ number: index + 1, page }));
    const windowIds = await Promise.all(slots.map(async slot => {
      const session = await context.newCDPSession(slot.page);
      try { return (await session.send('Browser.getWindowForTarget')).windowId; }
      finally { await session.detach(); }
    }));
    config.browserWindows = new Set(windowIds).size;
    if (config.headed && config.browserWindows !== 1) throw Error('Expected all test tabs in one Chrome window');
    log({ event: 'ready', tabs: slots.length, windows: config.browserWindows, windowIds, count: config.count, concurrency: slots.length, output: out });
    event({ event: 'tabs_ready', tabs: slots.length, windows: config.browserWindows, windowIds });
    for (let start = 1, batch = 1; start <= config.count && !stopped; start += slots.length, batch++) {
      await resetForBatch(context, slots, cookies, batch);
      if (stopped) break;
      const active = slots.slice(0, Math.min(slots.length, config.count - start + 1));
      const gate = createBatchGate(active.length);
      log({ event: 'batch_started', batch, size: active.length });
      const completed = await Promise.all(active.map(async (slot, index) => {
        const row = await perform(slot, start + index, gate, batch);
        rows.push(row);
        fs.appendFileSync(path.join(out, 'results.jsonl'), JSON.stringify(row) + '\n');
        log({ event: 'result', round: row.round, batch, tab: row.tab, outcome: row.outcome, code: row.code, issues: row.issues });
        return row;
      }));
      save();
      const requestTimes = completed.filter(row => row.drawRequestAt).map(row => Date.parse(row.drawRequestAt));
      event({ event: 'batch_completed', batch, size: active.length, requests: requestTimes.length, requestSpreadMs: requestTimes.length ? Math.max(...requestTimes) - Math.min(...requestTimes) : null });
      if (start + slots.length <= config.count && !stopped) await wait(config.delayMs);
    }
    save(); log({ event: 'complete', ...summary(), output: out, stopped });
  } finally { await context?.close(); await browser.close(); }
}
(config.mode === 'api' ? mainApi() : main()).catch(error => { save(); log({ event: 'fatal', error: error.message, output: out }); process.exitCode = 1; });
