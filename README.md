# 开发店铺转盘批量测试

默认使用 HTTP 接口批量测试抽奖、领码和订阅，初始化后关闭浏览器以降低资源消耗。另保留真实页面测试模式。固定使用开发店铺 `https://dev.lakeside.com/pages/spin-to-win-test`。

## 批量接口测试（默认）

需要 Node.js 22+ 和本机 Google Chrome。此电脑已配置 `.env`，其他电脑先安装依赖并填写开发店铺密码：

```bash
npm install
cp .env.example .env
# 编辑 .env 中的 SHOP_PASSWORD 和 TEST_EMAIL
```

日常运行：

```bash
cd /Users/chace/Desktop/WorkSpace/git/tools/spin-wheel
npm start -- --count 1000 --concurrency 50
# 等价命令：
npm run start:api -- --count 1000 --concurrency 50
```

默认总次数为 1000，并发数为 20，任务间隔为 0ms。`--count` 是总抽奖次数，`--concurrency` 是同时在途的完整抽奖流程数，均允许 1–10000。可以先用 `--count 10 --concurrency 2` 小批验证，再增加并发。

启动时用无头 Chrome 登录并读取当前活动、真实访客标识和 Cookie，不提交抽奖；读取完成后关闭浏览器。后续全部通过 HTTP 请求执行 `postengine` → `getcoupons` → `postcustomerinfo`，中奖时使用本轮抽奖返回的一次性 `spinToken` 领码，未中奖时跳过领码并保存订阅。姓名和邮箱使用测试数据，订阅同意字段为 `YES`。

固定并发任务持续补位：一个任务完成就开始下一个，无需等待其他慢任务。`--delay-ms 500` 可设置同一并发任务两轮之间等待 500ms；`--timeout-ms 45000` 是单次接口请求超时。默认不等待转盘动画、不渲染大量页面、不截图。API 模式使用 `--concurrency`，传入 `--tabs` 会提示改用正确参数。

同一次运行共享初始化得到的访客标识和 Cookie，不随机伪造新访客绕过限制；当前活动若启用访客/IP/邮箱配额，拒绝和 429 会如实记录。服务端校验不会被关闭。API 模式不验证表单、动画、页面展示或页面/API 一致性。

每条结果立即写入 `results.jsonl`，完整 JSON 报告每 100 条和结束时更新，减少重复写盘。按 `Ctrl+C` 停止派发新任务，完成在途流程并保存结果。抽奖、领码和订阅均不自动重试；网络超时后应先核对服务端，避免重复发码。

## 页面测试（可选）

仍保留完整页面操作模式：

```bash
npm run start:chrome -- --count 100 --tabs 5
npm run start:headless -- --count 100 --tabs 5
# 或显式指定：
npm start -- --mode ui --browser chrome --count 100 --tabs 5
```

UI 模式默认 20 个 tab（范围 1–10000，实际不超过总次数），批次间隔为 0ms。每批清理共享站点数据、并行加载 tab，填写不同测试邮箱；等本批所有 tab 准备好后一起点击抽奖。整批结束后更新报告并开始下一批，避免清理共享缓存打断其他 tab。日志中的 `requestSpreadMs` 可用于检查提交时间差。

未指定 `--browser` 时，交互终端会显示无头/普通 Chrome 选择菜单；无人值守默认无头。也支持 `--headed`、`--headless`。API 模式的初始化始终使用无头 Chrome。

通用参数 `--out DIRECTORY` 可指定结果目录；拒绝复用已有运行目录。`.env` 和 `output/` 已加入 Git 忽略规则。并发过高可能导致 CPU、内存或服务端排队，应该根据耗时和错误率逐步调整。

## 输出

每次生成独立目录：`output/<UTC时间>/`。

- `results.jsonl`：每轮完成后立即追加，适合排查中途退出。
- `events.jsonl`：提交抽奖前及每个关键接口响应到达时立即追加；强制退出时可据此定位未完成的当前轮，token 已脱敏。
- `results.json`：完整结果数组。API 模式每 100 条和结束时更新，UI 模式每批更新；含轮次、worker/tab、测试邮箱、姓名、code、时间、接口响应和异常类型。
- `anomalies.json`：仅包含异常轮次及截图文件名。
- `summary.json`：总数、各奖项发码数、非裂变码数（`nonFissionCodes`）、基础码数、重复码数、独立后缀码数，以及第 51 个及之后独立码的轮次。
- `round-XXXX.png`：仅 UI 模式保存，包含所有异常轮次，以及首轮和末轮截图。

API 模式主动请求接口，UI 模式被动监听网页接口响应。密码、Cookie 和一次性抽奖 token 不写入结果文件。时间为 ISO UTC，可按北京时间 +8 小时查看。

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

API 模式另记录 `request_error`、`request_timeout`、`rate_limited`、`invalid_draw_response` 和 `subscriber_save_failed`；不产生页面展示相关检查或截图。中奖但领码失败时不会把奖项基础码当成成功发出的优惠码。

单元测试：

```bash
npm test
```

`npm test` 覆盖异常判断、参数校验、并发补位、停止行为、接口调用顺序、token 脱敏、失败不重试及订阅失败后保留已领码结果。
