# ACG Pulse 优化路线图

> 多窗口协作时，优先使用 [后续小窗口任务提示词](NEXT_WINDOW_PROMPTS.md) 分派工作；每个窗口完成后同步更新这里的状态。

## 下一步计划（2026-10-22 更新）

- ✅ **P1-4 长间隔观察（完成）**：隔离轮次 A/B/C 分别为 92.5s/12 healthy/360 条、32.0s/11 healthy/330 条、64.3s/10 healthy/300 条；失败均为 RSSHub HTTP 503，且 UID 每轮变化（B：`1955897084`；C：`401742377`、`1636034895`），下一轮可恢复。`15319615`、`224267770` 三轮均成功；证据在 `tmp/upstream-observation/`。
- ✅ **P1 上游稳定性观察（旧窗口）**：04:31Z、06:14Z、06:22Z 三个隔离窗口均 12/12 `healthy`，但耗时 15.9s/65.0s/4.8s，说明上游方差仍大；见下节。
- ✅ **P1 社区条目校验**：社区响应改为“响应级错误抛错、条目级结构错误过滤”；NGA、小黑盒、B站、米游社均已覆盖，全无效的非空列表仍抛错。
- ✅ **P2 社区可靠性**：部分来源失败标记 `degraded` 并保留已采集话题；仅 `healthy` 来源参与陈旧清理；队列异常后 30s 恢复调度；测试临时目录始终使用唯一子目录；设置接口仅允许 `BILIBILI_COOKIE`，内部健康键不再经设置 API 暴露。
- ✅ **P2 管理端 preview 浏览器验证**：空 game 预览、loading、错误态通过；发现并修复管理端请求丢失 Content-Type 的缺陷；截图/移动端未验证。
- ✅ **P1 社区 AI 情绪截断（已修复）**：每批 ≤5 条、`max_tokens=4096`、60s；`finish_reason=length`/缺失序号只拆半重试失败项（深度上限 2），单条与传输错误本轮不重试；`failed` 结果 6h 冷却。隔离真实 AI 复验冷刷新 26 条（B站 5/NGA 15/小黑盒 6），NGA 15/15 `completed`、`unknown/failed=0`；增量 28 条、跳过 24 条已有，2 次调用均为新增话题，NGA bad=0；243 项测试与 build 通过。
- **P2 数据层与成本**：继续积累更长间隔的 check 成功率与 Cookie 寿命，再评估付费采集源；SQLite → PostgreSQL 仅在写入并发或访问量有实际证据时评估。
- **部署**：未获单独授权不恢复公开部署；恢复时按 [deployment-guide.md](deployment-guide.md) 执行并轮换旧实例凭据。

## 2026-10-22 P1-4 长间隔观察

- ✅ 每轮使用全新隔离 SQLite、阻断 `server/.env`、禁用 B站直连 fallback、通过临时 socat 代理访问自建 RSSHub，并阻断 AI 调用；头像补全以占位值跳过，避免非 RSSHub 请求干扰。
- ✅ 轮次 A（2026-10-21T08:09:58Z）：92.5s、12/12 `healthy`、新增 360、0 失败；RSS 请求 5.5–22.0s。
- ✅ 轮次 B（2026-10-22T00:34:36Z）：32.0s、11/12 `healthy`、新增 330、1 失败；`1955897084`（鸣潮）HTTP 503；RSS 请求 2.8–7.6s。
- ✅ 轮次 C（2026-10-22T03:30:58Z）：64.3s、10/12 `healthy`、新增 300、2 失败；`401742377`（原神）、`1636034895`（绝区零）HTTP 503；RSS 请求 5.2–14.1s。
- ⏳ 边界：失败 UID 每轮不同且下一轮可恢复，符合间歇 503/风控特征，不是固定源或本地代码回归；`completionOffsetMs` 含并发排队时间，不能当作单源抓取耗时；多轮成功仍不代表长期稳定。

## 2026-10-21 社区来源健壮性修复（P1/P2）

- ✅ P1：`filterValidItems` 统一社区条目级校验。NGA `postdate<=0`/缺失 `tid`/空标题、小黑盒缺失 `linkid`/`modify_at`、B站缺失 `aid`/`bvid`/`pubdate`、米游社缺失 `post_id`/标题的条目会被过滤并告警；响应级错误和全无效列表仍抛错。真实只读探测：NGA 返回 40 条可用帖子（过滤 18 条，1 个论坛失败）、小黑盒返回 21 条（过滤 1 条）。
- ✅ P2-1：`CommunitySourceResult.status` 增加 `degraded`。部分 B站榜单/评论、NGA 论坛失败时保留可用话题并记录错误；`degraded` 推进 `lastSuccessAt`、不判 stale，但不参与陈旧话题清理。真实 B站探测为 game ranking `code=-400`、anime/popular 各 20 条，聚合时会标记 `degraded` 而不是整平台失败。
- ✅ P2-2：`processAnalysisQueue` 遇到意外数据库错误后仍保留错误可见性，并安排 30s 恢复运行，避免 pending 任务长期停摆。
- ✅ P2-3：`ACG_PULSE_TEST_TEMP_ROOT` 仅作为基目录，Vitest 每次在其下创建 UUID 子目录；全局 teardown 只删除该子目录。
- ✅ P2-4：`/api/admin/settings` 与旧 `/api/settings` 只读写 `BILIBILI_COOKIE`；`COMMUNITY_SOURCE_HEALTH` 等内部键不可通过设置接口读取或覆盖。
- ✅ 验证：后端 33 文件、238 项通过（含 7 项真实隔离 SQLite 集成）；`npm.cmd run build` 通过；P2-3 用固定基目录 + sentinel 验证 teardown 后基目录和哨兵文件仍在。未调用付费 AI、未启用付费源、未恢复部署、未读写真实凭据/数据库。
- ⏳ 边界：聚合器真实全链路未执行，以避免情绪分析触发付费 AI；B站 game ranking 上游仍为 `-400`；米游社直连回退未做本轮真实探测。

## 2026-10-21 社区全链路验收（真实源 + 真实 AI）

- ✅ 经用户授权，使用隔离 SQLite、真实三源、真实 `deepseek-v4-flash` 和真实社区路由跑通全链路：25 条（B站 5/NGA 15/小黑盒 5），`/topics` 与 `/insights` 均 200、`isStale=false`，来源健康 `degraded`/`degraded`/`healthy`。
- ✅ 冷刷新 37.4s/3 次 AI 调用；增量 11.6s/1 次，跳过 17 条已有话题。共 4 次调用、7,741 tokens，全部 HTTP 200。条目级过滤生效：NGA 过滤 18 条、小黑盒过滤 1 条。
- ⚠️ 发现 P1（历史记录，已于同日修复）：`deepseek-v4-flash` 为推理模型，`max_tokens=1200` 被 reasoning 占满。NGA 11 条批次冷刷新仅返回 3 条、增量重试 0 条，8 条落库 `unknown/failed`；探针 1200 → 0 条有效行（`finish_reason=length`），4096 → 11/11 条（reasoning 2144–3679，13.4–22.2s）。
- ✅ 修复与复验（2026-10-21，隔离 SQLite + 真实 `deepseek-v4-flash`）：每批 ≤5、`max_tokens=4096`、60s；仅对失败序号拆半重试（深度 2），单条/传输错误本轮不重试；`failed` 6h 冷却。冷刷新 26 条、NGA 15/15 `completed`、`unknown/failed=0`，5 次调用全部 `stop`、8,699 tokens、58.1s；增量 28 条、跳过 24 条已有，2 次调用均为新增话题，NGA bad=0。后端 243 项测试与 build 通过。

## 2026-10-21 多窗口观察、社区契约与管理端预览

- ✅ 与 04:31Z 间隔约 1 小时 43 分后新增两轮隔离 12 源 check：06:14:33Z–06:15:38Z 为 65.0s、新增 360、0 失败、12/12 `healthy`；06:22:41Z–06:22:46Z 为 4.8s、新增 0、0 失败、12/12 `healthy`；隔离库 360 条、24 条 healthy 日志。逐源完成偏移 20.3–65.0s，`15319615`/`224267770` 最慢。
- ✅ 新窗口完整 preview 12/12 返回 200/30 条、41–102ms，但缓存已热，不能证明 30s 冷启动；4 个空 `game` 源仍显示“通用”。
- ✅ P1-2 契约：同一窗口社区刷新三源分别失败于 B站 `-400`、NGA `invalid post`、小黑盒 `invalid item`；错误按平台保留，不转空列表；新增 B站 `-400` 回归，定向 18/18。
- ✅ P2-1 浏览器：管理端空 game preview 成功（30/5、作者 Aki惊蛰）、loading 可见、无效 route 显示 `role=alert` 503；发现 `request()` 的 header 展开顺序覆盖 `Content-Type`，已修复并重建客户端。截图/移动端因 0x0 隐藏视口未验证。
- ✅ 验证：后端 33 文件、230 项通过；server build、client lint/build 通过。
- ⏳ 边界：65.0s 已超过 preview 默认 30s；社区三源仍失败；B站 API 空 JSON/浏览器回退/间歇 503 未消除；这不是长期稳定性证明。
- ⚠️ 隔离事故：辅助脚本的 PrismaClient 未显式 `datasourceUrl`，曾只读回退到真实库；无写入，已修复并在记录中披露。

## 2026-10-21 预览可靠性修复

- ✅ 用户确认方案 A+B：preview 超时改为 `SOURCE_PREVIEW_TIMEOUT_MS` 可配置，默认 30000ms、最低 5000ms，并由生产 Compose 透传；仅 `SourcePreviewSchema` 允许空/缺失 `game`，响应以“通用”展示。`CreateSourceSchema`/`UpdateSourceSchema` 仍要求非空，采集主路径和 check 不变。
- ✅ 回归：`sourcePreview.test.ts` 新增超时默认值、环境变量覆盖和空 game 占位 3 项，`validation.test.ts` 新增预览/创建边界 1 项；后端 33 文件、229 项通过，`npm.cmd run build`、client lint/build 和两份 Compose `config --quiet` 通过。
- ✅ 隔离真实源验证（2026-10-21 12:30–12:32）：临时 SQLite、匿名管理员、空 AI Key，RSSHub 仅经临时代理到自建实例；preview 首轮 10/12 成功（每源 30 条，3.5–9.1s），30s 内覆盖 `15319615`（8.9s）和 `1265652806`（5.8s），4 个空 `game` 源均返回“通用”；`1340190821`/`161775300` 首轮 422 路由失败，重试 37/73ms 成功。两轮 check 均 12/12 `healthy`，首轮新增 360/0 失败、次轮新增 0；隔离库 360 条、24 条 healthy 日志。未出现 preview 超时。
- ⏳ 上游仍间歇：两个官方源 preview 首轮 422、check 和重试成功；30s 仍短于 90s check 窗口，单一时间窗口不能写成永久恢复。上游 API 空 JSON、浏览器回退和间歇 503 未消除。

## 2026-10-20 B站主路径与真实源验收

- ✅ B站主路径切换到自建 RSSHub：应用容器不再接收 `BILIBILI_COOKIE`，直连 API fallback 改为显式开启，不再由 Cookie 存在隐式触发。
- ✅ 修复自建 RSSHub 镜像：基础镜像裁剪了 Playwright CLI，改为全局安装 `playwright@1.60.0` 后下载 Chromium，并复制到 `node` 用户缓存目录。
- ✅ 真实自建 RSSHub 启动并通过 `healthz`；`/bilibili/user/video/401742377` 返回 HTTP 200、RSS XML 和 40 个 `<item>`。
- ✅ 隔离应用侧单源验收：试抓 30 条；采集新增 30 条、0 失败；源健康变为 `healthy`，`lastSuccessAt` 在连续两次采集中推进。
- ✅ Cookie 映射覆盖：主/开发 Compose 均为 12 个 UID；开发 Compose 增加根 Cookie 回退；新增 `bilibiliCookieMapping.test.ts` 3 项回归。后端 33 文件、225 测试与 build 通过。
- ✅ 有效 Cookie：nav 返回 `code=0, isLogin=true`；12 个 per-UID Cookie 均为非空；`scripts/set-bilibili-cookie.cmd` 可隐藏输入/读剪贴板、校验 nav、原子更新根 `.env`、重建 RSSHub 并检查 healthz、容器登录态和路由。
- ✅ 12 源路由复核：11 个默认 UID 返回 HTTP 200、每个 40 个 `<item>`；`15319615`（aki惊蛰）返回 503/0，日志为浏览器模式 45 秒未收到视频列表响应，属于该来源上游/风控问题。有效 Cookie 未消除 API 空响应，RSSHub 仍回退浏览器模式。
- ✅ 旧 per-UID Cookie 覆盖项：用户确认 `BILIBILI_COOKIE_401742377` 已过期并删除；开发 Compose 复核为 12 个 per-UID Cookie、全部非空且同值（回退到新根 Cookie），app 不接收 Cookie。
- ✅ 新 Cookie 下应用侧 12 源验收：隔离临时 SQLite、匿名管理员、空 AI Key，RSSHub 仅走本机代理到自建实例；首轮 check 新增 360（每源 30）、0 失败、12/12 `healthy`，次轮新增 0、`lastSuccessAt` 推进；隔离库 360 条与 24 条 healthy 健康日志。`15319615` 与 `1265652806` 均在 check 中成功，check 后 `15319615` 路由返回 200/40。
- ✅ 2026-10-21 已修复 preview 限制：超时改为可配置（默认 30s），预览允许空 `game`；上游 API 空响应与间歇 503 仍未消除，见上节。
- ⏳ 待评估：社区来源上游风控（B站 game ranking 仍 `code=-400`，anime/popular 可用；NGA/小黑盒的条目级结构异常已本地过滤）；付费采集源仅在自建 RSSHub 成功率有测量结果后再评估。

## 2026-10-19 采集可靠性修复

- ✅ 官网采集支持文章/标题/链接/日期选择器及 URL 白名单，去除全页链接候选；RSS/Atom 复用已下载响应，匿名试抓验证通过。
- ✅ RSSHub、米游社与社区平台区分外部错误和合法空列表；社区按来源维护成功时间，话题与健康记录原子保存，失败保留缓存并限制公开懒刷新频率。
- ✅ FeedItem 保存与分析任务同事务，输入版本变化时丢弃旧结果并重新处理，启动补回无任务的 null/pending 分析；保留终态失败限制。
- ✅ 后端 `npm.cmd test`：31 文件、220 项通过；`npm.cmd run build` 通过。热度口径与完整情绪分析范围保持。
- ✅ 2026-10-20 复核：修复终态任务 `nextRunAt=9999` 导致 `setTimeout` 溢出、队列空转的问题；新增唯一临时 SQLite 库、环境文件守卫与 6 项真实事务验收（回滚、两个版本竞争窗口、去重与终态失败）。
- 该轮未做真实源业务验收，并有一次测试隔离事故；2026-10-20 已补充隔离真实源/DeepSeek 验收与 B站主路径切换，详见 [本轮记录](collection-optimization-2026-10-19.md)。该轮未恢复公开部署、未调用付费 AI；后续 DeepSeek 调用经用户单独授权。

## 2026-07-03 Review Follow-Up

- Done: CI now runs the server Vitest suite and client ESLint before build.
- Done: Admin source validation now rejects unsupported source types and validates known `config` fields before persistence.
- Done: AI analysis task enqueue now uses a database-level `dedupeKey` to make open/retryable tasks idempotent per `feedItemId`.
- Done: `/api/public/stories` now reads candidates in stable cursor batches instead of a fixed 500-item window, preventing deep pagination totals from being truncated.
- Done: production schema sync now uses explicit Prisma migrations with a baseline and `prisma migrate deploy`; `db push` remains local-only.

## 第一阶段：基础稳固（已完成）

- 明确项目使用 UTF-8 编码，并添加 `.editorconfig` 固化编辑器约定。
- 将管理端关键写接口接入 Zod 校验，避免手写解析导致的边界行为不一致。
- 将公开 stories/items 查询参数接入 Zod 校验，统一非法输入的 400 响应。
- 配置 Vitest 只运行 `src/**/*.test.ts`，避免 `dist` 构建产物里的测试被重复执行。

## 第二阶段：稳定性、性能与可观测性（已完成）

- 优化 `/api/public/stories` 查询：
  - ✅ 已将 facet 统计改为数据库聚合，避免每次全量拉取 feedItem 到内存统计。
  - ✅ Stories 使用固定候选窗口与短时缓存，分页 total 和页边界保持稳定。
  - ✅ 搜索参数 `q` 已接入 SQLite FTS5，并保留降级查询。
- 将 AI 分析队列持久化：
  - ✅ 增加任务状态：`pending / running / completed / failed`。
  - ✅ 记录 `retryCount`、最近错误、耗时和 provider/model。
  - ✅ 管理后台展示队列长度、失败任务和手动重试入口。
- 增强运维能力：
  - ✅ 增加 SQLite 自动备份与恢复文档。
  - ✅ 增加源健康历史、失败率和最近错误统计。
  - ✅ 为定时任务增加互斥锁，避免重叠执行。
  - ✅ 源健康日志保留策略（默认 30 天，可配置 HEALTH_LOG_RETENTION_DAYS）。
- 补齐测试：
  - ✅ AI JSON 解析与 fallback 测试（`aiParsing.test.ts`、`analysisQueue.test.ts`）。
  - ✅ source 创建/更新/布尔值解析测试（`validation.test.ts`）。
  - ✅ stories filter/facet 组合测试。
  - ✅ checker 稳定身份与去重测试，覆盖 external ID 格式漂移、同源更新和跨源隔离。
  - ✅ FTS5 触发器生命周期测试（mock + 真实 SQLite 集成）。
  - ✅ FeedItem 稳定 `identityKey`、数据库唯一约束与历史回填测试。

## 第三阶段：产品能力扩展（待办）

- 全文搜索与高级筛选：
  - ✅ 已实现 SQLite FTS5 全文搜索，支持标题、正文、作者、来源组合搜索。
  - ✅ FTS 召回上限提升至 10000，修复深分页筛选漏召回。
  - 增加保存筛选视图或常用订阅。
- 导出与日报：
  - ✅ 已实现 Markdown 导出接口（日报/周报），支持按游戏、分类、重要性筛选。
  - ✅ 前端已添加导出入口（SummaryColumn 顶部按钮）。
  - 后续：PDF 导出方案评估（详见 DECISIONS.md）。
- 自定义数据源：
  - 管理后台支持自定义 RSS/RSSHub/官网源。
  - ✅ 增加源配置校验、试抓取和预览：已接入 admin-only `/api/admin/sources/preview`，前端提供 loading/error/empty/success 闭环。
- 多语言与展示体验：
  - 评估英文 UI 与内容摘要翻译。
  - 优化移动端批量筛选、刷新提示和空状态。
- 数据洞察页增强：
  - ✅ 已实现社区风向分析（`GET /api/community/insights` + InsightsPage 社区风向分区）。
  - ✅ 复用 `CommunityTopic` 数据，后端聚合返回 topTopics、sourceShare、heatTrend。
  - ✅ 前端热门话题 Top 8、来源热度占比、近期热度趋势折线图，stale-first + Socket 刷新。
- 数据库升级预案：
  - 当写入并发或公开访问量明显提升时，评估从 SQLite 迁移到 PostgreSQL。
- 社区热点页性能优化：
  - ✅ P0：先返回旧数据、后台异步刷新，消除冷启动 30-60s 阻塞。
  - ✅ P1：NGA 6 论坛并行抓取（3 个一批），替换串行+500ms 延迟。
  - ✅ P1：Framer Motion 去掉逐帧 stagger delay，加 React.memo。
  - ✅ P2：数据库批量 upsert 替代逐条写入（findMany + createMany）。
  - ✅ P3：API 响应加 Cache-Control 头（公开接口 60-3600s，管理端 no-store）。
  - ✅ P3：清理 NGA 摘要中的 HTML/论坛标记，前端展示再兜底清洗。
  - ✅ P3：小黑盒热度改为使用评论、互动、转发、话题热度、轻量负反馈和时间衰减，减少“只因更新时间新就虚高”的偏差。
  - ✅ P3：社区热度说明改为标题旁信息弹窗，明确各来源热度规则和来源内归一化边界。
  - 不做：跳过低热话题 AI 情绪分析——保留全量 AI 分析以保证情绪数据完整性。
