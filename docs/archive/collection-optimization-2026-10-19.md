# 2026-10-19 采集优化记录（历史归档）

> 历史记录：本文按日期记录采集优化过程，早期段落中的“未验收”“未重跑”等结论仅代表当时状态。当前事实以 [NEXT_WINDOW_PROMPTS.md](../NEXT_WINDOW_PROMPTS.md)、[ROADMAP.md](../ROADMAP.md) 和 [DECISIONS.md](../DECISIONS.md) 为准。
>
> 后续说明（2026-10-22）：本文中的“未获提交/推送授权、改动留在工作区”状态已结束，相关改动已完成提交并推送。`tmp/`、`output/`、`docs/interview-notes.md` 保持本地忽略，不作为仓库事实来源；测试数量是当时快照，当前基线以 [ROADMAP](../ROADMAP.md) 为准。

工程：`D:\111222333\personal-hot-monitor`（ACG Pulse）。基线提交：`0a40a1a`，分支 `master`。

## 任务清单

- [x] 官网采集：复现导航挤占候选及 RSS 重复请求，支持按源选择器和 URL 过滤，通过现有试抓预览验证。
- [x] 来源状态：区分 RSSHub、米游社和社区的请求失败、错误响应与合法空列表，核对健康及更新时间。
- [x] 分析任务：复现保存后漏入队、分析期间内容变化，沿用持久化队列修复事务及版本竞争。
- [x] 完成相关匿名样本回归、后端 test/build，并更新适用记录；本轮未改前端或共享 DTO。

## 操作边界

保留接手时的未跟踪成果 `docs/interview-notes.md`、`output/`、`tmp/`。授权边界为不读取或修改真实凭据、数据库、归档数据，不调用付费 AI、不恢复公开部署；测试隔离事故见下。默认源种子中没有官网类型，本轮提供可经现有 config/试抓入口使用的选择器配置，不猜测真实源结构或主动修改实际源记录。未获额外提交/推送授权，改动留在工作区。

## 验证与剩余事项

官网的三项匿名回归在修改前全部失败：导航填满 20 条、配置字段被忽略、RSS 二次请求；修复后经实际 `previewSource → getAdapter → fetch` 路径通过。明确文章选择器也支持短标题，日期不可解析时不补值。本轮新增回归使用匿名 HTML/XML/JSON、可控 Provider 和内存数据库桩；隔离修正后的验证阻断真实 Prisma 构造，避免自动加载真实环境文件。

来源状态已复现 RSSHub 的 HTTP 503 `this route is empty`、米游社错误 retcode、社区超时和缺失列表结构返回空数组；现仅成功状态且结构完整的响应可返回合法空列表。checker 的真实适配器入口回归确认错误保留上次成功时间并写失败历史，空 RSS 更新成功时间且新增为零。社区来源结果通过既有 Setting 表记录；全局时间取各来源最旧成功时间，按来源查询取该来源时间。部分失败保留对应缓存，清理只作用于成功来源。NGA 评论失败后撤回标题去重状态，避免误伤小黑盒同题内容；话题与健康结果同事务写入。缺失必要发布时间的社区响应报错，未补成当前时间。公开懒刷新沿用 30 分钟间隔，数据库失败无法保存 checkedAt 时由服务内失败时间控制冷却。

队列已用受控 Provider 和匿名持久化桩复现保存后漏入队及分析过程中更新被去重吞掉。沿现有 contentHash 与队列 dedupeKey 完成短事务及输入版本检查，不新增数据库字段或外部队列：

- 新建/正文更新与入队原子提交，任务写失败回滚正文；通知失败保留已保存任务。
- 开始分析、结果写入、任务结束分别核对版本；覆盖 Provider 等待期间更新和结果已写、任务尚未结束的窗口。输入已变化则沿用同一任务回 pending，不增加失败重试次数。
- 正文变化清理旧摘要/判断；广播和邮件前复核版本及 completed 状态。
- 启动补回无任何任务历史、Analysis 为 null/pending 的条目，不自动重排 completed/failed。意外数据库错误向上报告，不安排无限即时重试；有界 Provider 重试保持。

最终检查：后端 `npm.cmd test` 31 文件、220 项通过；`npm.cmd run build` 通过。没有修改前端、共享 DTO、schema 或依赖。真实源在线试抓、真实 Provider 运行、历史数据与线上业务未验证；没有测量整轮耗时，不能据此给出提速比例。

## 2026-10-20 独立复核与验收

**复核范围**：官网选择器与 URL 白名单、RSSHub/米游社/社区的失败与合法空边界、失败来源的缓存与去重撤回、来源成功时间及公开懒刷新冷却、保存入队事务、分析开始/结果写入/终态三个版本窗口，以及任务去重和终态失败语义。上述路径未再发现需要改动的证据问题；社区热度口径、全量情绪分析、公开 DTO 与 schema 保持不变。

**确认的问题与修复**：`analysisQueue` 的 `scheduleNextRun` 只按 `nextRunAt` 升序挑下一条任务，没有排除停在 9999 年的终态失败任务。真实 SQLite 验收中，终态任务导致 `setTimeout` 32 位溢出，延时被折算为 1ms，队列空转并挤压后续任务。修复为查询排除 `nextRunAt >= TERMINAL_NEXT_RUN_AT`，并将正常延时限制在 `2_147_483_647` ms 内（`server/src/gamepulse/ai/analysisQueue.ts`）。终态失败不重排、人工重试入口和有限重试次数均未改变。

**测试隔离**：每次运行使用操作系统临时目录下的唯一根目录和全新 `test.db`，由 `prisma migrate deploy` 从临时工作目录应用迁移；临时根和临时 `prisma` 目录写入空 `.env`，并设置空的 `DOTENV_CONFIG_PATH`，避免 Prisma CLI 发现 `server/prisma.config.ts` 或开发者的真实环境文件。worker 启动前校验 `DATABASE_URL` 必须等于该临时库，并安装 fs 守卫：拦截 `server/` 下（排除 `node_modules`）任何 `.env*` 的存在性探测和读取。验收用例先断言临时库路径、`PRAGMA database_list` 仅含该库、匿名 canary 可读写，且守卫确实拦截了 Prisma 对真实 `.env` 的探测（拦截存在性检查、零次真实读取），再运行事务验收。测试结束删除临时目录；清理失败只告警。

**真实 SQLite 验收**：新增 `collectionSqlite.integration.test.ts`，使用生产 `db.ts`、真实事务、唯一约束和持久化队列，仅 mock 适配器、Provider、邮件/通知等外部边界，共 6 项：

- 隔离证明：连接目标与守卫计数如上。
- 新建条目时任务写入失败：用 SQLite 触发器令 `AnalysisTask` 插入失败，条目、任务、通知均不存在，来源标记失败且不写成功时间。
- 正文更新时任务写入失败：原正文保留，不生成任务。
- Provider 等待期间正文更新：旧结果丢弃，同一任务回到 pending，最终按最新正文完成分析。
- 结果已写入、任务尚未结束：复抓更新正文后仍会补分析最新版本，任务最终 completed。
- 同条目任务去重、终态失败不因普通重抓自动重排；正文再次变化才产生新任务并完成。

**验证层级与限制**：后端 `npm.cmd test` 31 文件、220 项通过；`npm.cmd run build` 通过。任务写入失败由数据库触发器注入，能验证真实事务回滚与约束，但不等同于磁盘故障、锁冲突等全部数据库异常；集成用例中的 AI 结果仍由受控 Provider 生成，未调用付费 AI，也未验证真实模型输出。未运行前端检查，因本轮未改前端或共享契约。未读取或审计真实凭据、数据库与归档数据，未恢复部署；临时目录清理为尽力而为。未获提交/推送授权，改动保留在工作区。

## 测试隔离事故

一次定向测试执行 analysisQueue/checkerDedup/checkerMutex/sourceHealthResult 时，新事务 mock 回调中的动态数据库导入意外解析到了真实 Prisma。两个多来源用例的匿名 `tx.feedItem.create`（sourceId 为 `src-2`）报 `P2003` 外键拒绝；另一个 mockReset 异常也暴露了引用漂移。已对用户披露并暂停这组测试。

修正为固定 mock 工厂闭包客户端、阻断真实 PrismaClient 构造；2026-10-20 又将以“不存在目录的 DATABASE_URL”兜底升级为唯一的真实临时 SQLite 测试库，并加入环境文件守卫与连接目标断言（见上节）。修正后定向及完整验证均通过。没有读取真实库做事后审计或执行补救写入，不能凭外键失败证明真实数据库完全没有副作用。此项偏离授权边界，不能将本轮描述为从未触及真实数据库。

## 2026-10-20 真实源、DeepSeek 与 B站主路径切换

**真实源与 Provider 验收**：在隔离临时 SQLite 库和本地预览服务中，使用真实米游社采集 3 个公告源，共 15 条；B站官方源仍返回 HTTP 412，社区三源分别因 B站 `code=-400`、NGA `invalid post`、小黑盒 `invalid item` 失败。经用户单独授权后，使用历史 DeepSeek Key 完成 15/15 条分析，`provider=deepseek`，规则回退 0 条；重要性分布 high 3 / medium 8 / low 4。预览页显示 15 条、公开 14、muted 1、hidden 0，去重后故事流 13 条。该验收证明了真实采集→持久化→AI 分析→公开查询链路，但不代表 B站或社区来源已恢复。

**B站主路径**：`BilibiliVideoAdapter` 仍先尝试 RSSHub；生产 Compose 的自建 `rsshub` 服务成为主路径。应用容器不再接收 `BILIBILI_COOKIE`，根目录 Cookie 仅由 Compose 映射为 RSSHub 的 per-uid 变量。`shouldUseDirectApiFallback` 删除了“存在 Cookie 即启用直连”的隐式分支；直连只由 `BILIBILI_DIRECT_API_FALLBACK=true` 或单个源 `config.directApiFallback=true` 显式开启。同步补齐两个遗漏的关注 UP UID（224267770、15319615）的 Cookie 映射，并更新 Compose、环境变量示例、部署脚本和后台文案。

**验证**：新增 `bilibiliFallback.test.ts` 2 项回归（Cookie 存在但 fallback=false 不直连；显式 true 才直连）。后端 `npm.cmd test` 32 文件、222 项通过；`npm.cmd run build` 通过；客户端 `npm.cmd run lint` 与 `npm.cmd run build` 通过；`docker compose config --quiet` 在提供匿名必需变量后通过。未运行前端浏览器交互验证，未启动本地 RSSHub。

**剩余限制**：本地 `127.0.0.1:1200` 无 RSSHub 服务，真实 B站 RSSHub 路由、Cookie 有效性和 503/403 排障尚未验收；不能把配置完成表述为真实 B站采集已恢复。未读取或修改真实凭据、生产数据库和归档数据，未恢复部署。若需要分享会话或工具日志，先轮换 B站 Cookie。

**文档治理**：`docs/deployment-troubleshooting.md` 中仍适用的排障内容并入 `docs/deployment-guide.md` 的“排障速查”，删除过时独立文档；2026-08-17 生产复盘保留为历史归档并加注当前架构说明。

## 2026-10-20 自建 RSSHub 真实路径验收（补充）

**验收范围**：启动主 Compose 的真实 `rsshub` 服务，走 `BilibiliVideoAdapter → RSSHub → /bilibili/user/video/<uid>` 主路径；应用侧使用隔离临时 SQLite 库、匿名管理员密码和空 AI Key，不调用付费 AI。验收时临时把容器 1200 端口仅绑定到 `127.0.0.1` 供宿主机应用访问，结束后恢复主 Compose 的 `expose` 配置。未改变主路径，`BILIBILI_DIRECT_API_FALLBACK` 始终为 `false`。

**镜像修复**：`rsshub/Dockerfile` 原 `npx playwright install chromium` 在 `diygod/rsshub:latest` 上以 127 退出（`playwright: not found`）。基础镜像裁剪了 Playwright CLI，但运行时仍依赖 `playwright@1.60.0`。改为先 `npm install -g playwright@1.60.0`，再 `playwright install chromium`，并把 `/root/.cache/ms-playwright` 复制到 `/home/node/.cache/ms-playwright`、设置 `node` 用户权限。重建后 Chromium revision 1223 安装成功，容器可启动并通过 healthz。

**RSSHub 证据**：

- `docker exec game-pulse-rsshub curl -fsS http://localhost:1200/healthz` 返回 `ok`。
- `GET /bilibili/user/video/401742377` 返回 HTTP 200 和 RSS XML，根标题为 `原神 的 bilibili 空间`，包含 40 个 `<item>`；UID `1340190821` 在重试中也曾返回 HTTP 200 和 40 个 `<item>`。未输出或记录 Cookie。

**应用侧证据**（隔离库、单源 `原神`）：

- 采集前：`healthStatus=unknown`、`lastSuccessAt=null`、0 条 FeedItem。
- 后台只读试抓：`ok=true`、`totalFetched=30`、`shown=10`；首条为 `《原神》过场动画-「遗赠」`（`BV1pTap6UE1w`，发布时间 `2026-10-10T04:00:00.000Z`）。路由返回 40 条而适配器返回 30 条，是 `parseRss` 既有单次 30 条上限，不是路由丢数据。
- 实际采集：`checkedSources=1`、`newItems=30`、`failedSources=0`；源变为 `healthStatus=healthy`、`lastSuccessAt=2026-10-20T02:15:29.214Z`、`lastError=null`，共 30 条。`SourceHealthLog` 写入 `healthy`，24 小时统计 1 次检查、0 次失败。
- 第二次采集：`newItems=0`、`failedSources=0`，`lastSuccessAt` 推进到 `2026-10-20T02:15:50.510Z`，条数仍为 30，确认去重和成功时间推进正常。

**Cookie 映射覆盖与修复**：主 `docker-compose.yml` 的 12 个 `BILIBILI_COOKIE_<uid>` 与默认源 UID 集合一致。`docker-compose.rsshub.yml` 原先有 12 个 key，但只引用 per-UID 变量；根 `.env` 仅有 `BILIBILI_COOKIE` 时有 5 个值为空。已改为 `${BILIBILI_COOKIE_<uid>:-${BILIBILI_COOKIE}}`，保留按 UID 覆盖能力，`docker compose -f docker-compose.rsshub.yml config` 校验为 12 个 key、12 个非空值且全部同值。新增 `server/src/gamepulse/__tests__/bilibiliCookieMapping.test.ts` 3 项回归：生产 Compose 覆盖全部默认 UID、开发 Compose 覆盖全部 UID 且回退根 Cookie、app 服务不接收 `BILIBILI_COOKIE`。

**验证结果**：后端 `npm.cmd test` 33 文件、225 项通过；`npm.cmd run build` 通过；`docker compose config --quiet`（匿名必需变量）与 `docker compose -f docker-compose.rsshub.yml config --quiet` 通过；`git diff --check` 仅报告既有的 LF/CRLF 转换提示，无空白错误。本轮未改前端，未运行客户端检查。

**上游限制**：直连探测返回 `code=-352, message=风控校验失败`；nav 探测返回 `code=-101, isLogin=false`，说明当前部署的 Cookie 未形成登录态。RSSHub 的浏览器回退也多次返回 `-352`/`-403` 或约 45 秒超时。路由成功是间歇的：重建容器丢失缓存后，UID `1340190821` 连续 10 次失败，随后 UID `401742377` 成功。因此本次只能证明“主路径、镜像和应用侧单源链路已打通”，不能表述为 12 个 B站源已全部恢复；需要有效登录 Cookie 和稳定的上游窗口才能扩大验收。

**其他限制**：只验收了 1 个 B站源；未读取或修改真实凭据（Compose 仅做注入）、生产数据库和归档数据；未恢复公开部署；未调用付费 AI。`fetchBilibiliAvatar` 仍匿名直连 `acc/info`，失败不影响采集。RSSHub 容器缺少系统 CA 证书，容器内 `curl` 访问 HTTPS 需要 `-k`；Node/Chromium 使用各自 CA 存储，不影响本路由，但排障时不能只凭容器内 `curl` 失败判断外网不可达。

## 2026-10-20 有效 Cookie 更新与 12 源路由复核（补充）

**Cookie 更新**：用户轮换 B站 Cookie 后，通过 `scripts/set-bilibili-cookie.cmd` 完成隐藏输入、nav 校验、根 `.env` 原子更新和 RSSHub 重建。容器内 nav 返回 `code=0`、`isLogin=true`；12 个 `BILIBILI_COOKIE_<uid>` 均为非空（只统计数量，未输出值）。主 Compose 仍从根 `BILIBILI_COOKIE` 注入，app 容器不接收 Cookie；`BILIBILI_DIRECT_API_FALLBACK` 保持 `false`。

**路由复核**：重建后第一轮 `/bilibili/user/video/401742377` 曾返回 503，约 10 秒后重试返回 HTTP 200、40 个 `<item>`（8 秒）。随后对 12 个默认 UID 逐个请求，按 `<item>` 出现次数统计：

| UID | 来源 | HTTP | `<item>` |
| --- | --- | --- | --- |
| 401742377 | 原神 | 200 | 40 |
| 1340190821 | 崩坏：星穹铁道 | 200 | 40 |
| 27534330 | 崩坏3第一偶像爱酱 | 200 | 40 |
| 1636034895 | 绝区零 | 200 | 40 |
| 1955897084 | 鸣潮 | 200 | 40 |
| 161775300 | 明日方舟 | 200 | 40 |
| 1265652806 | 明日方舟：终末地 | 200 | 40 |
| 3546636978489848 | 异环 | 200 | 40 |
| 652239032 | IGN中国 | 200 | 40 |
| 8465957 | 乌鸦预告片 | 200 | 40 |
| 224267770 | 夏日幻听MCE | 200 | 40 |
| 15319615 | aki惊蛰 | 503 | 0 |

`15319615` 连续两次在浏览器模式等待 45 秒后失败，日志为 `Bilibili browser mode did not receive a video list response within 45000ms`；属于该来源页面的上游/风控问题，不是 Cookie 无效。其余 11 个 UID 在该测试窗口内均返回 200。

**日志与路径**：RSSHub 日志显示 B站 API 请求返回空 JSON（`SyntaxError: Unexpected end of JSON input`），随后回退 Playwright 浏览器模式；成功的路由均由浏览器模式返回。有效 Cookie 改善了 nav 登录态，但没有消除 API 空响应/风控，主路径仍依赖浏览器回退。

**助手修复**：Cookie 更新脚本的路由检查命令缺少 `;`，把 `echo/grep` 拼成 curl 的额外 URL，产生拼接状态码 `503000000000`；已修复并增加 10 秒后一次重试。`grep -c "<item>"` 只统计匹配行数，压缩成一行的 XML 会把 40 条误报为 1 条；已改为 `grep -o "<item>" | wc -l`。脚本还会列出 per-UID 覆盖项的 UID key。

**验证边界**：本轮只做 RSSHub 路由级复核，未重新启动应用做 preview/check，未重新运行后端测试（本轮只改脚本和文档），未恢复生产部署。路由返回 40 条而应用 `parseRss` 单次上限为 30，不能把路由 item 数直接当作入库数。用户确认旧 `BILIBILI_COOKIE_401742377` 覆盖项已过期并删除；删除后 `docker compose -f docker-compose.rsshub.yml config` 复核为 12 个 per-UID Cookie、全部非空且同值（回退到新根 Cookie），app 不接收 Cookie。未打印或写入任何 Cookie 值。

## 2026-10-20 新 Cookie 下应用侧 12 源验收（补充）

**环境**：全新临时 SQLite（复制真实 schema/migrations 后执行 `prisma migrate deploy`）、匿名管理员密码、空 AI Key；`RSSHUB_BASE_URLS` 仅配置一个临时 socat 代理 `http://127.0.0.1:1210`，转发到 `game-pulse-rsshub:1200`，不配置公共实例；`BILIBILI_DIRECT_API_FALLBACK=false`，app 进程不注入 `BILIBILI_COOKIE`。seed 默认源后共 24 个，禁用 12 个米游社源，只保留 12 个 B站源启用。验收后停止 server、删除代理容器和临时目录。

**preview（limit=5；既有硬超时 15s）**：10/12 成功，`ok=true`、`totalFetched=30`（`parseRss` 单次上限）；`15319615`、`1265652806` 在 15s 超时。`401742377` 首次也超时，重试 42ms 返回 30（RSSHub 缓存已热）；`1265652806` 首次 preview 曾返回 503。4 个关注 UP 的源在数据库中 `game=''`，而 `CreateSourceSchema` 要求非空 `game`，原样 preview 会 400；本轮用仅展示的 `关注UP主` 占位完成 preview，未修改数据库或校验。preview 失败不代表采集失败。

**实际 check**：设置 `SOURCE_CHECK_TIMEOUT_MS=90000`、`RSS_FETCH_TIMEOUT_MS=90000`、`SOURCE_CHECK_CONCURRENCY=2`，执行两次：

- 第一轮：`checkedSources=12`、`newItems=360`、`failedSources=0`，21.2s；12/12 源 `healthy`、每源 30 条、`lastError=null`；`lastSuccessAt` 为 `2026-10-20T08:33:00.757Z`–`2026-10-20T08:33:14.955Z`。
- 第二轮：`newItems=0`、`failedSources=0`，5.9s；12/12 仍 `healthy`；`lastSuccessAt` 推进到 `2026-10-20T08:33:27.753Z`–`2026-10-20T08:33:32.451Z`，总数仍 360。
- 隔离库核验：`FeedItem=360`，`SourceHealthLog=24` 且全部 `healthy`（两轮各 12），无 `failed/degraded`。
- 12 个 UID 均成功入库 30 条，`15319615` 与 `1265652806` 也在本轮 check 中成功；preview 的 15s 超时发生在同一来源 check 成功之前，说明预览窗口不足，不能据此判定源不可用。
- check 后单独请求 `15319615` 路由：HTTP 200、40 个 `<item>`、41,593 字节（90s 上限内），与更早的 503/0 形成对比；仍可能是缓存或上游窗口改善，不能据此保证长期稳定。

**边界**：这是新 Cookie + 自建 RSSHub 下第一次 12 源应用侧完整验收，但仍是单一时间窗口；B站 API 空响应、浏览器回退和间歇 503 未消除，不能表述为永久恢复。preview 的 15s 硬超时短于 check 的 90s，冷启动时可能出现“preview 失败、check 成功”；是否调整 preview 超时和空 `game` 校验需单独评估，本轮未改代码。未调用付费 AI，未读取或修改真实凭据、生产数据库与归档数据，未恢复部署，未打印 Cookie。后端 `npm.cmd test` 33 文件、225 项通过，`npm.cmd run build` 通过；两份 `docker compose config --quiet` 均通过。

## 2026-10-21 preview 超时与空 game 修复

**决策**：用户确认同时做超时与空 `game` 两项，超时默认取 30s（未选 45s/90s）。

**代码**：
- `server/src/gamepulse/services/sourcePreview.ts`：新增 `SOURCE_PREVIEW_TIMEOUT_MS`（默认 30000ms，最低 5000ms），超时错误带实际秒数；空 `game` 响应使用“通用”展示占位。适配器仍收到空值，采集字段不变。
- `server/src/gamepulse/validation.ts`：`SourcePreviewSchema` 覆盖 `game` 为可选/可空字符串；`CreateSourceSchema` 与 `UpdateSourceSchema` 继续要求非空。
- `docker-compose.yml` 透传 `${SOURCE_PREVIEW_TIMEOUT_MS:-30000}`；`server/.env.example` 增加示例值；README、部署指南和 API 契约同步更新。
- 管理端预览 loading 文案改为提示上游较慢时可能等待数十秒。

**单元/构建验证**：定向 `sourcePreview`/`validation` 18 项通过；全量后端 33 文件、229 项通过；`npm.cmd run build`、client lint/build 通过；两份 Compose `config --quiet` 通过（匿名必需变量，未输出密钥）。新增 4 项回归：默认 30s 超时、`SOURCE_PREVIEW_TIMEOUT_MS` 覆盖、空 game 显示占位、preview 允许空 game 而创建仍拒绝。

**隔离真实源验证（2026-10-21 12:30–12:32）**：全新临时 SQLite（`prisma migrate deploy`）、匿名管理员、空 AI Key；app 只启用 12 个 B站源，`BILIBILI_DIRECT_API_FALLBACK=false` 且不接收 Cookie；RSSHub 仅经临时 socat 代理访问本机 `game-pulse-rsshub`。preview 首轮 10/12 成功，每源 `totalFetched=30`，耗时 3.5–9.1s；`15319615` 8.9s、`1265652806` 5.8s，均在上次 15s 超时窗口外成功；4 个数据库 `game=''` 的关注源返回“通用”占位。`1340190821`/`161775300` 首轮返回 422（RSSHub 路由失败，7.98/9.05s），重试分别 37/73ms 返回 200/30；check 后直接请求两者路由均为 HTTP 200/40。没有 preview 触发 30s 超时。

**两轮 check**：首轮 15.9s、`checkedSources=12`、`newItems=360`、`failedSources=0`，12/12 `healthy`，`lastSuccessAt` 为 `2026-10-21T04:31:33.687Z`–`04:31:45.597Z`；次轮 2.9s、新增 0、0 失败，12/12 仍 `healthy`，`lastSuccessAt` 推进到 `04:31:45.727Z`–`04:31:48.557Z`。隔离库核验：`FeedItem=360`、`SourceHealthLog=24` 且全部 `healthy`、启用 B站源 12 个。关键 UID `1340190821`、`161775300`、`15319615`、`1265652806` 的 check 后路由均为 HTTP 200/40。

**边界**：这是新 preview 代码下的单一时间窗口验收；`1340190821`/`161775300` 首轮 preview 422 说明上游仍间歇，而 check 和重试成功说明 preview 失败不能直接判定源不可用。30s 仍短于上次 check 的 90s 窗口，极慢源仍可能 preview 超时。上游 API 空 JSON、浏览器回退、间歇 503 未消除；未恢复部署、未调用付费 AI、未读写真实凭据/生产数据库。验收后已停止临时 server、删除代理容器和临时目录。

## 2026-10-21 多窗口 check、社区契约与管理端浏览器验证

**多窗口 check（隔离环境）**：沿用上节环境（全新临时 SQLite、匿名管理员、空 AI Key、只启用 12 个 B站源、`BILIBILI_DIRECT_API_FALLBACK=false`、RSSHub 仅经 `127.0.0.1:1210` 临时 socat 代理）。在与 04:31Z 验收间隔约 1 小时 43 分后新增两个窗口：

- 06:14:33.133Z–06:15:38.178Z：65,044ms，`checkedSources=12`、`newItems=360`、`failedSources=0`、12/12 `healthy`。逐源完成偏移 20.3–65.0s：`1340190821` 20.3s、`27534330` 23.0s、`401742377` 26.0s、`1955897084` 28.7s、`1265652806`/`1636034895` 39.7s、`161775300` 41.8s、`652239032` 50.2s、`3546636978489848` 50.3s、`8465957` 53.6s、`15319615`/`224267770` 65.0s。
- 06:22:41.602Z–06:22:46.403Z：4,801ms，`checkedSources=12`、`newItems=0`、`failedSources=0`、12/12 `healthy`；隔离库仍 360 条 FeedItem、24 条 healthy 健康日志（两轮各 12）。
- 与 04:31Z 的 15.9s/2.9s 相比，同一组 12 源在 65.0s 与 4.8s 间波动；均低于 90s check 窗口，但 65.0s 已超过 preview 默认 30s。不能把某次 preview 超时当成源不可用，也不能用一次 4.8s 推断上游已稳定。

**preview（热缓存）**：新窗口对 12 源再次执行完整 preview（limit=5），全部 HTTP 200/`ok=true`、`totalFetched=30`、41–102ms；4 个空 `game` 源仍返回“通用”。因 RSSHub 路由已被两轮 check 预热，这组耗时不能证明冷启动 30s 覆盖，也不能与 04:31Z 的 3.5–9.1s 直接比较。

**社区来源契约（P1-2）**：同一窗口的定时社区刷新失败，错误分别为 B站 `code=-400, message=请求错误`、NGA `fid=476 contains an invalid post`、小黑盒 `response contains an invalid item`。现有适配器已在外部响应边界抛出错误，`aggregateCommunityTopicsWithStatus` 按平台记录 `failed`，不会把错误转成成功空列表；新增 B站 `-400` 精确回归，定向 `sourceResponseStatus.test.ts` 18/18 通过。三源失败是上游响应/结构问题，不是本地空列表逻辑。

**管理端浏览器验证（P2-1）**：隔离 server 3101 提供构建后的 `client/dist`，使用一次性管理员密码登录。空 `game` + UID `15319615` 的 preview 在 UI 中返回“共抓到 30 条，展示前 5 条”，首条作者 `Aki惊蛰`，`itemKind=creator_video`；loading 文案“正在试抓取数据源…”在请求期间可见（本次约 9.5s）。无效 RSSHub route 返回 `role=alert` 的“预览失败”，包含 HTTP 503 和修正提示。验证中发现 `request()` 先展开 `options` 导致 `authHeaders()` 覆盖默认 `Content-Type: application/json`，Express 未解析 body，Zod 报 `expected object, received undefined`；修复为先展开 `options` 再合并 headers，重建客户端后 UI preview 成功。该缺陷影响所有带 body 的管理端写请求，之前的 API 脚本因自行设置 Content-Type 未暴露。截图与移动端布局因浏览器 0x0 隐藏视口无法验证，仅完成 DOM 结构检查。

**隔离事故（已披露）**：辅助校验脚本曾使用未指定 `datasourceUrl` 的 `PrismaClient`，在脚本进程没有 `DATABASE_URL` 时回退到真实库并执行只读计数（无写入）；应用进程本身始终使用隔离库。脚本已改为显式 `datasourceUrl`，本轮结论均以隔离库 PRAGMA 和计数为准。该行为仍超出“不读取真实数据库”的授权边界，不能描述为从未触及真实库。

**验证与边界**：后端 `npm.cmd test` 33 文件、230 项通过，`npm.cmd run build` 通过；客户端 `npm.cmd run lint`/`build` 通过。未调用付费 AI、未启用付费源、未恢复部署、未读写真实凭据；社区三源仍失败，B站 API 空 JSON/浏览器回退/间歇 503 未消除；浏览器视觉与移动端未验证。验收后停止临时 server、删除代理容器和临时目录。

## 2026-10-21 更正与修复（社区来源健壮性）

上述“NGA `invalid post`、小黑盒 `invalid item`、社区三源均失败”的判断只描述了修复前的行为。真实只读复核确认：NGA 返回 35 条帖子中 18 条 `postdate<=0`，小黑盒 22 条中 1 条缺少 `linkid/title/modify_at`；旧适配器把单条结构异常升级为整平台失败，导致其余可用内容一并丢弃。

- ✅ P1：新增 `filterValidItems`，仅过滤结构异常条目并告警；NGA、小黑盒、B站、米游社均已接入。响应级错误仍抛错，全无效的非空列表仍抛错。
- ✅ P2-1：部分来源失败改为 `degraded`，保留可用话题并记录错误；`degraded` 推进成功时间、不判 stale，但不参与陈旧话题清理。全平台失败才抛错。
- 真实只读探测（2026-10-21）：NGA 40 条可用（过滤 18 条、1 个论坛失败，状态 `degraded`）；小黑盒 21 条可用（过滤 1 条）。B站 game ranking 仍 `code=-400`，anime/popular 各 20 条，聚合时应为 `degraded`。
- 聚合器真实全链路未执行，以避免情绪分析触发付费 AI；米游社真实直连回退未探测。
- 验证：后端 33 文件、238 项通过（含真实隔离 SQLite 的 degraded 健康持久化），`npm.cmd run build` 通过。
- 本轮另修复队列异常恢复、测试临时目录隔离和设置接口白名单，详见 [ROADMAP](../ROADMAP.md)。
