# 小窗口任务队列与上下文交接

> 状态：2026-10-22。社区 AI 情绪截断已修复并在隔离环境复验：每批 ≤5 条、`max_tokens=4096`、60s 超时；`finish_reason=length`/缺失序号只拆半重试失败项（深度上限 2），失败结果 6h 冷却。真实三源 + `deepseek-v4-flash` 冷刷新 26 条（B站 5/NGA 15/小黑盒 6），NGA 15/15 `completed`、`unknown/failed=0`；5 次调用全部 `stop`、8,699 tokens、58.1s。增量 28 条、跳过 24 条已有，2 次调用均为新增话题，NGA bad=0。后端 243 项测试与 build 通过。preview 超时/空 `game`、12 源多窗口观察、社区来源错误契约、管理端浏览器验证和社区健壮性修复（P1/P2）均已完成；三个隔离窗口（04:31Z、06:14Z、06:22Z）均为 12/12 `healthy`，但单轮耗时从 4.8s 到 65.0s，上游方差仍大。2026-10-22 P1-4 三轮为 92.5s/32.0s/64.3s，失败均为间歇 RSSHub 503 且失败 UID 轮换。

## 当前事实

- **P1-4 长间隔观察（2026-10-22 完成）**：三轮均为新隔离库、阻断真实 `.env`、禁用直连 fallback、无 AI 调用。轮次 A（2026-10-21T08:09:58Z）92.5s、12/12 `healthy`、新增 360、0 失败；轮次 B（2026-10-22T00:34:36Z）32.0s、11/12 `healthy`、新增 330，`1955897084`（鸣潮）RSSHub 503；轮次 C（2026-10-22T03:30:58Z）64.3s、10/12 `healthy`、新增 300，`401742377`（原神）和 `1636034895`（绝区零）RSSHub 503。`15319615` 与 `224267770` 三轮均成功；失败 UID 每轮不同，属间歇 503，不是固定源或本地回归。逐源 JSON 与摘要保存在 `tmp/upstream-observation/`。
- **B站主路径**：生产 Compose 内置的 `rsshub` 服务（自定义 Dockerfile + Chromium）。`BilibiliVideoAdapter` 仍先请求 RSSHub 路由；公共 `rsshub.app` 只作最后回退。
- **Cookie 归属**：根目录 `.env` 的 `BILIBILI_COOKIE` 由 Compose 映射为 RSSHub 需要的 `BILIBILI_COOKIE_<uid>`。应用容器默认不接收该 Cookie。
- **直连备用**：`BILIBILI_DIRECT_API_FALLBACK` 默认 `false`；只有显式设为 `true`，或单个 Source 的 `config.directApiFallback=true`，才会绕过 RSSHub 直连。Cookie 存在本身不会开启直连。
- **默认源**：8 个 B站官方 UP + 4 个关注 UP，共 12 个 UID；`docker-compose.yml` 与 `docker-compose.rsshub.yml` 均为 12 个映射。开发 Compose 使用 `${BILIBILI_COOKIE_<uid>:-${BILIBILI_COOKIE}}`，允许 per-UID 覆盖并回退根 Cookie。
- **RSSHub 镜像**：`rsshub/Dockerfile` 先全局安装 `playwright@1.60.0` 再下载 Chromium，并把缓存复制到 `/home/node/.cache/ms-playwright`。基础镜像裁剪了 Playwright CLI，不能直接 `npx playwright`。
- **preview**：`SOURCE_PREVIEW_TIMEOUT_MS` 可配置，默认 30000ms、最低 5000ms，生产 Compose 透传；仅 `SourcePreviewSchema` 允许空/缺失 `game`，响应以“通用”展示。`CreateSourceSchema`/`UpdateSourceSchema` 仍要求非空 `game`；适配器仍收到空值，不改数据库或采集字段。
- **check 超时**：`SOURCE_CHECK_TIMEOUT_MS` 默认 45s，可配置；隔离验收使用 90s 和 `SOURCE_CHECK_CONCURRENCY=2`。
- **多窗口检查（2026-10-21，隔离环境）**：04:31Z 两轮 15.9s/2.9s；06:14:33Z–06:15:38Z 为 65.0s、新增 360、0 失败、12/12 `healthy`；06:22:41Z–06:22:46Z 为 4.8s、新增 0、0 失败、12/12 `healthy`。隔离库 360 条 FeedItem、24 条 healthy 日志。65.0s 窗口的逐源完成偏移 20.3–65.0s，`15319615`/`224267770` 最慢。
- **preview 复测（2026-10-21 新窗口）**：12 源全部 200/`ok=true`、`totalFetched=30`、41–102ms；4 个空 `game` 源返回“通用”。RSSHub 缓存已被两轮 check 预热，不能证明冷启动 30s 覆盖。
- **社区来源契约（2026-10-21 更新）**：响应级错误（HTTP/业务码/缺失列表）仍抛错；单条结构异常改为过滤并告警，全无效的非空列表才抛错。`aggregateCommunityTopicsWithStatus` 对部分成功来源记录 `degraded` 并保留已采集话题，仅全部来源失败才抛错。真实只读探测：NGA 40 条可用（过滤 18 条、1 个论坛失败）、小黑盒 21 条可用（过滤 1 条）；B站 game ranking 仍 `code=-400`，anime/popular 各 20 条，聚合时应为 `degraded`。
- **管理端请求封装（2026-10-21 修复）**：`client/src/services/api.ts` 的 `request()` 原先把 `...options` 放在 headers 之后，带 `Authorization` 时覆盖掉默认 `Content-Type: application/json`，导致 Express 不解析 body、Zod 收到 `undefined`。已改为先展开 `options` 再合并 headers；重建客户端后 UI preview 成功。影响过所有带 body 的管理端写接口。
- **社区全链路验收（2026-10-21，隔离 SQLite，付费 AI 已授权）**：真实三源聚合 + 真实 `deepseek-v4-flash` 情绪分析 + 持久化 + 公开路由全部跑通。冷刷新 37.4s/25 条（B站 5、NGA 15、小黑盒 5），3 次 AI 调用；增量刷新 11.6s，跳过 17 条已有话题，仅 1 次 AI 调用。`/api/community/topics` 与 `/insights` 均 200、`isStale=false`、缓存头正确。4 次 AI 调用共 7,741 tokens（prompt 3,661 / completion 4,080），全部 HTTP 200。
- **AI 截断缺陷（2026-10-21 已修复并复验）**：`deepseek-v4-flash` 是推理模型，旧实现 `max_tokens=1200` 被 reasoning 占满，NGA 11 条批次只返回 0–3 条并落库 `unknown/failed`。现按每批 ≤5 条、`max_tokens=4096`、60s 超时调用；解析后存在缺失/非法序号时，仅把失败序号拆半重试，深度上限 2，单条和 HTTP/传输错误不在本轮重试。`shouldReanalyzeSentiment` 对 `failed` 增加 6h 冷却（`unavailable` 不冷却，因为未产生付费调用），避免每次 30 分钟刷新重复重试。真实冷刷新 5 次调用全部 `stop`，reasoning 325–1469，NGA `unknown/failed=0`。
- **当前限制**：B站 API 仍返回空 JSON 并回退浏览器模式，上游 503/风控间歇存在；30s preview 仍短于 65s/90s 的 check 窗口；4 个关注 UP 源数据库 `game=''`；社区 NGA 仍有个别论坛权限不足（本轮 `fid=694`），B站 game ranking 仍上游 `-400`，两源按 `degraded` 保留可用话题；截图和移动端布局因浏览器 0x0 隐藏视口未验证。单次或三个窗口成功不等于长期恢复。
- **Cookie 更新助手**：`scripts\set-bilibili-cookie.cmd`（或 `node scripts/set-bilibili-cookie.mjs --from-clipboard`）提供隐藏输入/剪贴板读取，先校验 B站 nav，再原子更新根 `.env`、重建 RSSHub，并检查 healthz、容器登录态和一条路由；脚本不打印 Cookie。
- **剩余直连点**：头像补全 `fetchBilibiliAvatar` 仍直连 B站 `acc/info`，仅在源无头像时触发、失败不影响采集；不是主采集路径。

## 本窗口完成（2026-10-21 社区 AI 情绪截断修复）

| 项 | 结果 |
| --- | --- |
| 修复 | `sentiment.ts` 每批 ≤5、`max_tokens=4096`、60s；截断/缺失序号仅拆半重试失败项（深度 2）；单条与传输错误不重试 |
| 重试成本 | `failed` 结果 6h 冷却；`unavailable` 不冷却（无付费调用）；不提升情绪版本，避免批量重算已完成话题 |
| 测试 | 新增截断、部分返回、拆批、重试上限、传输错误、冷却策略 6 类回归；后端 33 文件、243 项通过；server build 通过 |
| 真实冷刷新 | 隔离 SQLite + 真实三源 + 真实 `deepseek-v4-flash`：26 条（B站 5/NGA 15/小黑盒 6），NGA 15/15 `completed`、`unknown/failed=0`；5 次调用全部 `stop`、8,699 tokens、58.1s |
| 真实增量 | 28 条，跳过 24 条已有；2 次调用均为新增话题，NGA bad=0；8.8s |
| 上游状态 | B站 game ranking `-400`、NGA `fid=694` 权限不足，均 `degraded` 并保留可用话题；小黑盒 `healthy` |

## 本窗口完成（2026-10-21 社区全链路验收）

| 项 | 结果 |
| --- | --- |
| 全链路 | 真实三源 + 真实 AI + 隔离 SQLite + 真实社区路由全部跑通 |
| 数据 | 25 条（B站 5、NGA 15、小黑盒 5）；NGA 过滤 18 条无效、小黑盒过滤 1 条；来源健康 `degraded`/`degraded`/`healthy` |
| 路由 | `/api/community/topics` 返回 5/25 条、`/insights` 返回 8 条 Top；均 200、`isStale=false`、缓存头正确 |
| AI 成本 | 4 次调用、7,741 tokens（prompt 3,661 / completion 4,080），全部 HTTP 200；冷刷新 37.4s、增量 11.6s |
| 增量 | 第二轮跳过 17 条已有话题，仅对失败/新增 NGA 条目调用 1 次 |
| 发现缺陷（已修复） | `max_tokens=1200` 被 reasoning 占满，NGA 8 条落库 `unknown/failed`；每次刷新重试。已由下一窗口拆批/冷却修复并复验 |
| 未完成（已完成） | 截断与重试成本修复、回归测试、真实全链路重跑均已在下一窗口完成 |

## 本窗口完成（2026-10-21 社区健壮性 P1/P2）

| 项 | 结果 |
| --- | --- |
| P1 条目级校验 | NGA/小黑盒/B站/米游社统一过滤结构异常条目；响应级错误与全无效列表仍抛错 |
| P2-1 部分成功 | 新增 `degraded`：部分榜单/评论/论坛失败保留可用话题；仅 healthy 参与陈旧清理，degraded 推进成功时间且不判 stale |
| P2-2 队列恢复 | 意外数据库错误后保留原错误，同时安排 30s 恢复运行，避免 pending 任务停摆 |
| P2-3 测试隔离 | `ACG_PULSE_TEST_TEMP_ROOT` 只作基目录，每次测试使用 UUID 子目录；teardown 不再删除用户基目录 |
| P2-4 设置白名单 | 两个设置接口只允许 `BILIBILI_COOKIE`；`COMMUNITY_SOURCE_HEALTH` 不可读写 |
| 验证 | 后端 33 文件、238 项通过（含 7 项真实隔离 SQLite）；server build 通过；NGA/小黑盒真实只读探测分别 40/21 条可用 |
| 未完成 | 当时未执行聚合器真实全链路（后续窗口已完成，见上节）；B站 game ranking 上游恢复、米游社真实回退探测仍未完成 |

## 上一窗口完成（2026-10-21 下半场）

| 项 | 结果 |
| --- | --- |
| P1-4 多窗口观察 | 新增 06:14Z（65.0s）和 06:22Z（4.8s）两个隔离窗口，均 12/12 `healthy`，新增 360→0、0 失败；隔离库 360 条、24 条 healthy |
| P1-2 社区契约 | 真实窗口确认 B站 `-400`、NGA `invalid post`、小黑盒 `invalid item`；错误不转空列表；新增 B站 `-400` 回归，定向 18/18 |
| P2-1 管理端浏览器验证 | 空 `game` preview 成功（30 条/展示 5 条）、loading 可见、无效 route 显示 `role=alert` 503；截图/移动端未验证 |
| 浏览器发现缺陷 | `request()` 的 header 展开顺序覆盖 `Content-Type`；修复并重建客户端，UI 复测成功 |
| 验证 | 后端 33 文件、230 项通过；server build、client lint/build 通过 |
| 隔离事故 | 辅助脚本的 PrismaClient 未显式 `datasourceUrl`，曾只读回退到真实库；无写入，已修复并披露 |
| 未完成 | 更长间隔的上游观察、社区三源恢复验证、浏览器视觉/移动端、生产部署 |

## 验证证据

- 后端：`npm.cmd test` 33 文件、238 项通过（含 7 项真实隔离 SQLite）；`npm.cmd run build` 通过。
- 前端：`npm.cmd run lint`、`npm.cmd run build` 通过（本轮修改了 `client/src/services/api.ts`）。
- 多窗口 check（隔离 SQLite + 临时 socat 代理）：04:31Z 15.9s/2.9s、06:14Z 65.0s、06:22Z 4.8s，12/12 `healthy`；06:14Z 新增 360、06:22Z 新增 0、失败 0；隔离库 360 条、24 条 healthy。
- preview：新窗口 12 源全部 200/30 条、41–102ms（热缓存）；4 个空 `game` 源“通用”；无 30s 超时。
- 社区契约：定向社区/队列/校验测试 48+22 项通过；真实只读探测 NGA 40 条可用（过滤 18 条、1 个论坛失败）、小黑盒 21 条可用（过滤 1 条）；B站 game ranking `-400`、anime/popular 各 20 条。
- 社区全链路（隔离 SQLite + 真实源 + 真实 DeepSeek）：25 条（B站 5/NGA 15/小黑盒 5），冷/增量 37.4s/11.6s；4 次 AI 调用、7,741 tokens；`/topics` 与 `/insights` 200、`isStale=false`；NGA 8 条 `unknown/failed` 源自 1200-token 截断；探针 1200 → 0 条有效行、4096 → 11/11 条（reasoning 2144–3679，13.4–22.2s）。
- 隔离：固定 `ACG_PULSE_TEST_TEMP_ROOT` + sentinel 运行测试后，基目录与 sentinel 仍在，说明 teardown 仅删除 UUID 子目录。
- 浏览器：空 `game` + UID `15319615` preview 返回 30/5、作者 `Aki惊蛰`；loading 文案可见（本次约 9.5s）；无效 RSSHub route 返回 503 错误与修正提示。
- 未验证：B站 game ranking 上游恢复、米游社真实回退、更长间隔/更多窗口、浏览器截图与移动端布局、上游长期稳定性、生产部署。

## 剩余任务队列

| 优先级 | 任务 | 验收 |
| --- | --- | --- |
| P1-1 | 保持 Cookie 映射与默认源一致 | 新增/删除 B站源时同时更新两份 Compose 和 `bilibiliCookieMapping.test.ts` |
| P1-5 | 观察 preview 30s 是否仍合适 | 仅在冷缓存窗口出现 preview 超时且 check 成功时再评估；不得因单次失败直接调大或改主路径 |
| P2-1 | 浏览器视觉/移动端 | 在可见视口下截图检查 loading、error、结果列表和窄屏布局；无可见视口时明确未验证 |
| P2-2 | 付费采集源评估 | 先积累自建 RSSHub 成功率、失败类型和 Cookie 寿命；不得默认启用，需用户单独授权 |
| P2-3 | 公开部署 | 未获单独授权不恢复；恢复时按部署指南并轮换旧实例凭据 |

## 已知风险与边界

- 路由 200、应用 `newItems` 和源健康要分开记录，`parseRss` 单次上限 30；多轮成功仍不是长期稳定性证明。
- 2026-10-22 的 A/B/C 三轮失败均为 RSSHub HTTP 503，且失败 UID 每轮变化（B：`1955897084`；C：`401742377`、`1636034895`），下一轮可恢复；不能把单轮 503 写成固定源故障或本地回归。逐源 `completionOffsetMs` 包含并发队列等待，不等于该源单次抓取耗时。
- 65.0s check 已超过 preview 默认 30s；preview 超时不能判定源不可用，必须以 check、`newItems` 和健康记录为准。
- 空 `game` 只在预览层放宽并使用“通用”占位；创建/更新仍要求非空，不能把占位写回数据库或当成真实游戏分类。
- 社区来源不能因为单条结构异常就整平台失败；NGA/小黑盒已过滤无效条目并保留可用内容。B站 game ranking 仍是上游 `-400`，应记录为 `degraded` 并保留 anime/popular 话题，不能写成整平台 failed 或成功空列表。
- `deepseek-v4-flash` 是推理模型，情绪分类会消耗 reasoning tokens。当前策略是每批 ≤5、`max_tokens=4096`、60s；`finish_reason=length` 或缺失序号只拆半重试失败项（深度 2），单条不再重试，HTTP/传输错误本轮不重试。真实冷刷新 5 次调用全部 `stop`，单次 reasoning 325–1469，远低于 4096。
- `failed` 情绪结果在 6h 内不会再次调用 AI；`unavailable` 不设冷却（没有付费调用），Provider 配置恢复后可在下一次刷新立即补分析。若后续调整批大小或输出预算，需同步更新截断/部分返回/重试上限测试。
- 情绪分析按来源依次执行，NGA 仍有论坛级权限问题（本轮 `fid=694`）时会标记 `degraded` 但保留其他论坛话题；不能把单论坛失败写成整平台失败。
- 管理端写请求已修复 `Content-Type` 合并顺序，但未逐一浏览器回归所有写接口；后续改动 `request()` 时需重新检查。
- 隔离验收脚本必须显式指定 `datasourceUrl` 并断言 `PRAGMA database_list`，防止 Prisma 在没有 `DATABASE_URL` 时回退到真实环境文件。
- 不要为了绕过 RSSHub 故障而把 `BILIBILI_DIRECT_API_FALLBACK` 长期改回 `true`；直连 412/429 会掩盖主路径健康状态。
- 本地/生产 RSSHub 未运行或上游风控时，不能把“配置完成”表述为“真实 B站采集已恢复”。
- 不要读取、打印或提交真实 Cookie、API Key、管理员密码、生产数据库或归档数据。需要真实 RSSHub 验收时，由 Compose 从根目录 `.env` 注入，命令只看状态码和 RSS 内容。
- 开发 Compose 的根 Cookie 回退只在 `BILIBILI_COOKIE` 非空时生效；per-UID 变量优先，适合多账号覆盖。
- RSSHub 容器缺少系统 CA 证书，容器内 `curl` 访问 HTTPS 需要 `-k`；Node/Chromium 使用各自 CA 存储，不能只凭容器内 `curl` 失败判断外网不可达。
- 如果本轮会话记录或工具日志需要分享，先轮换 B站 Cookie 和相关密钥。
- 未恢复公开部署；未获单独授权不调用付费 AI、不启用付费采集源。

> P1-4（长间隔上游观察）与 P1-6（社区 AI 情绪截断）已于 2026-10-22 完成；以下为剩余优先任务。

## 下个窗口提示词（可直接复制）

```text
你在 D:\111222333\personal-hot-monitor（ACG Pulse）项目中工作。目标：补齐管理端浏览器视觉/移动端验收，并保持 Cookie 映射一致。

背景（2026-10-22 已完成）：
- P1-4 三轮隔离 12 源 check：A 92.5s/12 healthy/360 条；B 32.0s/11 healthy/330 条（1955897084 503）；C 64.3s/10 healthy/300 条（401742377、1636034895 503）。15319615、224267770 三轮均成功；失败 UID 每轮不同，属间歇 RSSHub 503。
- 社区 AI 情绪截断已修复：每批 ≤5、max_tokens=4096、60s；截断/缺失序号只拆半重试失败项（深度 2）；failed 6h 冷却；隔离真实 AI 复验 NGA unknown/failed=0。
- 上游仍有方差：B站 game ranking -400、NGA fid=694 权限不足、B站 API 空 JSON/浏览器回退；check 耗时 32.0–92.5s，仍可能超过 preview 默认 30s。

任务：
1. 在可见视口下验收管理端 loading、error、结果列表和窄屏布局；无可见视口时明确未验证。
2. 保持 P1-1：新增/删除 B站源时同步两份 Compose 与 bilibiliCookieMapping.test.ts。
3. 如需复跑上游观察，复用 tmp/upstream-check.mts；不要用单轮 503 直接改采集路径。

约束：
- 不读取/打印真实凭据、Cookie、生产数据库；不恢复部署；不启用付费采集源。
- 真实 AI 调用需用户单独确认；先做无付费测试，再做小批量真实探针。
- 最小修改，复用现有测试设施；不要把失败写成成功空列表。

验收方法提示：
- Prisma 必须在 import 前设置隔离 DATABASE_URL，迁移后断言 PRAGMA database_list；不要用未指定 datasourceUrl 的 PrismaClient。
- 统计 AI 调用如需 patch axios，使用 ESM 入口（node_modules/axios/index.js）的默认实例；CJS 实例不同。
- 真实调用需记录 model、finish_reason、usage.completion_tokens_details.reasoning_tokens、耗时和调用次数；不要打印 headers 或内容。
```
