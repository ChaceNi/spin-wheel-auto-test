const test = require('node:test');
const assert = require('node:assert/strict');
const { performApi, runPool } = require('./api-mode.cjs');
function fixture(replies) {
  const calls = [], events = [], previousCodes = new Set();
  const request = { fetch: async (url, options) => {
    calls.push({ url, ...options });
    const reply = replies[calls.length - 1];
    if (reply instanceof Error) throw reply;
    assert.ok(reply, 'unexpected extra request');
    return { status: () => reply.status || 200, json: async () => { if (reply.nonJson) throw Error('HTML'); return reply; }, dispose: async () => {} };
  } };
  const args = { request, config: { url: 'https://dev.lakeside.com/pages/spin-to-win-test', email: 'test@example.com', timeoutMs: 1000 }, seed: { CData: 'shared-visitor', shop: 'example.myshopify.com', settings: { campaignId: 123, campaign_name: 'Test', store_slices: [{ resultText: '5 OFF' }] } }, round: 1, worker: 1, stamp: '2026-11-09T00:00:00Z', previousCodes, event: e => events.push(e), stopped: () => false };
  return { args, calls, events, previousCodes };
}
const ok = value => ({ _metadata: { outcome: 'SUCCESS' }, ...value });
const draw = () => ok({ couponValue: 'spin_off_5', spinToken: 'one-use-secret', sliceId: 1 });
const coupon = () => ok({ code: 'spin_off_5_A1234567' });

test('draw token is claimed once, subscription uses issued code, logs redact token', async () => {
  const f = fixture([draw(), coupon(), ok({})]);
  const row = await performApi(f.args);
  assert.equal(row.outcome, 'code_received');
  assert.deepEqual(row.issues, []);
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[0].data.CData, 'shared-visitor');
  assert.equal(f.calls[1].params.spinToken, 'one-use-secret');
  assert.equal(f.calls[2].data.coupon_used, row.code);
  assert.equal(f.calls[2].data.is_consent, 'YES');
  assert.equal(f.calls[2].data.win_result, '5 OFF');
  assert.equal(JSON.stringify([row, f.events]).includes('one-use-secret'), false);
  assert.ok(f.calls.every(call => call.maxRetries === 0 && call.maxRedirects === 0));
});

test('failed claim is never retried and never saved as a base coupon', async () => {
  const f = fixture([draw(), Error('Timeout with spinToken=one-use-secret')]);
  const row = await performApi(f.args);
  assert.equal(f.calls.length, 2);
  assert.equal(row.outcome, 'timeout');
  assert.equal(row.code, null);
  assert.ok(row.issues.includes('missing_code'));
  assert.ok(!row.issues.includes('browser_error'));
  assert.equal(JSON.stringify(row).includes('one-use-secret'), false);
});

test('subscriber failure retains issued code and duplicate detection', async () => {
  const f = fixture([draw(), coupon(), Error('network failure')]);
  f.previousCodes.add('spin_off_5_A1234567');
  const row = await performApi(f.args);
  assert.equal(row.outcome, 'code_received');
  assert.ok(row.issues.includes('duplicate_code'));
  assert.ok(row.issues.includes('subscriber_save_failed'));
});

test('no-win saves subscriber without requesting a coupon', async () => {
  const f = fixture([ok({ couponValue: '', sliceId: 2 }), ok({})]);
  const row = await performApi(f.args);
  assert.equal(row.outcome, 'no_win');
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[1].url.endsWith('/postcustomerinfo'));
  assert.deepEqual(row.issues, []);
});

test('rejection, rate limiting, malformed response and missing token do not trigger extra calls', async () => {
  for (const reply of [{ _metadata: { outcome: 'FAILURE' } }, { status: 429 }, ok({}), ok({ couponValue: 'spin_off_5' }), { nonJson: true }]) {
    const f = fixture([reply]);
    const row = await performApi(f.args);
    assert.equal(f.calls.length, 1);
    assert.ok(row.issues.length);
    assert.notEqual(row.outcome, 'no_win');
  }
});

test('pool refills a free worker without waiting for slow requests and stays bounded', async () => {
  let release, active = 0, peak = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const started = [], completed = [];
  await runPool({ count: 7, concurrency: 2, delayMs: 0, stopped: () => false,
    perform: async round => {
      started.push(round); peak = Math.max(peak, ++active);
      if (round === 1) await gate;
      if (round === 7) release();
      active--; return { round };
    }, onResult: row => completed.push(row.round)
  });
  assert.equal(peak, 2);
  assert.deepEqual(started, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(completed[0], 2);
  assert.equal(completed.length, 7);
});

test('stop drains active requests without scheduling new draws', async () => {
  let stop = false;
  const results = [];
  await runPool({ count: 100, concurrency: 3, delayMs: 0, stopped: () => stop,
    perform: async round => ({ round }), onResult: row => { results.push(row); stop = true; }
  });
  assert.equal(results.length, 3);
});
