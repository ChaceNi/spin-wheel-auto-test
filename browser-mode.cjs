const readline = require('node:readline/promises');

async function selectBrowser(input = process.stdin, output = process.stdout) {
  // Unattended runs keep the previous headless default and never wait for input.
  if (!input.isTTY || !output.isTTY) return 'headless';
  const terminal = readline.createInterface({ input, output });
  const abort = new AbortController();
  terminal.on('SIGINT', () => abort.abort());
  try {
    output.write('\n请选择浏览器模式：\n  1. 无头 Chrome（后台运行，默认）\n  2. 普通 Chrome（显示窗口）\n');
    while (true) {
      const answer = (await terminal.question('请输入 1 或 2，回车默认选 1：', { signal: abort.signal })).trim().toLowerCase();
      if (['', '1', 'headless'].includes(answer)) return 'headless';
      if (['2', 'chrome', 'headed'].includes(answer)) return 'chrome';
      output.write('输入无效，请输入 1 或 2。\n');
    }
  } finally { terminal.close(); }
}
module.exports = { selectBrowser };
