function options(argv) {
  const config = { count: 1000, tabs: 20, delayMs: 0, timeoutMs: 45000, headed: false, browser: null, url: 'https://dev.lakeside.com/pages/spin-to-win-test' };
  const flags = { '--count': 'count', '--tabs': 'tabs', '--delay-ms': 'delayMs', '--timeout-ms': 'timeoutMs', '--out': 'out' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--headed' || arg === '--headless' || arg === '--browser') {
      const mode = arg === '--headed' ? 'chrome' : arg === '--headless' ? 'headless' : argv[++i];
      if (!['headless', 'chrome'].includes(mode)) throw Error('--browser must be headless or chrome');
      if (config.browser && config.browser !== mode) throw Error('Conflicting browser modes');
      config.browser = mode;
      config.headed = mode === 'chrome';
    }
    else if (arg === '--help') { console.log('node --env-file=.env run.cjs [--count 1000] [--tabs 20] [--delay-ms 0] [--timeout-ms 45000] [--out DIRECTORY] [--browser headless|chrome] [--headed] [--headless]'); process.exit(0); }
    else if (flags[arg] && argv[i + 1]) config[flags[arg]] = arg === '--out' ? argv[++i] : Number(argv[++i]);
    else throw Error(`Unknown or missing argument: ${arg}`);
  }
  for (const key of ['count', 'tabs', 'delayMs', 'timeoutMs']) if (!Number.isInteger(config[key])) throw Error(`${key} must be an integer`);
  if (config.count < 1 || config.count > 10000 || config.tabs < 1 || config.tabs > 10000 || config.delayMs < 0 || config.timeoutMs < 1000) throw Error('count: 1..10000; tabs: 1..10000; delay-ms >= 0; timeout-ms >= 1000');
  return config;
}

module.exports = { options };
