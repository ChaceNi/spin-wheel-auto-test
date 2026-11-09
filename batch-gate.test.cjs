const test = require('node:test');
const assert = require('node:assert/strict');
const { createBatchGate } = require('./batch-gate.cjs');
test('three tabs submit only after all forms are ready', async () => {
  const gate = createBatchGate(3), events = [];
  const tab = async id => { events.push('ready' + id); await gate.arrive(); events.push('submit' + id); };
  const first = tab(1), second = tab(2);
  await Promise.resolve();
  assert.deepEqual(events, ['ready1', 'ready2']);
  await Promise.all([first, second, tab(3)]);
  assert.deepEqual(events.slice(0,3), ['ready1', 'ready2', 'ready3']);
  assert.equal(events.filter(e => e.startsWith('submit')).length, 3);
});
test('failed preparation releases the remaining tabs', async () => {
  const gate = createBatchGate(3);
  const first = gate.arrive(), failed = gate.arrive(), last = gate.arrive();
  await Promise.all([first, failed, last]);
});
test('last partial batch starts without waiting for nonexistent tabs', async () => {
  await createBatchGate(1).arrive();
});
