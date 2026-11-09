# 开发店铺转盘浏览器测试

支持选择本机 Google Chrome 无头模式或普通窗口模式，通过真实页面填写姓名、测试邮箱、勾选订阅并点击抽奖。固定访问 `https://dev.lakeside.com/pages/spin-to-win-test`，不直接调用发码 API。

## 运行

在独立工具目录中使用 Node.js 22+：

```bash
cd /Users/chace/Desktop/WorkSpace/git/tools/spin-wheel

# 当前电脑已经有 Playwright，可直接运行。其他电脑先安装：
npm install

cp .env.example .env
# 在 .env 中填写 SHOP_PASSWORD

node --env-file=.env run.cjs --count 100 --tabs 3
```

`.env` 和运行结果已加入 Git 忽略规则。此电脑已配置本地测试密码，无需重新复制示例。自动邮件会使用 `TEST_EMAIL` 的 `+ui时间戳-轮次` 别名，姓名使用测试姓名，并按已授权要求勾选订阅。

在终端执行上述命令或 `npm start` 时，会显示选择菜单：`1` 无头 Chrome（回车默认），`2` 普通 Chrome（显示窗口）。普通窗口仍会自动输入密码、邮箱并抽奖。

也可直接指定，跳过菜单：

```bash
npm start -- --browser headless --count 100 --tabs 3
npm start -- --browser chrome --count 100 --tabs 3
```

更大并发、无批次间隔的测试示例：

```bash
npm run start:headless -- --count 1000 --tabs 50 --delay-ms 0
npm run start:chrome -- --count 1000 --tabs 50 --delay-ms 0
```

原来的 5 个 tab 上限是脚本参数校验的固定限制，并非 Chrome 限制。现在默认 20 个，上限与总次数上限一致为 10000；这个参数上限不代表机器能流畅承载 10000 个页面。可从 20、50、100 逐步增加，根据内存、CPU、超时率和 `requestSpreadMs` 选择并发数；并发过高可能反而变慢。大批量测试可使用无头模式，减少窗口渲染开销。

页面创建和窗口信息检查改为并行执行，启动时只加载一次测试页面。每条结果仍立即追加到 `results.jsonl`，汇总 JSON 改为每批更新，减少重复写盘；保留页面动画、接口响应和订阅保存的等待，避免结果未完成就开始下一批。

无人值守或没有交互终端时，默认无头运行，不等待输入。原有 `--headed` 参数仍可使用，另支持 `--headless`；冲突参数会报错。

参数：

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `--count` | 1000 | 本次总抽奖次数 |
| `--tabs` | 20 | 并发标签页数，范围 1–10000；实际打开数不超过 `--count` |
| `--delay-ms` | 0 | 相邻批次之间的最小等待时间，不含页面加载 |
| `--timeout-ms` | 45000 | 等待抽奖结果的超时 |
| `--out` | 自动创建时间目录 | 自定义结果目录；拒绝复用已有运行目录 |
| `--browser` | 终端菜单选择；无人值守默认 `headless` | `headless` 无头模式，`chrome` 普通窗口模式 |
| `--headed` / `--headless` | 未指定 | 直接选择普通窗口 / 无头模式，跳过菜单 |

默认在**同一 Chrome 窗口内 20 个 tab 并发测试**，可通过 `--tabs` 调整。每批先清理共享站点数据、并行创建和加载 tab，再分别填写不同姓名和邮箱；等本批所有 tab 都准备好后，一起点击抽奖。整批所有抽奖及记录结束后，才清理缓存并开始下一批，避免清缓存打断其他 tab。100 次表示总次数，不是每个 tab 各 100 次，最后不足一整批时只运行剩余次数。

所有 tab 真实共享 Cookie / Local Storage，因此可能触发站点自身的浏览器次数限制或跨 tab 状态联动；这些结果会原样记录为异常，不使用独立窗口绕过。批次日志记录 `batch`、实际请求时间和 `requestSpreadMs`，可验证是否同时发起。

按 `Ctrl+C` 后完成已提交的当前批次、保存结果，再停止。脚本不会自动重试任何抽奖，避免网络不确定时重复发码。若进程被强制终止，已完成的数据保留在 `results.jsonl`；已提交但未写入记录的当前轮需要人工核对，重新运行会使用新的测试邮箱。

## 输出

每次生成独立目录：`output/<UTC时间>/`。

- `results.jsonl`：每轮完成后立即追加，适合排查中途退出。
- `events.jsonl`：提交抽奖前及每个关键接口响应到达时立即追加；强制退出时可据此定位未完成的当前轮，token 已脱敏。
- `results.json`：每批完成后更新的完整结果，含轮次、标签页、测试邮箱、姓名、页面 code、接口 code、时间、接口响应和异常类型。
- `anomalies.json`：仅包含异常轮次及截图文件名。
- `summary.json`：总数、各奖项发码数、非裂变码数（`nonFissionCodes`）、基础码数、重复码数、独立后缀码数，以及第 51 个及之后独立码的轮次。
- `round-XXXX.png`：所有异常轮次，以及首轮和末轮的截图。

接口响应仅被动监听，抽奖与订阅均由网页自身发起。密码、Cookie 和一次性抽奖 token 不写入结果文件。时间为 ISO UTC，可按北京时间 +8 小时查看。

重点标记：

| 类型 | 含义 |
| --- | --- |
| `non_fission_code` | 任何不符合“当前奖项基础码 + 下划线 + 8 位十六进制后缀”的 code，首次返回也记异常、保存截图；普通码和异常后缀都包含在内 |
| `base_code` | 返回 `spin_off_1` 等不带随机后缀的基础码，需核对是否符合业务预期 |
| `duplicate_code` | 本次运行内同一 code 再次返回 |
| `missing_code` | 接口抽中有奖项，但页面没有显示 code |
| `code_not_shown` | 领码接口已返回 code，页面未显示 |
| `ui_api_mismatch` | 页面与领码接口返回不同 code |
| `wrong_prize_code` | code 前缀与抽中奖项不一致 |
| `api_error` | 抽奖、领码或订阅接口返回错误 |
| `subscriber_response_missing` | 页面显示 code，但未观察到订阅保存接口响应 |
| `result_timeout` / `browser_error` | 页面等待超时或浏览器操作失败 |
| `draw_rejected` / `draw_response_missing` | 次数限制等拒绝，或未观察到抽奖响应 |

裂变格式按当前活动已观察到的 `spin_off_5_697F2101` 等 8 位十六进制后缀判断。普通码原样记录，不会被误报为缺码，也不会计入独立裂变码的第 51 个阈值。基础码或重复码属于待核对的业务异常，不能仅据此认定优惠码无效。未中奖单独统计，不视为发码失败。本工具不核验收件箱、结账核销、后台剩余库存或补货机制。

异常判断单元测试：

```bash
npm test
```

也可在此目录执行 `npm start -- --count 100 --tabs 3`；执行 `npm test` 验证异常判断规则。迁移前的历史结果保留在 `output/`，其中旧记录里的绝对路径保持原始值。

快捷启动命令（已配置在 package.json）：

```bash
npm run start:headless
npm run start:chrome
# 可追加次数和标签页参数：
npm run start:chrome -- --count 100 --tabs 3
```
