# 架构决策记录

本文档记录对长期维护有影响的项目决策。新增决策按时间倒序追加。

## 2026-06-23：社区风向情感判断标准与局限提示

**判断标准**：社区话题情感分为 `positive`、`negative`、`neutral`。明确命中正向/负向关键词时优先使用规则判断，避免无谓 AI 调用；规则分数接近中性或语义含混时，再交给 AI 判断反讽、阴阳怪气、语境隐含情绪和社区黑话。

**局限性**：情感分类不是事实判断，容易受标题党、梗图语境、反串、少量样本、跨平台语境差异和模型波动影响。当前结果适合作为风向趋势参考，不适合作为单条内容的定性结论或运营处置依据。

**界面约束**：主页面只在社区统计区下方显示一行低权重提示，避免干扰浏览；详细标准留在文档中维护。后续如果引入置信度或人工校正，应优先扩展数据结构，而不是只改文案。

## 2026-06-23：主页面 facets 使用 Story 数语义，统计面板保留 FeedItem 数语义

**决策**：`/api/public/stories` 返回的 facets 表示聚合后的 Story 数，而不是底层 FeedItem 条数。主页面筛选项面向 StoryCard 列表，用户看到的计数应尽量对应“点击筛选后能看到多少个故事”。同一故事即使来自多个来源、包含多条 FeedItem，也只在游戏、分类和重要性 facet 中计 1 次。

**边界**：数据洞察、运维面板、来源统计和容量统计继续使用 FeedItem 数语义。这些视图关注采集规模、来源贡献、容量上限和运行健康，原始情报条数比聚合故事数更适合作为指标。

**实现约束**：Story facets 从 `aggregateFeedItemsToStories()` 的结果计算，并受同一个候选窗口和筛选条件约束；`includeFacets=false` 仍返回空 facets，避免摘要流重复消耗计算。后续 UI 文案应区分“故事数”和“情报条数”，不要混用。

## 2026-06-23：DeepSeek 默认配置与多值查询契约统一

**Provider 默认值**：生产长期默认使用 `AI_PROVIDER=deepseek` 与 `DEEPSEEK_MODEL=deepseek-v4-flash`。README、`.env.production.example`、`docker-compose.yml` 和部署指南必须保持一致；OpenRouter 与 Xiaomi MiMo 作为可选 Provider 保留显式覆盖入口。

**环境变量传递**：所有运行时代码会读取的可配置项必须在 Compose 中显式传入容器，不能只写在 `.env.production.example`。当前需要显式传入的 Provider/报告配置包括 `DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`、`OPENROUTER_MODEL`、`MIMO_BASE_URL`、`MIMO_MODEL` 与 `REPORT_TIMEZONE`。

**公开查询契约**：前端请求参数只对明确支持多值语义的字段拆分或重复传参，例如 `game`、`category`、`importance`、`sourceUid`。普通字符串字段如 `q` 必须原样传递，避免用户搜索词中的逗号被误解析。关注源筛选支持多个 `sourceUid`，后端按 UID 集合过滤主列表与 facets。

## 2026-06-22：AI 分析不阻塞情报入流，生产默认 DeepSeek V4 Flash

**状态语义**：FeedItem 在采集成功后立即持久化并进入公开查询候选；公开查询允许 `analysis = null`，pending/failed Analysis 的默认可见性也是 `public`。AI 队列负责补齐分类、重要性、摘要、可见性与去重关键词，不是情报入库开关。

**重试影响**：失败任务重试成功后会覆盖 Analysis 并广播 `item:analyzed`。条目可能继续留在原位置、移动到新的分类/重要性筛选结果，或因最终 `visibility` 为 muted/hidden 而退出默认公开流；重试不会重新创建 FeedItem。

**Provider 决策**：生产默认使用 DeepSeek OpenAI 兼容接口 `https://api.deepseek.com/chat/completions`，模型为 `deepseek-v4-flash`。`DEEPSEEK_BASE_URL` 和 `DEEPSEEK_MODEL` 必须由 Compose 显式传入容器，不能只写在 `.env`。`deepseek-chat` 仅为兼容别名，官方已公告将于 2026-07-24 23:59（北京时间）弃用。

**切换规则**：更换 Provider 时先调用官方 `/models` 验证 Key 与模型，再备份并原子更新 `.env`，运行 `check-config.sh` 和 `docker compose config --quiet`，最后强制重建 app 容器。密钥不得出现在命令参数、日志或 Git 中。

## 2026-06-21：情报身份与 AI 分类彻底解耦

**问题**：同一来源适配器可能先后返回 BV 号、完整 URL 等不同 `externalId`；同一稿件的 AI 分类也可能在 `trailer`、`creator_video`、`version` 等类别间漂移。旧逻辑把分类兼容性放在确定性身份判断之前，导致同稿重复入库、重复展示。Stories 分页还会随页码扩大候选集，使总数和页边界不稳定。

**决策**：
- FeedItem 写入前生成稳定 `identityKey`。优先提取 Bilibili BV、米游社文章 ID、NGA tid；其他来源使用规范化 external ID 或去跟踪参数后的 URL。
- 数据库以 `(sourceId, identityKey)` 建立唯一约束。同一来源同一身份只更新内容，不再创建新快照；只有标题或正文变化时才重新进入 AI 分析队列。
- AI `category` 只描述内容，不参与 FeedItem 身份判定。Story 聚合顺序固定为：确定性 URL/外部 ID、时间窗内完全相同标题、分类兼容的模糊关键词。
- 服务升级时执行一次历史 identity 回填和同源去重；完成后依靠唯一约束阻止复发，不在每轮采集做全表清理。
- 生产入口按“SQLite 热备并校验 → 移除可重建 FTS → `prisma db push --accept-data-loss` → 启动 identity 回填”的固定顺序迁移；不得绕过备份手工修改生产 schema。
- Stories 所有页使用相同的 500 条候选窗口，保证同一查询的 total、totalPages 与页边界稳定。

**演进边界**：新增平台时先扩展 `itemIdentity.ts` 和身份测试。若既有 identity 算法需要变更，必须显式设计版本化回填，不能静默改变已写入键的语义。

**验收**：历史库同源规范化 URL 重复组归零；全量 Stories 遍历时返回数量等于 total、story ID 无重复、跨 Story 相同来源 URL 归零；服务端构建和全量测试通过。

## 2026-06-20：Stories facets 单次扫描与可选返回

**问题**：首页同时请求主情报流和摘要流，两次 `/api/public/stories` 都会执行 4 个 facets 分组查询。SQLite 在并发请求下串行争用，冷请求 P95 长期处于 225–390ms。

**决策**：
- facets 改为一次 `Analysis + FeedItem + Source` 分组扫描，由服务层在内存中生成游戏、分类、关注分类和重要性计数。
- facets 使用 60 秒、最多 20 个键的有界缓存，并对相同条件的并发请求去重。
- API 新增向后兼容的 `includeFacets=false` 参数；首页摘要流不消费 facets，因此显式跳过计算，返回结构仍保留空 facets。
- 新旧实现针对默认、游戏资讯、关注资讯和全部可见性四组真实数据逐项对比，计数保持一致。

**验收**：首页四接口并发冷测时 Stories 服务端处理约 123–125ms，缓存命中约 9ms；目标为常规冷请求低于 150ms。

## 2026-06-20：FTS5 触发器自动升级与容量硬上限

**问题**：旧版 `FeedItem_ad` / `FeedItem_au` 使用 FTS5 `VALUES('delete', ...)` 指令，并为 `sourceName` 写入空字符串。它与索引中的真实来源名不一致，删除 FeedItem 时会触发 `SQL logic error`，导致采集流程停在容量清理阶段。

**决策**：
- `ensureFTS5()` 除检查触发器是否存在外，也检查是否仍使用旧删除指令；发现旧定义时自动重建触发器和索引。
- 容量清理只执行一次 FeedItem 批量删除，Analysis、AnalysisTask 与 Notification 由数据库外键级联删除，避免多段写入之间的锁竞争。
- 服务启动时先完成 FTS5 修复，再执行一次容量校正，因此旧部署升级后无需等待下一轮定时采集。

**验收**：旧触发器环境下启动后成功将 2,038 条可见情报清理到 2,000 条，随后确认 FTS5 删除触发器采用 `DELETE FROM FeedItemFTS` 语义。

## 2026-06-20：轻量运维监控与统计查询服务化

**决策**：第一阶段不引入 Prometheus/Redis，使用有界进程内窗口采集 API 延迟；容量指标通过管理员鉴权接口按需读取；公开统计由独立服务负责聚合、并发去重和短时缓存。

**原因**：
- 当前为单实例 SQLite 部署，外部监控栈的维护成本高于收益。
- 延迟样本只需支持即时诊断，固定 2,000 条上限可避免监控自身造成存储增长。
- 原统计接口会全量读取 Analysis，并串行执行 24 次小时计数，是数据增长后的首要延迟来源。

**实现边界**：
- `observability/apiMetrics.ts` 只负责请求样本和聚合，不访问数据库。
- `observability/operationsService.ts` 负责容量、文件和队列快照，只通过受保护的 `/api/admin/ops/metrics` 暴露。
- `services/statsService.ts` 使用一条分析分组查询和一次 24 小时记录查询，缓存默认 30 秒，采集完成后主动失效。
- API 延迟样本不持久化；未来需要跨实例或长期趋势时，再替换为 Prometheus/OpenTelemetry，接口 DTO 保持稳定。

**验收基线**：
- 1,876 条 FeedItem 的本地数据库上，缓存失效统计计算约 57ms。
- 缓存命中服务端处理约 0.4–0.8ms。
- 隔离合成数据基准：5,000 条缓存失效约 154ms，10,000 条约 329ms；缓存命中均低于 1ms。
- 默认 2,000 条满足冷计算低于 80ms；提高容量上限前应进一步改为 SQL 条件聚合或异步物化统计。
- 优化前后分类、重要性和 24 小时趋势逐项一致。

## 2026-06-12：FTS 召回上限提升至 10000

**决策**：将 FTS5 搜索的召回上限从 1000 提升至 10000（`FTS_RECALL_LIMIT`），覆盖广泛查询下的筛选漏召回问题。

**原因**：
- 原实现先取 1000 个 FTS 匹配 ID，再叠加 category/importance/visibility 等筛选。当 FTS 命中 >1000 且筛选目标分布在后段时，用户看到的结果不完整。
- `/items` 端点的 `total` 原来用 Prisma `count({ where })`，在 FTS 场景下受 1000 ID 限制，显示不准确。
- `/stories` 端点的 `candidateLimit` 在 FTS 场景下同样受限。

**影响**：
- `/items`：FTS 召回上限 10000，`total` 使用 Prisma 精确计数（已包含筛选条件）。
- `/stories`：FTS 召回上限 10000，fetch `take` 使用 `min(ftsIds.length, FTS_RECALL_LIMIT)`。
- 7 个新单元测试覆盖：limit 传递、total 返回、空查询、错误处理。
- SQLite `IN` 子句 10000 个 ID 性能可接受（<50ms），无需改用 JOIN。

## 2026-06-12：报告日期时区修正

**决策**：日报/周报所有日期边界使用 `REPORT_TIMEZONE`（默认 `Asia/Shanghai`）计算，不依赖服务器本地时区。

**原因**：
- Docker 容器通常运行在 UTC，`new Date().toISOString().slice(0, 10)` 在 UTC+8 凌晨 0-8 点会返回前一天日期。
- `setHours(0, 0, 0, 0)` 按服务器本地时区设置午夜，在 UTC 服务器上产生错误的查询范围。

**技术方案**：
- `todayStrInTz(tz)` — 用 `Intl.DateTimeFormat.formatToParts` 获取目标时区的今天日期字符串。
- `startOfDayInTz(dateStr, tz)` — 计算目标时区午夜对应的 UTC 时间戳，处理正/负 UTC 偏移和跨日边界。
- `endOfDayInTz(dateStr, tz)` — 午夜 + 24h - 1ms。
- 前端 `ReportExportButton` 默认不强传日期，让后端按 `REPORT_TIMEZONE` 统一决定日报/周报边界；界面展示仍按默认 `Asia/Shanghai` 作为提示。

**影响**：
- 11 个新测试覆盖：UTC 服务器下 Asia/Shanghai 日期、负偏移时区（America/New_York）、午夜边界、日/周范围时长。
- `.env` 新增 `REPORT_TIMEZONE` 可配置项。

## 2026-06-12：SourceHealthLog 保留策略

**决策**：在每次采集完成后自动清理过期的 SourceHealthLog 记录，默认保留 30 天，通过 `HEALTH_LOG_RETENTION_DAYS` 环境变量可配置。

**原因**：
- 每次 source check 为每个源写入一条日志，长期运行后表会无限增长。
- 健康历史 API 只查最近 24 小时数据，更早的日志无业务价值。
- 清理在采集流程末尾执行，不影响主流程性能。

**影响**：
- 新增 `cleanupExpiredHealthLogs()` 函数，复用 `MAX_FEED_ITEMS` 同类的 env 读取模式。
- `docker-compose.yml` 和 `.env.production.example` 需补充 `HEALTH_LOG_RETENTION_DAYS` 说明。
- 3 个新测试覆盖：过期日志清理、近期日志保留、自定义保留天数。

## 2026-06-12：API 客户端统一 401 处理 + 运维脚本

**决策**：
1. `api.ts` 的 `request()` 函数在 401 响应时清除 token 并抛出 `UnauthorizedError`，前端 hook 统一捕获并回到登录态。
2. 新增 `scripts/check-config.sh` 预检环境变量，`scripts/reset-admin-password.sh` 安全重置密码。
3. `deployment-troubleshooting.md` 补充 .env 加载路径差异说明。

**原因**：
- 原实现各 catch 块独立处理错误，部分操作 token 过期只显示"保存失败"而非回到登录态。
- 运维人员忘记密码或 .env 配置不全是最常见的部署问题，需要脚本和文档引导。

**影响**：
- `UnauthorizedError` 从 `api.ts` 导出，所有 admin 操作自动获得 401 处理。
- 登录接口的 401（密码错误）不触发 session 清除，保持现有行为。
- 运维脚本不打印敏感值，`reset-admin-password.sh` 自动备份旧 .env。

## 2026-06-12：reanalyze-all 路由改为批量入队 + 原子化 Claim

**决策**：
1. `POST /reanalyze-all` 不再在请求 handler 中逐条执行分析，改为批量写入 `AnalysisTask` 表后立即返回。
2. `claimNextTask` 从 find-then-update 改为 `updateMany` + `WHERE` 条件原子 claim。
3. 队列 worker 对重分析任务使用 `force: true`，避免“入队成功但已有 completed 分析被跳过”。
4. 前端移除 reanalyze WebSocket 事件监听，改为队列状态轮询。

**原因**：
- 原实现绕过持久化队列，进程重启丢失进度，与队列 worker 并发竞争。
- find-then-update 的 claim 模式在并发场景下可能重复执行同一任务。
- WebSocket 一次性事件在用户刷新页面后丢失，队列 polling 更可靠。

**影响**：
- `POST /reanalyze-all` 返回 `{ total, status: 'enqueued' }` 而非旧的进度事件。
- `POST /items/:id/analyze` 也改为入队，返回 `{ status: 'enqueued', feedItemId }`。
- 前端 `useAdmin` 不再维护 `reanalyzeProgress` 状态，AdminDrawer 移除进度卡片。
- 新增 `reanalyzeItem()` 和 `reanalyzeAll()` 导出函数供 admin 路由使用。
- 批量重分析跳过同一 feedItem 已有 pending/running 任务，减少重复队列噪声。

## 2026-06-12：日报/周报 Markdown 导出方案

**决策**：先实现 Markdown 格式的日报/周报导出，暂不引入 PDF 导出。

**原因**：
- Markdown 是纯文本，无需额外依赖，生成和消费成本最低。
- 复用现有 `/api/public/stories` 的查询和聚合逻辑，只加一层格式化。
- 前端通过 `window.open` 直接触发浏览器下载，无需额外状态管理。
- PDF 导出依赖重量级库（如 puppeteer、html2pdf.js），对 Docker 镜像大小和运行时内存有显著影响，需要独立评估。

**技术选型**：
1. **后端**：新增 `server/src/gamepulse/reports/markdownExport.ts` 生成 Markdown，`routes/handlers/reports.ts` 提供 API。
2. **API 边界**：`GET /api/public/reports/daily`（JSON）、`GET /api/public/reports/weekly`（JSON）、`GET /api/public/reports/export`（Markdown 下载）。
3. **筛选**：复用现有 `game`、`category`、`importance`、`visibility` 参数，时间范围通过 `date`（日报）或 `weekStart`（周报）控制。
4. **前端**：`ReportExportButton` 组件嵌入 SummaryColumn，提供"今日日报"和"本周周报"两个快捷下载项。

**影响**：
- 新增 3 个公开 API 端点，不影响现有接口。
- 前端 SummaryColumn 顶部新增导出按钮，不影响主页面布局。
- 后续 PDF 导出可基于同一数据源，用浏览器端方案（html2pdf.js）或服务端方案（puppeteer），独立评估后再实施。

## 2026-06-12：SQLite FTS5 全文搜索方案

**决策**：使用 SQLite FTS5 虚拟表实现全文搜索，替代 Prisma 的 LIKE '%keyword%' 查询。

**原因**：
- LIKE 查询全表扫描，10 万+ 数据量时延迟明显（200ms+）。
- FTS5 使用倒排索引，搜索延迟稳定在 10ms 以下。
- FTS5 是 SQLite 内置功能，无需外部依赖。

**技术选型**：
1. **不使用 content=FeedItem 模式**：Prisma 使用 UUID 主键，与 FTS5 的 rowid 关联复杂。
2. **独立 FTS5 表**：直接存储 feedItemId 和搜索字段，通过触发器自动同步。
3. **UNINDEXED 字段**：feedItemId 不参与搜索，只用于关联查询。
4. **降级方案**：FTS5 不可用时自动降级到 LIKE，保证功能连续性。

**影响**：
- 搜索性能显著提升（10 万+ 数据从 200ms+ 降至 10ms 以下）。
- 新增 FTS5 虚拟表和触发器，需要维护数据同步。
- 管理端新增 `/api/admin/search-index/rebuild` 接口用于重建索引。
- 部署后首次启动会自动创建 FTS5 索引。

## 2026-06-12：SQLite 备份采用脚本方案 + 源健康历史表 + checker 互斥锁

**决策**：
1. SQLite 备份/恢复用 shell 脚本实现，不引入外部队列或 cron 容器。
2. 新增 `SourceHealthLog` 表记录每次源检查结果，保留最近 24 小时统计。
3. `runGamePulseCheck` 增加内存互斥锁，未完成时跳过下一次触发。

**原因**：
- 备份脚本简单可靠，`sqlite3 .backup` 保证热备一致性，无需额外依赖。
- 源健康历史让运维可见"哪个源在什么时候失败、失败率多少"，而不只是当前状态。
- 定时任务互斥防止采集重叠导致重复数据或资源竞争，社区刷新已有类似 `fetchPromise` 模式。

**影响**：
- 部署后需要执行 Prisma schema 同步，确保 `SourceHealthLog` 表存在。
- 备份脚本可配合 crontab 实现定时备份。
- `/api/health` 接口现在包含 `checker.running` 状态。
- 新增 `/api/public/source-health-history` 接口提供健康历史统计。

## 2026-06-12：AI 分析队列先基于 Prisma/SQLite 持久化

**决策**：AI 分析队列从进程内数组迁移为 `AnalysisTask` 数据库任务表，先保留单进程 worker 和 5 秒节流，不引入 Redis/BullMQ 等外部队列。

**原因**：

- 当前部署以 SQLite/Prisma 为主，新增外部队列会显著增加部署和运维复杂度。
- 分析任务的核心痛点是重启丢任务、失败不可见和不可重试，数据库任务表已经能覆盖短期稳定性目标。
- `Analysis` 表继续表示对 feed item 的分析结果；`AnalysisTask` 只负责调度、重试、错误和耗时等运行态信息，避免改变公开 feed item/analysis API 行为。

**影响**：

- 新内容写入后创建 `pending` 任务，由后台 worker 消费并写回 `Analysis`。
- 服务启动时会把遗留 `running` 任务恢复为 `pending`，避免进程退出后卡死。
- 管理端可查看队列统计、最近任务和失败原因，并可手动重试单个或全部失败任务。
- 部署升级需要执行 Prisma schema 同步命令，确保 SQLite 中存在 `AnalysisTask` 表。

## 2026-06-12：项目级 Agent 协作规则放入 `docs/`

**决策**：项目级协作规则、路线图、踩坑记录和架构决策统一放在 `docs/` 下并进入 Git。根目录 `CLAUDE.md`、`AGENTS.md` 和 `.claude/` 保留为本地工具配置或个人偏好。

**原因**：

- `.claude/` 可能包含本地权限和工具状态，不适合作为共享事实来源。
- 根目录 `CLAUDE.md`、`AGENTS.md` 已被忽略，适合本地覆盖，不适合作为团队规范。
- `docs/` 已有部署、路线图和踩坑记录，适合成为跨 Agent 接力入口。

**影响**：

- 新 Agent 进入项目时优先读取 `README.md`、`docs/AGENT_WORKFLOW.md`、`docs/ROADMAP.md`、`docs/LESSONS.md`。
- 重大协作规则变化更新本文档。

## 2026-06-11：第一阶段先做基础治理

**决策**：在继续做性能和产品能力前，先完成 UTF-8 约定、Zod 输入校验、测试范围收敛和路线图沉淀。

**原因**：

- 项目已进入可部署阶段，主要风险从“能否跑通”转为“是否稳定、可维护、可接力”。
- 输入边界、测试重复执行和文档分散会放大后续 Agent 协作成本。

**影响**：

- 管理端写接口和公开查询接口优先使用 `server/src/gamepulse/validation.ts`。
- 测试只运行 `src/**/*.test.ts`，避免构建产物重复执行。
- 第二阶段集中处理性能、队列持久化、运维可观测性。

## 2026-06-09：AI 分类必须有代码层兜底

**决策**：AI 分类结果不能只依赖 prompt，必须在代码层做边界修正和 fallback。

**原因**：

- 不同 provider 的输出稳定性不同。
- 官方源和关注投稿存在明确分类边界，AI 可能跨组输出。

**影响**：

- `ensureAnalysis` 保留分类后处理。
- provider 接入必须验证 JSON 解析、超时、重试和 fallback。
