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

## 更新日志

| 日期 | 内容 |
|------|------|
| 2026-06-09 | 初始版本：从三轮 code review + 部署 + AI 分类调试中提炼 |
| 2026-06-09 | 重构为跨项目可复用格式，分离项目特定内容到 AGENTS.md |
