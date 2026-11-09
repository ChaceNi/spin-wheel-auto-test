const { assess } = require('./checks.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const success = record => record?.httpStatus >= 200 && record.httpStatus < 300 && record.body?._metadata?.outcome === 'SUCCESS';
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /token|password|secret|authorization|cookie/i.test(key) ? '[redacted]' : redact(item)]));
  return value;
}

// One read-only browser session discovers the current campaign and visitor data.
// No draw is submitted during bootstrap; all mutations are counted by the runner.
async function bootstrap({ browser, cookies, config }) {
  const context = await browser.newContext();
  try {
    await context.addCookies(cookies);
    await context.route('**/*', route => ['image', 'font', 'media'].includes(route.request().resourceType()) ? route.abort() : route.continue());
    const page = await context.newPage();
    const settingsPending = page.waitForResponse(response => new URL(response.url()).pathname === '/apps/wheelify/getwidgetsettings', { timeout: config.timeoutMs });
    // Attach immediately so a failed navigation cannot leave an unhandled rejection.
    settingsPending.catch(() => {});
    await page.goto(config.url, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs });
    const response = await settingsPending;
    const body = await response.json();
    if (!response.ok() || body?._metadata?.outcome !== 'SUCCESS' || !body.records?.campaignId) throw Error('Unable to load active wheel campaign');
    await page.waitForFunction(() => window.Shopify?.shop && localStorage.getItem('cc-sas-spinner-cookies-data'), null, { timeout: config.timeoutMs });
    const visitor = await page.evaluate(() => ({ shop: window.Shopify.shop, CData: localStorage.getItem('cc-sas-spinner-cookies-data'), ip: localStorage.getItem('cc-sas-spinner-user-ip-address') || null }));
    return { ...visitor, settings: body.records, storageState: await context.storageState() };
  } finally { await context.close(); }
}

async function performApi({ request, config, seed, round, worker, stamp, previousCodes, event, stopped }) {
  const [local, domain] = config.email.split('@');
  const row = { mode: 'api', round, worker, email: `${local}+api${stamp.replace(/\D/g, '').slice(0, 17)}-${String(round).padStart(4, '0')}@${domain}`, name: ['Alex', 'Jamie', 'Morgan', 'Taylor'][round % 4] + ' Test', startedAt: new Date().toISOString(), outcome: 'pending', code: null, base: null, issues: [], api: [] };
  let engine, customer;
  let stage = 'draw';
  async function call(endpoint, method, data) {
    let response;
    try {
      response = await request.fetch(new URL(`/apps/wheelify/${endpoint}`, config.url).href, {
        method, ...(method === 'GET' ? { params: data } : { data }),
        timeout: config.timeoutMs, maxRetries: 0, maxRedirects: 0,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Origin: new URL(config.url).origin, Referer: config.url, 'ngrok-skip-browser-warning': '69420' }
      });
      let body;
      try { body = await response.json(); } catch { body = { nonJson: true }; }
      const record = { endpoint: `/apps/wheelify/${endpoint}`, at: new Date().toISOString(), httpStatus: response.status(), body };
      const safe = { ...record, body: redact(body) };
      row.api.push(safe);
      event({ event: 'api_response', round, ...safe });
      return record;
    } catch (error) {
      // Playwright errors may include the GET URL containing the one-time token.
      const message = /timeout/i.test(error.message) ? 'request_timeout' : 'request_failed';
      row.api.push({ endpoint: `/apps/wheelify/${endpoint}`, error: message });
      throw Error(message);
    } finally { await response?.dispose(); }
  }
  event({ event: 'round_started', round, worker, email: row.email });
  try {
    if (stopped()) throw Error('stopped_before_submission');
    row.drawRequestAt = row.submittedAt = new Date().toISOString();
    event({ event: 'draw_request', round, worker, email: row.email, at: row.drawRequestAt });
    engine = await call('postengine', 'POST', { CData: seed.CData, email: row.email, phoneNumber: '', campaignId: seed.settings.campaignId, preview: null, shop: seed.shop });
    if (!success(engine)) {
      row.outcome = engine.httpStatus === 429 ? 'rate_limited' : engine.httpStatus >= 400 || engine.body.nonJson ? 'error' : 'rejected';
    } else if (typeof engine.body.couponValue !== 'string') {
      row.outcome = 'error'; row.issues.push('invalid_draw_response');
    } else {
      row.base = engine.body.couponValue || null;
      if (row.base) {
        stage = 'coupon';
        if (!engine.body.spinToken) throw Error('spin_token_missing');
        const coupon = await call('getcoupons', 'GET', { couponValue: row.base, spinToken: engine.body.spinToken });
        if (success(coupon) && typeof coupon.body.code === 'string' && coupon.body.code.trim()) {
          row.code = row.networkCode = coupon.body.code;
          row.outcome = 'code_received';
        } else row.outcome = coupon.httpStatus === 429 ? 'rate_limited' : 'error';
      } else row.outcome = 'no_win';
      // Never save a base coupon as if it had been issued after a failed claim.
      if (row.code || row.outcome === 'no_win') {
        stage = 'subscriber';
        const sliceId = Number(engine.body.sliceId);
        const slice = seed.settings.store_slices?.[sliceId - 1];
        customer = await call('postcustomerinfo', 'POST', {
          name: row.name, email: row.email, phone: '', country_code: '', country: '',
          coupon_used: row.code, is_consent: 'YES', win_result: slice?.resultText || slice?.value || null,
          campaign_id: seed.settings.campaignId, campaign_name: seed.settings.campaign_name,
          ab_test_id: seed.settings.abTestId, ab_test_variation_id: seed.settings.abTestVariationId,
          ip_address: seed.ip, shop: seed.shop
        });
        if (!success(customer)) row.issues.push('subscriber_save_failed');
      }
    }
  } catch (error) {
    row.error = error.message;
    if (stage !== 'subscriber') row.outcome = error.message === 'request_timeout' ? 'timeout' : 'error';
    row.issues.push(stage === 'subscriber' ? 'subscriber_save_failed' : 'request_error');
  }
  row.issues.push(...assess({ code: row.code, base: row.base, networkCode: row.networkCode, previousCodes, drawSucceeded: success(engine), responseError: row.api.some(record => record.error || !success(record)) }));
  if (row.outcome === 'timeout') row.issues.push('request_timeout');
  if (row.outcome === 'rate_limited') row.issues.push('rate_limited');
  if (row.outcome === 'rejected') row.issues.push('draw_rejected');
  if (row.code && !customer) row.issues.push('subscriber_response_missing');
  row.issues = [...new Set(row.issues)];
  if (row.code) previousCodes.add(row.code);
  row.completedAt = new Date().toISOString();
  row.durationMs = Date.parse(row.completedAt) - Date.parse(row.startedAt);
  event({ event: 'round_completed', round, outcome: row.outcome, code: row.code, issues: row.issues });
  return row;
}

async function runPool({ count, concurrency, delayMs, stopped, perform, onResult }) {
  let next = 1;
  await Promise.all(Array.from({ length: Math.min(count, concurrency) }, async (_, index) => {
    while (!stopped() && next <= count) {
      const row = await perform(next++, index + 1);
      onResult(row);
      if (delayMs && !stopped() && next <= count) await wait(delayMs);
    }
  }));
}
module.exports = { bootstrap, performApi, runPool, redact };
