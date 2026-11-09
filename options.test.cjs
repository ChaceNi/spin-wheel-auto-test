const test = require('node:test');
const assert = require('node:assert/strict');
const { options } = require('./options.cjs');

test('bulk defaults and explicit concurrency above five', () => {
  assert.equal(options([]).tabs, 20);
  assert.equal(options([]).delayMs, 0);
  const config = options(['--mode', 'ui', '--tabs', '100', '--count', '250', '--delay-ms', '500']);
  assert.equal(config.tabs, 100);
  assert.equal(config.count, 250);
  assert.equal(config.delayMs, 500);
  assert.equal(options(['--mode', 'ui', '--tabs', '10000']).tabs, 10000);
});

test('invalid load settings fail before starting the browser', () => {
  for (const args of [['--tabs', '0'], ['--tabs', '10001'], ['--tabs', '1.5'], ['--tabs', 'Infinity'], ['--tabs'], ['--count', '10001'], ['--delay-ms', '-1']]) {
    assert.throws(() => options(args));
  }
  assert.throws(() => options(['--headed', '--headless']), /Conflicting/);
});

test('API is default and uses concurrency rather than tabs', () => {
  assert.equal(options([]).mode, 'api');
  assert.equal(options(['--concurrency', '50']).concurrency, 50);
  for (const args of [['--concurrency', '0'], ['--concurrency', '10001'], ['--concurrency', '1.5'], ['--mode', 'other'], ['--tabs', '50']]) assert.throws(() => options(args));
});
