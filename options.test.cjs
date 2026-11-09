const test = require('node:test');
const assert = require('node:assert/strict');
const { options } = require('./options.cjs');

test('bulk defaults and explicit concurrency above five', () => {
  assert.equal(options([]).tabs, 20);
  assert.equal(options([]).delayMs, 0);
  const config = options(['--tabs', '100', '--count', '250', '--delay-ms', '500']);
  assert.equal(config.tabs, 100);
  assert.equal(config.count, 250);
  assert.equal(config.delayMs, 500);
  assert.equal(options(['--tabs', '10000']).tabs, 10000);
});

test('invalid load settings fail before starting the browser', () => {
  for (const args of [['--tabs', '0'], ['--tabs', '10001'], ['--tabs', '1.5'], ['--tabs', 'Infinity'], ['--tabs'], ['--count', '10001'], ['--delay-ms', '-1']]) {
    assert.throws(() => options(args));
  }
  assert.throws(() => options(['--headed', '--headless']), /Conflicting/);
});
