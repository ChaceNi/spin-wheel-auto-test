const test = require('node:test');
const assert = require('node:assert/strict');
const { createPages } = require('./pages.cjs');

test('100 tabs begin setup concurrently and retain their slot order', async () => {
  let started = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const pending = createPages(100, async () => {
    const id = started++;
    await gate;
    return { id };
  });
  await Promise.resolve();
  assert.equal(started, 100);
  release();
  const pages = await pending;
  assert.deepEqual(pages.map(page => page.id), Array.from({ length: 100 }, (_, id) => id));
});

test('failed setup waits for late tabs and closes every successful tab', async () => {
  const failure = Error('tab could not open');
  const closed = [];
  let index = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const pending = createPages(3, async () => {
    const id = index++;
    if (id === 1) throw failure;
    if (id === 2) await gate;
    return { close: async () => { closed.push(id); if (id === 0) throw Error('already closed'); } };
  });
  await Promise.resolve();
  assert.deepEqual(closed, []);
  release();
  await assert.rejects(pending, error => error === failure);
  assert.deepEqual(closed.sort(), [0, 2]);
});
