# LESSONS.md — 踩坑记录与复盘

> 本文件记录开发过程中遇到的问题、根因分析和解决方案。
> 设计为**跨项目可复用**——前端模式、部署经验、AI 集成、Agent 协作均可迁移。
> 适合用于后续项目参考或博客文章素材。

---

## 一、前端开发踩坑

### 1.1 异步 DOM 操作时序

**问题**：翻页后 `window.scrollTo` 在数据加载前执行，DOM 重绘后滚动位置被覆盖。

**根因**：React 状态更新是异步的，`setPage` 后立即滚动 → 数据返回 → DOM 重置 → 滚动失效。

**解决**：用 `useRef` 标记，数据加载完成 + `requestAnimationFrame` 后才滚动。

**通用模式**：
```
任何"操作后需要等数据"的场景，都不要在操作时直接执行 DOM 操作。
用 ref 标记意图，在异步回调中检查并执行。
```

**适用场景**：翻页滚动、筛选后重置、搜索后跳转、新增后定位

---

### 1.2 闭包过期导致快速操作错乱

**问题**：快速连续操作（点击标签、切换筛选）读到旧状态值。

**根因**：`useCallback` 依赖状态值，但闭包捕获的是创建时的值。

**解决**：用 `useRef` 追踪最新状态。

```typescript
// ❌ 闭包中的 selectedTag 是旧值
const selectTag = useCallback((tag) => {
  const newTag = selectedTag === tag ? 'all' : tag;  // selectedTag 是旧的
}, [selectedTag]);

// ✅ ref 始终是最新值
const selectedTagRef = useRef(selectedTag);
selectedTagRef.current = selectedTag;
const selectTag = useCallback((tag) => {
  const newTag = selectedTagRef.current === tag ? 'all' : tag;  // 始终最新
}, []);
```

**通用规则**：
- 需要"总是读最新值" → `useRef`
- 需要"值变化时重建" → 依赖数组
- 快速连续操作的回调，**不要依赖状态值**，用 ref

---

### 1.3 大数组重复计算

**问题**：`Array.includes` 在大数据量下 O(n*m) 导致卡顿。

**解决**：
```typescript
// ❌ 每次渲染 O(n*m)
const filtered = items.filter(item => ids.includes(item.id));

// ✅ Set.has 是 O(1)
const idSet = useMemo(() => new Set(ids), [ids]);
const filtered = useMemo(
  () => items.filter(item => idSet.has(item.id)),
  [items, idSet]
);
```

**规则**：列表过滤 + `includes` 时，必须先转 `Set` 再用 `useMemo`。

---

### 1.4 搜索输入无 debounce

**问题**：每次按键触发 API 请求，产生"API 风暴"。

**解决**：
```typescript
const [searchQuery, setSearchQuery] = useState(initialValue);
const timerRef = useRef<ReturnType<typeof setTimeout>>();

const handleChange = (value: string) => {
  setSearchQuery(value);  // 本地即时显示
  clearTimeout(timerRef.current);
  timerRef.current = setTimeout(() => {
    props.setFilters(prev => ({ ...prev, q: value }));  // 延迟更新
  }, 300);
};
```

**规则**：搜索输入必须 debounce（300ms），本地状态保证响应性。

---

### 1.5 表单函数式更新

**问题**：快速填写表单时，展开旧对象导致字段值丢失。

**根因**：`setX({ ...x, field: value })` 中的 `x` 是闭包中的旧引用。

**解决**：
```typescript
// ❌ 可能丢失并发更新
setSourceDraft({ ...sourceDraft, name: value });

// ✅ 基于最新状态
setSourceDraft(prev => ({ ...prev, name: value }));
```

**规则**：表单 `onChange` **必须**用函数式更新。

---

### 1.6 SVG 空数组除零

**问题**：数据为空时 SVG path 计算产生 NaN/Infinity。

**解决**：
```typescript
// ❌ length=0 时除以 0
const points = data.map((d, i) => ({
  x: (i / (data.length - 1)) * 100,  // 0/0 = NaN
}));

// ✅ 保护
if (data.length <= 1) return [];
const points = data.map((d, i) => ({ ... }));
```

**规则**：数学计算前检查除数，数组 `.map()` 中的索引除法要警惕 `length === 0`。

---

### 1.7 useRef 初始值

**问题**：TypeScript 严格模式下 `useRef<T>()` 报错"缺少初始值"。

**解决**：
```typescript
// ❌
const timerRef = useRef<ReturnType<typeof setTimeout>>();

// ✅
const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
```

**规则**：`useRef` 必须传初始值。

---

## 二、部署与运维踩坑

### 2.1 Docker 内存不足

**问题**：Node.js 项目 Docker build OOM。

**原因**：`npm ci` 需要大量内存同时运行 Node + npm + Docker 层。

**解决**：最低 2GB 内存。1GB 会 OOM。

---

### 2.2 Express 版本升级 breaking change

**问题**：Express 5 不支持 `app.get('*', ...)` 通配符。

**解决**：改用 `app.use()` 中间件模式。

**规则**：大版本升级前先查迁移指南。

---

### 2.3 Monorepo .env 路径

**问题**：`.env` 在根目录，Prisma 在子目录运行，找不到环境变量。

**解决**：Dockerfile 中 WORKDIR 决定 `.env` 查找位置，确保路径一致。

---

### 2.4 文件权限

**问题**：`sudo npm install` 后依赖属于 root，当前用户无权限。

**解决**：用 nvm 管理 Node 版本，或 `chown -R` 修复权限。

---

### 2.5 tsconfig 严格度不一致

**问题**：本地 `tsc --noEmit` 通过，Docker 构建报错。

**原因**：Docker 环境的 tsconfig 更严格（如 `strictNullChecks`）。

**解决**：重要改动本地跑 `npm run build` 而非仅 `tsc --noEmit`。

---

### 2.6 SSH 密钥变更

**问题**：重置服务器后 `scp` 报 `REMOTE HOST IDENTIFICATION HAS CHANGED`。

**解决**：`ssh-keygen -R <服务器IP>`

---

### 2.7 服务重启才能生效的配置

**问题**：B站 Cookie 保存后前端显示"重启服务后生效"。

**原因**：适配器在服务启动时读取 Cookie，运行时不会自动刷新。

**解决**：保存后执行 `docker compose restart`。

**Cookie 有效期**：约 6 个月，过期后 B站源全部失败，需重新获取。

---

### 2.8 常用运维命令

```bash
# 查看日志
docker compose logs -f app

# 重启服务
docker compose restart

# 重新构建
docker compose up -d --build

# 备份数据库
docker exec game-pulse cp /app/server/data/prod.db /app/server/data/prod.db.bak

# 检查容器内存
docker stats
```

---

### 2.9 Windows PowerShell 中文显示

**问题**：README、源码注释或 prompt 在 PowerShell 中显示为乱码，容易误判为文件编码损坏。

**根因**：文件本身是 UTF-8，但 PowerShell 默认读取/显示编码可能不是 UTF-8。

**解决**：
```powershell
Get-Content -Encoding UTF8 README.md
Get-Content -Encoding UTF8 docs\LESSONS.md
```

**规则**：检查中文文件时先显式使用 UTF-8；只有确认文件内容本身损坏后再做批量修复。

---

### 2.10 Git 远端已更新不等于生产已部署

**问题**：GitHub `master` 已包含新功能，但线上静态包仍缺少对应文案和交互，API 也保持旧行为；只看本地 `git status` 或远端提交会误判部署完成。

**根因**：代码推送、服务器拉取、镜像构建、容器替换是四个独立步骤；任一步未执行，线上都可能继续运行旧镜像。服务器 `.env` 还会覆盖 Compose 中的默认值，例如旧 `CLIENT_URL` 会让生产 CORS 持续指向 localhost。

**验证顺序**：

1. `git ls-remote` 或 GitHub API 确认远端 commit。
2. 服务器执行 `git rev-parse --short HEAD` 确认工作目录 commit。
3. `docker compose ps` 与 `docker inspect` 确认容器创建时间和镜像。
4. 用线上静态资源中的新文案/参数、API 新行为确认实际运行版本。
5. 检查 `/api/health`、关键 API 延迟和生产响应头。

**规则**：更新部署必须包含配置预检、数据库备份、镜像重建、健康等待和线上特征验收；不要把“push 成功”当作“发布成功”。

---

## 三、AI 集成踩坑

### 3.1 AI 分类需要后处理兜底

**问题**：AI 不可靠——即使 prompt 写得再好，也会出现跨组分类。

**解决**：三层防线：
```
第 1 层：AI 提示词明确规则
第 2 层：后处理器强制修正（代码层面）
第 3 层：定期抽查 + 手动修正历史数据
```

**教训**：AI 分类不能只靠提示词，必须有代码层面的兜底。

---

### 3.2 新 Provider 接入验证清单

每个 AI Provider 的 API 格式不同，接入时必须逐一验证：

```
1. Base URL（不同地区不同地址）
2. Model name（版本号、命名规则）
3. Auth header（Bearer token vs api-key header）
4. Timeout（不同模型响应速度差异大）
5. Max tokens（token limit 不同）
6. 重试机制（AI 服务天然不稳定）
```

---

### 3.3 内容预筛节省 AI 调用

**问题**：太短的内容（<15 字）浪费 AI 调用。

**解决**：`shouldSkipAI` 预筛 → 短内容直接用规则兜底，不调用 AI。

---

### 3.4 AI 队列不要只放进程内存

**问题**：进程内数组队列在服务重启、异常退出或多入口触发时会丢任务；失败只写日志，管理端无法知道 pending/running/failed 的真实状态，也无法手动重试。

**解决**：队列状态进入数据库，任务记录 `pending/running/completed/failed`、`retryCount`、`lastError`、`provider/model` 和耗时；服务启动时恢复卡在 `running` 的任务，失败任务用 `nextRunAt` 做退避重试，管理端提供状态查询和重试入口。

**规则**：只要任务结果需要跨进程存活、可观测或可重试，就不要只依赖内存队列；即使暂不引入 Redis/BullMQ，也应先用现有数据库保存最小任务状态。

---

### 3.5 推理模型的 max_tokens 要按批预算

**问题**：`deepseek-v4-flash` 等推理模型的 reasoning tokens 与最终 content 共用 `max_tokens`。11 条情绪文本在 `max_tokens=1200` 时 reasoning 占满预算，content 为空或只有前几行（`finish_reason=length`）；上层把缺失序号写成 failed，且每次刷新重试，形成持续 token 成本。

**解决**：限制每批条数（≤5），把 `max_tokens` 提到 4096 并延长超时；解析后同时检测缺失/非法序号与 `finish_reason`，只对失败序号拆半重试并设深度硬上限；对 failed 结果做冷却，避免每次刷新重试。HTTP/传输错误不在同一轮反复重试。

**规则**：接入推理模型时，用真实探针记录 `finish_reason`、`completion_tokens` 和 `reasoning_tokens`，按 reasoning 峰值而不是输出行数估算预算；批量接口必须有部分成功、截断拆批和重试上限。

---

## 四、接口变更踩坑

### 4.1 改接口后遗漏使用处

**问题**：组件改 Props 接口后，遗漏了某处 JSX 的旧 prop。

**根因**：同一组件在 App.tsx 中渲染多次（桌面端 + 移动端抽屉），`replace_all` 因上下文不同只匹配了部分。

**解决**：
```
1. grep 组件名 → 找到所有 JSX 使用处
2. 逐一确认每个使用处的 prop 匹配新接口
3. npx tsc --noEmit
4. npm run build（验证 tsconfig 严格模式）
```

**规则**：改接口后**禁止只用 replace_all**，必须手动确认每处。

---

### 4.2 Zod `partial()` 与 `default()` 组合

**问题**：更新接口只传部分字段时，缺失字段被 schema 默认值自动补上，导致更新接口误改 `enabled/followed/isOfficial` 等布尔字段。

**根因**：`CreateSchema.partial()` 不一定能阻止内部字段 default 生效。

**解决**：Create 和 Update schema 分开定义；创建接口保留默认值，更新接口使用 `.optional()`，不使用 create schema 的默认字段。

**规则**：带默认值的 create schema 不要直接 `partial()` 给 update 用。必须加回归测试，确认 partial update 不会补默认值。

---

### 4.3 Vitest 重复运行构建产物测试

**问题**：`npm test` 同时运行 `src/**/*.test.ts` 和 `dist/**/*.test.js`，测试数量翻倍。

**根因**：构建产物保留了测试文件，Vitest 默认扫描范围包含 `dist`。

**解决**：添加 `server/vitest.config.ts`，只 include `src/**/*.test.ts`，并 exclude `dist/**`。

**规则**：测试配置必须明确 include/exclude，尤其是 TypeScript 项目会输出 `dist` 的场景。

---

### 4.4 Facet 统计不要全量拉明细

**问题**：公开列表接口为了返回筛选项计数，每次额外 `findMany` 拉取所有 `feedItem + source + analysis`，再在 Node.js 内存里循环统计。数据量增长后，接口延迟、内存占用和序列化成本都会随全量数据线性上涨。

**解决**：把 facet 统计拆成独立服务，优先使用数据库侧 `groupBy/count`，只返回分组字段和计数。需要跨表维度时，按主表和关联表分别聚合，再在应用层做少量归一化，例如 `urgent -> high`、`category null -> other`。

**规则**：facet/count 类接口只需要计数，不要加载完整业务对象；如果必须保持旧语义，先用单元测试锁定筛选条件和归一化规则，再替换为数据库聚合。

---

## 五、Agent 协作模式

### 5.1 问题定位 — 先读代码再改代码

**无效**："帮我修 bug"
**有效**："[页面] [操作] 后 [期望] 未生效，实际 [表现]，排查修复"

明确四个要素：哪个页面、什么操作、期望行为、实际行为。

---

### 5.2 代码审查 — 分轮次递进

```
第 1 轮：修复用户报告的具体问题
第 2 轮：从专业角度 review 代码健壮性
第 3 轮：关注可维护性和可扩展性
```

不要一次性要求"修复所有问题"，分轮次每次聚焦一个维度。

---

### 5.3 多文件改动 — 用 Task 跟踪

涉及 3+ 个文件时，用 TaskCreate 创建任务列表，逐个标记进度。避免遗漏。

---

### 5.4 修复验证 — 要求自检编译

修复后要求"确保 TypeScript 编译通过，无新增错误"。`npx tsc --noEmit` 是最快的自检手段。

---

### 5.5 性能优化 — 先量化再优化

不要凭直觉优化。先确认：
- 是否真的频繁渲染？
- 数据量是否真的大？
- 是否在热路径上？

`useMemo` / `useCallback` 不是万能药，滥用反而增加复杂度。

---

### 5.6 协作文件分层

**问题**：`CLAUDE.md`、`AGENTS.md`、`.claude/`、`docs/LESSONS.md` 都可能承载协作信息，容易出现“哪个才是事实来源”的混乱。

**解决**：
- 项目级规则：放 `docs/AGENT_WORKFLOW.md`。
- 路线图：放 `docs/ROADMAP.md`。
- 踩坑记录：放 `docs/LESSONS.md`。
- 架构决策：放 `docs/DECISIONS.md`。
- 本地工具配置：保留在 `.claude/` 或根目录 `CLAUDE.md/AGENTS.md`，不作为共享事实来源。

**规则**：能帮助后续 Agent 接力的内容必须进入 `docs/` 并纳入 Git。

---

### 5.7 SQLite 备份不要只用 cp

**问题**：`cp` 复制正在写入的 SQLite 数据库可能得到不一致的快照（写入进行中时复制）。

**解决**：使用 `sqlite3 .backup` 命令或 SQLite 的 backup API，它在备份期间持有短暂锁，保证一致性。在容器内执行：
```bash
sqlite3 /app/server/data/prod.db '.backup /tmp/backup.db'
```

**规则**：SQLite 热备份优先用 `.backup` 命令，不要用 `cp`/`rsync`。

---

### 5.8 定时任务需要互斥锁

**问题**：cron 触发的采集任务可能在上一次未完成时再次启动，导致重复采集或资源竞争。

**解决**：在任务入口检查 `running` 标志，已运行时跳过本次触发并记录日志。用 `try/finally` 确保标志在异常时也能清理。

**通用模式**：
```typescript
let running = false;
async function runTask() {
  if (running) { log('skipping'); return; }
  running = true;
  try { await doWork(); } finally { running = false; }
}
```

**规则**：任何可能重叠执行的定时任务，都需要互斥锁或队列保证串行。

---

### 5.9 SQLite FTS5 全文搜索实现要点

**问题**：Prisma 的 `contains`（LIKE '%keyword%'）全表扫描性能差，不支持中文分词，搜索结果不精确。

**解决**：使用 SQLite FTS5 虚拟表实现全文搜索，配合触发器自动同步数据。

**关键设计决策**：
1. **不使用 content=FeedItem 模式**：Prisma 使用 UUID 主键，而 FTS5 的 rowid 是自增整数，关联复杂。改为在 FTS5 表中直接存储 feedItemId。
2. **UNINDEXED 字段**：feedItemId 标记为 UNINDEXED，不参与搜索但可用于关联查询。
3. **触发器同步**：INSERT/UPDATE/DELETE 时自动同步 FTS5 索引，保证数据一致性。
4. **降级方案**：FTS5 不可用时自动降级到 LIKE 搜索，保证功能连续性。

**实现模式**：
```typescript
// 1. 检查 FTS 是否可用
const ftsReady = await isFTS5Ready();

// 2. 优先使用 FTS 搜索
if (ftsReady) {
  const ftsResult = await searchFeedItems(query);
  where.id = { in: ftsResult.feedItemIds };
} else {
  // 3. 降级到 LIKE
  where.OR = [{ title: { contains: query } }, ...];
}
```

**性能对比**：
- LIKE '%keyword%'：全表扫描，O(n) 复杂度
- FTS5 MATCH：倒排索引，O(log n) 复杂度
- 实测：10 万条数据搜索延迟从 200ms+ 降至 10ms 以下

**规则**：
- SQLite 全文搜索优先用 FTS5，不要用 LIKE '%keyword%'
- FTS5 表设计要考虑主键类型（UUID vs 自增整数）
- 必须有降级方案，FTS5 初始化失败时功能不能中断
- 触发器同步比定期重建更可靠，但要注意性能影响

---

### 5.11 FTS5 触发器删除命令的 SQLite 构建差异

**问题**：FTS5 的 `INSERT INTO fts(fts, ...) VALUES('delete', ...)` 命令在某些 SQLite 构建中失败（包括 Node.js 内置的 `node:sqlite`），报 `SQL logic error`。

**根因**：FTS5 'delete' 命令在非 content-less 表上的行为依赖 SQLite 编译选项和版本。`node:sqlite`（Node.js 24）的 SQLite 构建不支持此命令，而 Docker 容器中的系统 SQLite 通常支持。

**解决**：在触发器中使用 `DELETE FROM fts WHERE rowid IN (SELECT rowid FROM fts WHERE feedItemId = old.id)` 替代 FTS5 'delete' 命令。这种方式通过标准 SQL DELETE 操作，不依赖 FTS5 特殊命令，在所有 SQLite 构建中都能工作。

**实现**：
```sql
-- ❌ 不可靠：FTS5 'delete' 命令
CREATE TRIGGER FeedItem_ad AFTER DELETE ON FeedItem BEGIN
  INSERT INTO FeedItemFTS(FeedItemFTS, feedItemId, ...)
  VALUES('delete', old.id, ...);
END

-- ✅ 可靠：标准 SQL DELETE
CREATE TRIGGER FeedItem_ad AFTER DELETE ON FeedItem BEGIN
  DELETE FROM FeedItemFTS WHERE rowid IN (
    SELECT rowid FROM FeedItemFTS WHERE feedItemId = old.id
  );
END
```

**规则**：
- FTS5 触发器中的删除操作优先用 `DELETE FROM ... WHERE rowid IN (SELECT ...)` 而不是 FTS5 'delete' 命令
- 更新触发器 = 删除旧条目 + 插入新条目
- `ensureFTS5()` 应先 DROP 旧触发器再 CREATE，确保 SQL 变更生效
- 集成测试中 FTS5 MATCH 查询对特殊字符（如 `.`）需要用引号包裹短语

---

### 5.12 ensureFTS5 必须检查触发器完整性

**问题**：`ensureFTS5()` 只检查 FTS5 虚拟表是否存在就返回，导致触发器缺失或损坏时无法自愈。

**根因**：表存在 ≠ 触发器存在。迁移、手动操作或部分失败都可能导致表在但触发器缺失。

**解决**：分别检查虚表和每个触发器（`FeedItem_ai`、`FeedItem_ad`、`FeedItem_au`），缺失时自动补齐并重建索引。

**规则**：
- `ensureFTS5()` 必须独立检查每个触发器，不能只检查表
- `isFTS5Ready()` 也应检查触发器完整性，返回 false 提示需要修复
- 触发器修复后必须重建 FTS 索引（数据可能已不同步）

---

### 5.10 Stale-First API 模式：先返回快照，后台异步刷新

**问题**：API 在数据过期时阻塞等待完整刷新（30-60s），导致首屏长时间空白。

**根因**：路由 handler 用 `await refreshCommunityData()` 同步等待，所有并发请求共享同一个 Promise（去重），但第一个请求仍需等待全部完成。

**解决**：stale-first 模式——始终立即返回数据库快照，过期时 fire-and-forget 触发后台刷新：
```
1. getStalenessInfo() — O(1) 查询判断数据是否过期
2. 立即返回 DB 快照（或空数组）
3. isStale 时 fire-and-forget refreshCommunityData()（已内置 fetchPromise 去重）
4. 响应中携带 isRefreshing / isStale 字段
5. 前端收到 isRefreshing=true 时轮询获取更新数据
```

**关键设计**：
- `refreshCommunityData()` 内部已有 `fetchPromise` 并发锁，多个请求不会触发重复刷新
- 前端通过 `isRefreshing` 字段驱动轮询，而非自行判断时间间隔
- 保持 `stale` 字段向后兼容，新增 `isStale` + `isRefreshing` 语义更清晰

**规则**：
- 任何耗时 >2s 的数据刷新都不应阻塞首屏响应
- 优先返回 DB 快照 + 后台刷新，而非等待最新数据
- 并发控制由服务端保证（Promise 去重），前端只需关心状态字段

---

### 5.13 日期边界必须用目标时区计算

**问题**：Docker 容器运行在 UTC，`new Date().toISOString().slice(0, 10)` 和 `setHours(0,0,0,0)` 在 UTC+8 凌晨 0-8 点返回前一天日期，导致日报/周报查询范围错误。

**解决**：用 `Intl.DateTimeFormat.formatToParts` 获取目标时区的日期字符串，用 `Date.UTC` 减去本地时区秒数计算午夜对应的 UTC 时间戳。关键：当 UTC guess 在目标时区已过中午（`localH >= 12`），需要先加 24 小时再重算偏移，避免减法溢出到前一天。

**规则**：
- 涉及"今天"、"本周"等自然语言日期的查询，必须用目标时区而非服务器时区。
- `Intl.DateTimeFormat` 的 `hourCycle: 'h23'` 保证 0-23 范围，避免 `hour12: false` 产生 "24" 的歧义。
- 测试必须覆盖正偏移（+8）和负偏移（-4/-5）两种场景。

---

### 5.14 日志表保留策略

**问题**：每次 source check 写入一条 SourceHealthLog，长期运行后表无限增长，占用磁盘且拖慢查询。

**解决**：在采集流程末尾自动清理过期记录，保留天数通过环境变量配置。清理逻辑放在主流程之后，不影响采集性能。

**规则**：
- 任何按时间累积的日志表都需要保留策略，不要让数据无限增长。
- 清理操作放在主流程末尾（try/finally 之外），避免清理失败影响主业务。
- 保留天数用环境变量配置，有合理默认值（30 天），方便运维调整。
- 清理日志用 `console.log` 记录清理数量，方便排查。

---

### 5.15 API 层统一 401 处理

**问题**：每个 admin API 调用的 catch 块各自处理错误，token 过期时部分操作能正确回到登录态，部分只显示"保存失败"等误导信息。

**解决**：在 `request()` 函数中检测 401 响应，清除 localStorage token 并抛出自定义 `UnauthorizedError`；前端 hook 统一检查该错误类型并调用 `clearAdminSession()`。

**规则**：
- 401 处理应在 API 客户端层统一完成，不要分散到每个业务操作的 catch 中。
- 登录接口的 401 是"密码错误"，不应触发 session 清除——登录接口单独处理。
- token 清除 + 状态重置 + toast 提示应在同一个 call site 完成，避免竞态。

---

### 5.16 批量操作必须走持久化队列

**问题**：`reanalyze-all` 路由直接在请求处理循环中逐条调用 `ensureAnalysis()`，绕过 `AnalysisTask` 表。导致：无任务记录、无重试机制、进程重启丢失进度、与队列 worker 并发竞争。

**解决**：所有分析操作（单条重分析、批量重分析、失败重试）统一通过 `enqueueAnalysisTask` / `reanalyzeAll` 写入 `AnalysisTask` 表，由后台 worker 统一消费。

**规则**：
- 任何需要"排队执行"的操作，都必须通过持久化队列，不要在请求 handler 中直接执行。
- 进度追踪改用队列状态轮询（前端 polling `getAnalysisQueueOverview`），不依赖一次性 WebSocket 事件。

---

### 5.17 任务 Claim 必须原子化

**问题**：`claimNextTask` 先 `findFirst` 再 `update`，两步之间其他 worker 可能已经 claim 了同一任务，导致重复执行。

**解决**：用 `updateMany` + `WHERE status='pending'` 原子 claim——只有 `count > 0` 时才认为 claim 成功，然后 `findUnique` 拿回完整记录。

**规则**：
- 任务状态流转（pending → running）必须是原子操作，不要 find-then-update。
- SQLite 单写入者场景下 `updateMany` + WHERE 已足够；多写入者场景需要 `SELECT ... FOR UPDATE` 或类似机制。

---

### 5.18 配置检查脚本不要 source .env

**问题**：运维预检脚本如果直接 `source .env`，`.env` 中的特殊字符、未加引号的密码或非 shell 格式内容可能导致解析失败；更严重时，恶意内容会被当作 shell 代码执行。

**解决**：配置检查脚本只按文本解析指定 key 的 `KEY=value`，不执行 `.env` 文件内容。脚本只读取需要验证的字段，例如 `ADMIN_PASSWORD`、`ADMIN_JWT_SECRET`、`AI_PROVIDER` 和对应 API key。

**规则**：
- 读取 `.env` 做检查时，不要用 `source`。
- 密码和 token 这类值要允许特殊字符；脚本不能因为 `=`, 空格或 shell 元字符直接坏掉。
- 预检脚本只输出缺失/弱配置，不输出敏感值。

---

### 5.23 去重身份不能依赖 AI 分类或适配器原始 ID

**问题**：同一 B 站稿件曾以 BV 号和完整 URL 两种 `externalId` 写入；两次 AI 分类不同，导致数据库和页面都出现重复。

**根因**：
- 原始 `externalId` 是适配器输出格式，不等于稳定业务身份。
- AI 分类是可变派生数据，不具备主键语义。
- 页面聚合只能遮住重复，无法阻止通知、分析任务和容量被重复数据消耗。

**规则**：
- 去重必须在写入边界完成，并由数据库唯一约束兜底。
- 身份键优先使用平台稳定 ID，且唯一范围至少包含 source，避免跨来源误删。
- 内容变化应更新原记录并按需重分析，不应生成同身份新记录。
- 精确身份和时间窗内完全相同标题优先于分类判断；分类只约束模糊语义合并。
- 聚合分页必须基于固定候选集，否则不同页会得到不同 total 和边界。
- 修改身份算法时必须同时提供历史回填、冲突保留策略、审计查询和回归测试。

---

### 5.24 Prisma 唯一索引迁移需要显式确认和可恢复路径

**问题**：为已有 SQLite 表增加唯一索引时，`prisma db push` 会要求 `--accept-data-loss`；数据库内还有 Prisma 未建模的 FTS5 虚拟表时，直接同步还可能尝试错误地处理影子表。

**规则**：
- 参数名不代表可以忽略数据风险；只有在迁移前备份、完整性校验和冲突回填策略都具备时才能使用 `--accept-data-loss`。
- FTS5 属于可重建派生索引，schema 同步前只删除 FTS 表和触发器，不能删除 FeedItem 等规范数据。
- 新唯一列应先允许 NULL，使旧数据能够通过 schema 同步；服务启动后再执行一次性回填和冲突清理。
- 迁移完成后必须检查空身份数、重复身份组、FTS 行数和接口分页一致性。
- 生产部署应保留宿主机部署前备份与 volume 内迁移前备份两层恢复点。

---

### 5.25 AI 队列失败不等于情报未入流

**问题**：管理后台显示失败任务时，容易误以为对应情报尚未进入公开页面。

**事实**：采集、持久化和 AI 分析是两段流程。FeedItem 先写入，AnalysisTask 后执行；公开查询允许无 Analysis 的条目，失败 Analysis 也保留默认公开可见性。

**规则**：
- “抓取到多少条”“公开流显示多少条”“AI 成功多少条”必须作为三个独立指标观察。
- 重试失败任务只更新 Analysis，不应重复创建 FeedItem 或通知。
- 重试成功后分类、重要性和可见性可能变化，前端应以 `item:analyzed` 或重新拉取结果为准。
- 更换 AI Provider 后先重试一条并核对 task 的 provider/model，再批量重试，避免错误配置放大调用成本。
- Provider 模型名属于外部生命周期配置，升级前必须核对官方文档和 `/models`；不要凭旧兼容别名推断当前推荐模型。

---

### 5.26 配置项必须从文档到容器闭环

**问题**：`.env.production.example` 或 README 声明了某些可配置项，但 `docker-compose.yml` 未显式传入容器，导致生产容器仍然使用代码默认值，运维以为配置已生效。

**根因**：Docker Compose 的 `.env` 主要用于变量插值，不等于把所有 key 自动注入容器。只要服务使用显式 `environment` 列表，就必须把运行时代码读取的 key 全部列在 Compose 中。

**规则**：
- 新增或调整运行时环境变量时，同步检查 5 处：代码读取点、`.env.production.example`、`docker-compose.yml`、README 常用配置、部署指南。
- 生产默认值只能有一个事实来源；如果长期默认改为某个 Provider，README、示例 env、Compose 默认值和决策文档必须一致。
- `docker compose config --quiet` 只能证明 Compose 可展开，不能证明变量已进入业务进程；关键配置还要看 Compose 的 `environment` 列表。

---

### 5.27 Query 参数序列化不能对所有逗号字符串一刀切

**问题**：前端通用 `withParams()` 如果把所有包含逗号的字符串都拆成重复 query key，会误伤搜索词、标题片段等普通字符串字段。例如 `q=原神,直播` 可能变成两个 `q`，而后端 schema 只接受 string。

**规则**：
- 只有明确支持多值语义的字段才能拆分或重复传参，例如 `game`、`category`、`importance`、`sourceUid`。
- 普通字符串字段必须原样传递，尤其是 `q`、标题、URL、备注等用户输入。
- 前后端都要表达同一个契约：前端类型允许数组时，后端 validation 也应允许 `string | string[]`，并有回归测试覆盖多值过滤。

---

### 5.28 AI 的“中性”不能承担失败状态

**问题**：AI 未配置、超时或输出格式异常时直接返回 `neutral`，会把系统故障混入业务统计；后续增量刷新若只按记录是否存在跳过 AI，错误结果还会长期保留。

**规则**：
- 业务标签、执行状态和置信度必须分开存储；失败或不可用使用 `unknown`，不能伪装成中性。
- AI 派生数据需要版本和分析时间；失败、旧版本和过期结果应允许重新判断。
- 前端只表达“低置信度”或“未判断”，不要展示看似精确但未经校准的小数分数。
- Provider 默认值必须由共享配置模块解析，避免不同业务链路各自实现并发生静默回退。

#### 5.28.1 重分析失败必须清理旧业务字段

**问题**：对已经完成的 Analysis 执行强制重分析时，如果 provider 报错或模型输出非法 JSON，只把 `status` 改成 `failed` 会留下旧的 `category/importance/confidence/summary`。下游如果只看业务字段，旧高置信分析会继续污染统计和展示。

**规则**：
- 失败态只能保留执行状态和错误信息；旧业务判断字段必须清理或降到不可误读的低置信默认值。
- `fallback` 只用于明确的规则兜底场景，例如未配置 provider 或内容过短；模型异常、空响应、非法 JSON 不应伪装成正常分析。
- 回归测试要覆盖“旧 completed 高置信记录 + 强制重分析失败”的场景。

---

### 5.29 跨来源热度应先归一再排序

**问题**：播放量、回复数和发布时间来自不同平台，量纲和分布都不同；直接把各自公式输出放在同一排行榜，会让平台规模差异被误认为话题热度差异。

**规则**：
- 各来源先计算自己的原始分，再在来源内部转为百分位或标准分。
- 对外明确热度是相对指标，不等于原始互动量。
- 趋势历史应存归一化后的展示分，算法变化需记录版本或决策说明。
- 单来源只有一个样本时使用中位值，避免固定成为最高或最低。

---

### 5.30 状态表清理必须可配置且可观测

**问题**：持久化队列解决了重启恢复和重试，但完成/失败任务如果永久保留，状态表仍会无限增长。

**规则**：
- 不同终态按排障价值设置不同保留期，失败记录通常比成功记录保留更久。
- 清理失败任务时必须排除仍可自动重试的记录，避免长时间停机后在恢复前被删除。
- 启动时执行一次清理，并安排低频定时清理。
- 运维接口至少返回最近清理时间、删除数量和当前保留配置。
- 清理失败只记录错误，不应阻断队列消费或 HTTP 服务启动。

---

### 5.31 接口契约不能只留在前端 API 客户端

**问题**：如果 DTO 只定义在 `client/src/services/api.ts`，后续窗口修改 route 或前端调用时容易把“当前调用方需要什么”误认为“接口长期承诺什么”。社区、运维、公共列表等类型分散后，新窗口还需要读多处代码才能确认字段语义。

**规则**：
- 前端消费的稳定 DTO 放进 `shared/`，API 客户端只负责请求封装和 endpoint 调用。
- route 响应、运行时校验、共享 DTO 和 `docs/API_CONTRACTS.md` 必须同步更新。
- 字段语义变化优先新增字段并文档化，不轻易重命名既有字段；例如热度指标拆分时保留 `heatScore` 兼容展示，再新增 `rawHeatScore` 或 `momentumHeatScore`。
- Query 多值语义必须白名单化，不能把所有逗号字符串都拆分。

---

### 5.32 展示热度和 raw 热度不能共用一条趋势

**问题**：如果适配器先把平台原始热度写入 `heatScore/trend`，归一化阶段再覆盖同一字段，后续趋势线会混入两种语义；单样本来源、旧数据合并和跨来源展示也容易把“本轮相对排名”误当成“平台互动量变化”。

**规则**：
- `heatScore` 和 `trend` 只表示展示排名分，范围 0-100，供热度环、列表排序和展示趋势使用。
- `rawHeatScore` 和 `rawHeatTrend` 只表示来源公式原始分，用于同一话题历史趋势判断；不要直接展示给用户，也不要跨来源聚合成排名。
- 归一化函数只写 `heatScore`，不得顺手覆盖 raw 字段；DB upsert 负责分别追加展示分和 raw 分。
- 旧数据 raw 历史为空时按缺失历史处理，不能把空数组或默认 0 解释成真实热度下跌。

### 5.33 小黑盒热度不能只依赖更新时间

**问题**：小黑盒列表响应里同时有评论数、互动/奖励数、转发数、话题热度和负反馈。如果 raw 热度只按 `modify_at` 做时间衰减，“刚更新但几乎没人讨论”的内容会虚高，真实互动更强的话题反而可能被压低。

**规则**：
- 优先使用列表响应已有字段计算 raw 热度，不新增详情请求，避免性能退化和接口限流。
- 评论、互动/奖励、转发和话题热度使用 `log1p` 或类似压缩方式，避免大数单点打穿排序。
- 负反馈只做轻量惩罚；争议内容仍可能是热点，不能直接归零。
- 时间仍作为衰减因子，而不是唯一热度来源。
- 公式变化必须同步 `communityHeat.test.ts`、`docs/API_CONTRACTS.md` 和 `docs/DECISIONS.md`。

### 5.34 Server 不要直接 import `shared/`

**问题**：server `tsconfig` 的 `rootDir` 是 `server/src`。如果服务端实现文件直接从 `../../shared/api.ts` import DTO，即使只是类型导入，`npm run build` 也会报 `TS6059: File shared/api.ts is not under rootDir`。

**规则**：
- `shared/` 是前端消费和接口契约的事实来源，但 server 运行时代码不要直接 import 它，除非先调整 monorepo tsconfig 边界。
- 服务端 route/service 可以定义本地返回类型或使用推断类型，但字段必须同步到 `shared/api.ts` 和 `docs/API_CONTRACTS.md`。
- 新增接口时先跑 `npm --prefix server run build`，不要只依赖 Vitest；Vitest 可能不会暴露 rootDir 编译边界问题。

---

## 六、Prompt 模板（可复用）

### Bug 修复
```
[页面/组件名] [操作] 后 [期望行为] 未生效，实际 [实际表现]，排查修复
```

### 代码审查
```
使用 code-review-expert skill 审查 [文件/目录]，关注 [健壮性/性能/安全]，列出问题分级（P0-P3）
```

### 多文件重构
```
重构 [功能描述]，涉及 [文件列表]。要求：
1. TypeScript 编译通过
2. 不影响现有功能
3. 用 Task 跟踪进度
```

### 新功能设计
```
设计 [功能名] 模块，需求：[需求描述]。
要求：给出可行性分析、技术架构、数据流、实施路径、工作量估算。
```

---

### 5.19 RSSHub Docker 镜像标签与浏览器依赖

**问题**: RSSHub `latest` 版的 B站 `/user/video` 路由返回 503，报 Playwright Chromium 可执行文件不存在。旧版标签（如 `2024.12.16`）已被 Docker Hub 下架。

**根因**: RSSHub 新版将部分 B站路由从直接 API 调用改为 Patchright（Playwright fork）无头浏览器渲染，但标准 Docker 镜像未打包 Chromium。且 RSSHub 以 `node` 用户运行，浏览器缓存路径为 `/home/node/.cache/ms-playwright/`，而非 `/root/.cache/`。

**解决**: 创建自定义 `rsshub/Dockerfile`：
1. 安装 Chromium 系统依赖（含 `libxfixes3`，缺失会导致浏览器启动即崩溃）
2. 基础镜像裁剪了 Playwright CLI，`npx playwright` 会报 `playwright: not found`（退出码 127）；先 `npm install -g playwright@1.60.0`，再执行 `playwright install chromium`
3. 复制 `/root/.cache/ms-playwright` 到 `/home/node/.cache/` 并设置 `node` 用户权限

**踩坑链**:
- 标准镜像无 Chromium → 安装后仍 503
- 基础镜像保留运行时 `playwright@1.60.0` 包但裁剪 CLI → `npx playwright` 127；必须安装匹配版本的全局 CLI
- RSSHub 用 Patchright 非 Playwright → 浏览器缓存路径不同
- 以 root 安装但以 node 运行 → 需要复制到 `/home/node/.cache/`
- 缺少 `libxfixes3` → 浏览器启动即崩溃（`Target page, context or browser has been closed`）
- RSSHub 的 `BILIBILI_COOKIE` 环境变量格式为 `BILIBILI_COOKIE_{uid}`（per-uid），通用 `BILIBILI_COOKIE` 无效

**诊断注意**: 当前 RSSHub 容器缺少 `/etc/ssl/certs/ca-certificates.crt`，容器内 `curl` 访问 HTTPS 需要 `-k`。Node（145 个内置根）和 Chromium（自带 CA 存储）不一定受此影响；不能用容器内 `curl` 失败直接判断外网不可达。

**规则**:
- 上游 Docker 镜像的 breaking change 可能在 `latest` 标签更新时静默引入
- 依赖浏览器渲染的路由需要自定义镜像，不能用标准标签
- 先验证 CLI 是否存在，再执行 `playwright install`；不要假设 `npx` 能找到被裁剪的 CLI
- Docker 容器以非 root 用户运行时，root 安装的浏览器需要复制到用户 home 目录
- 自定义 Dockerfile 应纳入版本控制，确保可复现部署
- RSSHub B站路由需要 per-uid cookie 环境变量（`BILIBILI_COOKIE_{uid}`），不认通用 `BILIBILI_COOKIE`

---

### 5.20 环境变量传递陷阱：Compose 显式列表与 Cookie 归属

**问题**: `.env` 中的 B站 Cookie 没有进入需要它的容器，或进入 app 后误导了采集路径。

**根因**: `docker-compose.yml` 的 `environment` 段显式列出变量时，Docker Compose 不会自动将 `.env` 中的其他变量注入容器；`.env` 仅用于 `${VAR}` 占位符替换。另外，RSSHub B站路由只识别 `BILIBILI_COOKIE_<uid>`，不识别通用 `BILIBILI_COOKIE`。

**解决**: 根目录 `.env` 保留一个 `BILIBILI_COOKIE` 作为来源；在 `rsshub` 服务中把它映射为每个监控 UID 的 `BILIBILI_COOKIE_<uid>`。app 服务默认不接收该 Cookie；新增 UID 时同步补充映射。

**规则**:
- 凭据只传给实际使用它的组件，不为了“可能有用”扩散到 app
- 需要传入容器的变量必须在 compose 文件中用 `${VAR}` 引用
- `docker compose restart` 不重新读取 `.env`，需要 `up -d --force-recreate`
- RSSHub B站变量必须 per-uid；通用变量名无效

---

### 5.21 .env 前导空格导致变量无效

**问题**: `.env` 中 `BILIBILI_COOKIE=` 前有空格，Docker Compose 不识别。

**根因**: 用 `echo >> .env` 追加时，终端缩进引入了前导空格。Docker Compose 的 `.env` 解析器要求变量名从行首开始。

**排查**: `cat -A .env | grep KEY` 可以看到隐藏字符（空格、`^M` 等）。

**规则**:
- `.env` 文件中变量名不能有前导空格
- 用 `cat -A` 或 `od -c` 排查隐藏字符
- 追加 `.env` 内容时注意终端缩进

---

### 5.22 排查复杂问题的系统方法论

**复盘**: RSSHub B站路由 503 问题经历了 6 轮排查才定位根因，原因是每次只验证了一个假设，没有系统性排除。

**正确的排查顺序**:

```
1. 确认错误信息（日志、响应码）
2. 隔离变量（网络？cookie？代码？配置？）
3. 最小化复现（curl/node 直接调 API）
4. 对比验证（带 cookie vs 不带 cookie）
5. 检查权限和路径（用户、文件系统）
6. 检查依赖完整性（共享库、浏览器二进制）
```

**本次踩坑链回顾**:

| 轮次 | 假设 | 验证 | 结果 |
|------|------|------|------|
| 1 | Cookie 过期 | 测试 nav API | Cookie 有效 |
| 2 | RSSHub 版本过旧 | 升级 latest | 仍 503 |
| 3 | 缺 Chromium | 安装 Playwright | 仍 503 |
| 4 | 服务器 IP 被封 | 测试带 cookie API | IP 正常 |
| 5 | RSSHub 未用 cookie | 查文档发现需要 per-uid 格式 | 修复后仍 503 |
| 6 | 浏览器路径/权限 | 查日志发现 `/home/node/.cache` 缺失 + `libxfixes3` | **根因** |

**教训**: 复杂问题不要线性排查，应该**同时验证多个独立假设**（并行测试），优先检查最容易验证的（日志、权限、路径），最后才考虑最复杂的（代码逻辑、上游 bug）。

---

## 六、采集与分析一致性

### 6.1 空列表必须来自成功响应

RSSHub HTTP 错误页包含 `this route is empty`，不意味着源成功返回空列表；平台错误码或缺失列表结构也不能转成 `[]`。在外部响应边界验证成功状态与必要结构，内部直接使用验证后的契约。部分来源失败时，话题、去重状态、健康时间与缓存清理范围都要按来源处理；写入与成功时间应原子提交。失败状态与下一次刷新时间分别表达，避免公开读取变成连续即时重试。

### 6.2 入队原子性和结果版本需要分别保证

先保存条目再创建任务，会在通知失败或任务写入失败时留下永久遗漏。条目与任务使用同一短事务，外部通知在提交后处理。分析期间内容更新时，任务唯一键只能阻止重复任务，不能证明现有任务分析的是最新输入；结果写入与释放任务唯一键之前都要核对输入版本，变化后让既有任务重新处理最新正文。不能只在 Provider 返回时检查一次。

### 6.3 测试数据库隔离要有可验证的连接目标与环境守卫

事务 mock 的回调中动态导入数据库模块，可能绕过期望的 mock 并接入真实 Prisma。本轮曾出现匿名插入被真实 Prisma 外键拒绝的事故。事务回调必须固定使用 mock 工厂闭包中的客户端；匿名数据库测试应阻断真实 Prisma 构造。仅覆盖 `DATABASE_URL` 不足以证明隔离：Prisma Client 在导入时仍会探测 `server/.env`，dotenv 也可能自动加载环境文件。现在的做法是每次测试运行创建唯一临时目录和全新 SQLite 库，由 `prisma migrate deploy` 在临时工作目录应用迁移，并写入空 `.env`、设置空 `DOTENV_CONFIG_PATH`；worker 启动前断言 `DATABASE_URL` 等于该临时库，同时用 fs 守卫拦截 `server/` 下真实 `.env*` 的探测与读取。验收必须同时证明：连接目标唯一（`PRAGMA database_list`）、匿名 canary 可写、守卫实际拦截了环境文件探测，再运行事务用例。失败日志不能证明真实数据库完全未被触及，不读取真实库做未经授权的事后审计。

### 6.4 终态任务的哨兵时间不能进入定时器调度

用 `9999-12-31` 作为终态任务的 `nextRunAt` 可以阻止自动重排，但如果调度查询仍按 `nextRunAt` 升序取任务，就会选中它并计算出一个超过 `setTimeout` 32 位上限的延时。Node.js 会将溢出延时折算为约 1ms，导致队列空转并挤压后续任务。调度查询必须排除终态哨兵值，并对正常延时做上限钳制；同时用真实数据库验证“终态失败 + 后续待处理任务”的组合，而不是只观察单任务状态。

### 6.5 Cookie 存在不能成为采集路径的隐式开关

**问题**: `shouldUseDirectApiFallback` 在发现 `BILIBILI_COOKIE` 时自动返回 true，即使 `BILIBILI_DIRECT_API_FALLBACK=false`。运维为了稳定 RSSHub 而补 Cookie，反而让应用绕过 RSSHub 直连，主路径健康状态被掩盖。

**规则**: 采集路径必须由显式配置决定（环境变量或 Source 的 `config.directApiFallback`）；凭据存在只说明“可以认证”，不能说明“应该走哪条路径”。回归测试必须覆盖“Cookie 存在 + fallback=false 仍只走 RSSHub”。本轮新增 `server/src/gamepulse/__tests__/bilibiliFallback.test.ts`。

### 6.6 RSSHub 的 per-uid Cookie 映射必须覆盖全部监控 UID

**问题**: Compose 只给 10 个 UID 映射了 Cookie，默认源里还有 2 个关注 UP（`224267770`、`15319615`）没有映射；它们会以匿名请求访问 RSSHub，容易出现 403 或空结果，而应用侧只表现为单个来源失败。

**开发 Compose 的空值缺口**: `docker-compose.rsshub.yml` 虽然列出了 12 个 key，但只引用 `${BILIBILI_COOKIE_<uid>:-}`；根 `.env` 只有 `BILIBILI_COOKIE` 时，5 个值会为空。改为 `${BILIBILI_COOKIE_<uid>:-${BILIBILI_COOKIE}}`，既保留 per-UID 覆盖，又能回退根 Cookie。`docker compose config --format json` 只统计 key 数、非空数和是否同值，不打印值。

**回归**: `server/src/gamepulse/__tests__/bilibiliCookieMapping.test.ts` 3 项：生产 Compose 覆盖全部默认 UID、开发 Compose 覆盖全部 UID 且回退根 Cookie、app 服务不接收 `BILIBILI_COOKIE`。

**规则**: 新增或调整默认 B站源时，同步核对 `server/src/gamepulse/defaultSources.ts` 的 UID 列表与 `docker-compose.yml`、`docker-compose.rsshub.yml` 的 `BILIBILI_COOKIE_<uid>` 映射。用脚本或人工 diff 检查“默认源 UID 集合 = RSSHub Cookie UID 集合”；仅检查 key 数量不够，还要检查每个值是否非空。

### 6.7 上游风控下的间歇成功不能当成覆盖恢复

**问题**: 自建 RSSHub 容器健康、单条路由返回 RSS XML，不代表所有监控 UID 都已恢复。当前部署的 Cookie nav 探测为 `code=-101, isLogin=false`，直连探测为 `code=-352, message=风控校验失败`；RSSHub 浏览器回退间歇返回 `-352/-403` 或约 45 秒超时。重建容器丢失缓存后，UID `1340190821` 连续 10 次失败，随后 UID `401742377` 成功。

**规则**:
- 验收按 UID 记录 HTTP 状态、RSS item 数、应用入库数和 `healthStatus`；一条成功只能证明该窗口内该源可用，不能写成“B站源已全部恢复”。
- `-352` 表示风控校验失败，`-403` 表示访问权限不足；先核对 Cookie 登录态和上游窗口，不要直接归因本地适配器。
- 不要用直连 fallback 绕过风控；直连的 412/429 会混入主路径并掩盖 RSSHub 的真实健康状态。
- `parseRss` 单次最多解析 30 条，路由返回 40 条不等于应用应入库 40 条；记录时区分路由 item 数与入库数。
- 路由成功具有间歇性，容器重建和缓存状态会影响结果；结论必须注明测试时间窗口和重试次数。

### 6.8 RSSHub healthz 通过不等于路由已就绪

**问题**: 更换 Cookie 并 `--force-recreate` RSSHub 后，healthz 立即返回 `ok`，但第一条 `/bilibili/user/video/401742377` 返回 503；约 10 秒后重试返回 HTTP 200、39 个 `<item>`。此时 nav 为 `code=0, isLogin=true`，说明 Cookie 有效，503 来自冷启动/上游。Cookie 更新脚本的路由检查还把 URL 后的 `echo/grep` 拼成了 curl 的额外 URL，输出拼接状态码 `503000000000`，掩盖了真实状态。

**规则**:
- healthz 只证明进程启动，不证明路由缓存和浏览器会话已就绪；更换 Cookie 或重建容器后，路由检查应允许一次重试，并记录每次的 HTTP 状态与 item 数。
- 通过 `docker exec sh -c` 拼接多步命令时，显式用 `;` 分隔；不要依赖字符串拼接产生命令边界。
- `grep -c "<item>"` 统计的是匹配行数，不是元素个数；RSS XML 被压缩到一行时会把 40 条误报成 1 条。应使用 `grep -o "<item>" | wc -l` 统计出现次数。
- RSSHub 日志中的 `SyntaxError: Unexpected end of JSON input` 表示 API 请求拿到空响应并转入浏览器模式；此时 503/超时是上游或冷启动问题，不是 Cookie 无效。先确认 nav，再看日志，最后重试路由。

### 6.9 preview 超时与 check 超时语义不同

**问题**: 新 Cookie 下 12 源应用侧验收中，`15319615` 和 `1265652806` 在 admin preview 当时的固定 15s 超时内失败，但同一窗口的实际 check（90s）均成功入库 30 条；`15319615` 之后单独请求路由返回 HTTP 200/40。若只看 preview，会误判这两个源不可采集。

**规则**:
- preview 与 check 使用不同超时：preview 现由 `SOURCE_PREVIEW_TIMEOUT_MS` 控制（默认 30s，最低 5s，生产 Compose 透传），check 使用 `SOURCE_CHECK_TIMEOUT_MS`；RSSHub 浏览器回退冷启动可能超过 15s。
- 判断源可用性以实际 check、`newItems` 和源健康记录为准；preview 超时只说明预览窗口不足，不能替代采集验收。
- 关注 UP 源在数据库中 `game=''`，而 `CreateSourceSchema` 要求非空 `game`；`SourcePreviewSchema` 现允许空值并以“通用”展示，创建/更新仍要求非空。预览占位不能当成采集失败，也不能自动回填历史数据。
- 单一时间窗口的 12/12 成功仍不等于永久恢复；上游 API 空 JSON、浏览器回退和间歇 503 会反复出现。

**修复（2026-10-21）**: 用户确认方案 A+B 后，preview 超时改为可配置默认 30s，空 `game` 只在预览层放宽。回归覆盖默认 30s、环境变量覆盖、空 game 显示占位和创建/预览校验差异；后端 33 文件、229 项测试与 build 通过。

**隔离真实源复核（2026-10-21）**: 12 源 preview 首轮 10/12 成功（每源 30 条，3.5–9.1s）；`15319615`（8.9s）和 `1265652806`（5.8s）已在上次 15s 超时窗口外成功，4 个空 game 源返回“通用”，没有 preview 触发 30s。`1340190821`/`161775300` 首轮 422 路由失败，重试 37/73ms 成功，说明 preview 失败也可能来自上游瞬态而不是超时或源不可用。两轮 check 均 12/12 healthy，首轮 360 新增/0 失败、次轮 0 新增；隔离库 360 条、24 条 healthy 日志。30s 仍短于 90s check 窗口，单一时间窗口不能写成永久恢复。

### 6.10 管理端写请求要过浏览器验收，验收脚本要显式数据源

**问题**: 隔离环境用脚本直接请求 admin API 时 preview 正常，但第一次在浏览器 UI 点击“测试预览”返回 `Validation failed for source preview: : Invalid input: expected object, received undefined`。根因是 `client/src/services/api.ts` 的 `request()` 先把默认 headers 写入对象、再展开 `...options`，带 `Authorization` 时整个 headers 被 `authHeaders()` 覆盖，`Content-Type: application/json` 丢失，Express 不解析 body。影响所有带 body 的管理端写接口；脚本验收自行设置了 Content-Type，未覆盖客户端封装。

**规则**:
- 管理端写路径（preview、建源、改源、关注、隐藏、设置）至少用浏览器走一次成功和失败路径；API 脚本通过不能代表 UI 封装正确。
- 合并 fetch 选项时先展开 `options`，再合并 headers；不要让 `options.headers` 整体覆盖默认 Content-Type。
- 浏览器隐藏视口（0x0）只能做 DOM 结构断言；截图/移动端布局必须明确标为未验证，不能凭 DOM 推断视觉。
- 隔离验收脚本创建的 PrismaClient 必须显式传 `datasourceUrl` 并断言 `PRAGMA database_list`；脚本进程没有 `DATABASE_URL` 时 Prisma 可能回退到真实 `server/.env`。本次辅助脚本因此执行了只读计数（无写入），已披露并修复。

**证据（2026-10-21）**: 修复后 UI 空 game preview 返回 30 条/展示 5 条；无效 route 显示 `role=alert` 的 503；多窗口 check 65.0s/4.8s 均 12/12 healthy，说明单窗口和单次 preview 都不能代表长期稳定性。

### 6.11 间歇 503 的失败 UID 会轮换，单轮不能归因固定源

**问题**: 2026-10-22 P1-4 三轮隔离 12 源 check 中，轮次 A 为 12/12 `healthy`；轮次 B 只有 `1955897084` HTTP 503；轮次 C 变为 `401742377` 和 `1636034895` 503，而 B 失败的 `1955897084` 已恢复。`15319615`、`224267770` 三轮均成功；总耗时分别为 92.5s、32.0s、64.3s。只看单轮会误判固定源故障或“已全面恢复”。

**规则**:
- 单轮 503 只记录为该窗口失败，至少再跑一轮（最好间隔数小时）后再判断；失败 UID 轮换且下轮可恢复时，优先归因 RSSHub/上游间歇 503。
- 逐源 `completionOffsetMs` 包含并发队列等待，不等于单源抓取耗时；同时记录实际 RSS 请求耗时和整体 check 时长。
- 不要因单轮 503 改回 B站直连 fallback 或调整采集主路径；先复测并保留逐源证据。
- 观察脚本使用新隔离库、阻断真实 `.env`、禁用直连 fallback、阻断 AI 调用，并保存每轮逐源 JSON。

## 更新日志

| 日期 | 内容 |
|------|------|
| 2026-10-22 | 补充 P1-4 三轮观察与间歇 503 失败 UID 轮换的判读边界（6.11） |
| 2026-10-21 | 补充管理端浏览器验收、Content-Type 合并顺序与验收脚本显式数据源（6.10） |
| 2026-10-21 | preview 超时改为可配置 30s、空 game 仅预览层放宽，更新 6.9 |
| 2026-10-20 | 补充 preview 15s 硬超时与 check 超时语义不同、空 game 预览限制（6.9） |
| 2026-10-20 | 补充健康检查与路由就绪的边界、Cookie 更新脚本的命令拼接问题（6.8） |
| 2026-10-20 | 补充 Playwright CLI 裁剪、RSSHub 容器 CA 诊断、开发 Compose Cookie 回退与上游风控间歇成功边界（5.19、6.6、6.7） |
| 2026-10-20 | 补充 B站主路径切换、Cookie 归属、直连显式开关和 per-uid 映射覆盖（5.20、6.5、6.6） |
| 2026-10-20 | 补充真实临时 SQLite 隔离与可验证守卫、终态哨兵时间不得进入定时器调度（6.3、6.4） |
| 2026-10-19 | 补充采集空列表/失败语义、来源时效、入队与输入版本一致性、测试数据库隔离经验 |
| 2026-06-09 | 初始版本：从三轮 code review + 部署 + AI 分类调试中提炼 |
| 2026-06-09 | 重构为跨项目可复用格式，分离项目特定内容到 AGENTS.md |
| 2026-06-12 | 补充 SQLite 备份恢复、源健康历史、定时任务互斥锁经验 |
| 2026-06-12 | 补充 SQLite FTS5 全文搜索实现要点 |
| 2026-06-12 | 补充批量操作必须走持久化队列、任务 Claim 原子化经验 |
| 2026-06-12 | 补充 API 层统一 401 处理经验 |
| 2026-06-12 | 补充日志表保留策略经验 |
| 2026-06-12 | 补充配置检查脚本不要 source .env 的运维经验 |
| 2026-06-14 | 补充 RSSHub Chromium 完整踩坑链（5.19） |
| 2026-06-14 | 补充 docker-compose 环境变量传递陷阱（5.20） |
| 2026-06-14 | 补充 .env 前导空格问题（5.21） |
| 2026-06-14 | 补充复杂问题排查方法论（5.22） |
| 2026-06-21 | 补充 Git 远端、镜像与生产部署漂移排查经验（2.10） |
| 2026-06-21 | 补充稳定情报身份、分类解耦与聚合分页经验（5.23） |
| 2026-06-22 | 补充 Prisma 唯一索引、FTS5 与可恢复迁移顺序（5.24） |
| 2026-06-22 | 补充 AI 入流/分析状态边界与 Provider 切换规则（5.25） |
| 2026-06-23 | 补充配置闭环与 query 参数多值契约经验（5.26、5.27） |
| 2026-06-24 | 补充 AI 状态分离、跨来源热度归一和任务历史治理经验（5.28–5.30） |
| 2026-06-30 | 补充展示热度与 raw 热度趋势拆分经验（5.32） |
| 2026-07-02 | 补充 server 不能直接 import `shared/` 的 tsconfig rootDir 经验（5.33） |
| 2026-07-03 | 补充 AI 重分析失败必须清理旧业务字段经验（5.28.1） |
