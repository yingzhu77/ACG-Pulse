# CLAUDE.md — ACG Pulse

> Claude Code 每次启动自动加载此文件。所有开发工作必须遵循以下规范。

---

## 项目约束（不可违反）

- **v1 范围**：不添加用户注册；热搜/趋势是预留适配器，不做核心行为
- **采集与 AI 解耦**：AI 失败不能阻塞 FeedItem 采集
- **分类不可跨组**：`sourceIsOfficial=true` → 游戏情报组；`false` → 关注投稿组
- **不提交 secrets**：API key、Cookie、token 只在环境变量中
- **useRef 必须传初始值**：TypeScript 严格模式要求

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + Vite 7 + TypeScript + Tailwind CSS 4 + Framer Motion |
| 后端 | Express 5 + Prisma + SQLite + Socket.IO |
| AI | OpenRouter / DeepSeek / Xiaomi MiMo（三选一） |
| RSS | RSSHub (Docker) |
| 部署 | Docker Compose |
| 服务器 | 阿里云新加坡 8.219.121.132 |

---

## 当前状态（2026-06-11）

**v1.2 已完成**：多源采集(24+)、AI 分类(13 种)、Story 聚合、热搜、WebSocket、移动端、收藏、Docker 部署、骨架屏、今日热门、Footer 链接、社区热点风向（B站+NGA+AI情绪分析+反讽检测）、安全加固（CORS/helmet/rate-limit/路由认证）、GitHub Actions CI

**v1.3 待办**：社区数据持久化、增量更新、定时任务、WebSocket推送社区数据、小黑盒集成、CSS模块化，详见 `AGENTS.md` 后续规划

**更新命令**：
```bash
ssh root@8.219.121.132 "cd /opt/personal-hot-monitor && git pull origin master && docker compose up -d --build"
```

---

## 编码规范（强制执行）

### 不可变性（CRITICAL）

```typescript
// ❌ 错误：直接修改原对象
setSourceDraft({ ...props.sourceDraft, name: value })

// ✅ 正确：函数式更新
setSourceDraft(prev => ({ ...prev, name: value }))
```

### 错误处理

- 所有 `async` 函数必须有 `try/catch`
- UI 层用 `showToast` 提示用户，不要 `console.error` 后无操作
- 服务端记录详细错误上下文

### 命名规范

| 类型 | 格式 | 示例 |
|------|------|------|
| 变量/函数 | `camelCase` | `loadPublicData`, `isAdmin` |
| 布尔值 | `is/has/should/can` 前缀 | `isLoading`, `hasMore` |
| 接口/类型/组件 | `PascalCase` | `FeedPanelProps`, `StoryCard` |
| 常量 | `UPPER_SNAKE_CASE` | `MAX_FEED_ITEMS` |
| Hook | `use` 前缀 | `usePublicData`, `useFavorites` |

### 文件组织

- 单文件不超过 800 行，推荐 200-400 行
- 按功能/领域组织，不按类型
- 提取重复逻辑为工具函数
- import 顺序：React → 第三方库 → 本地模块

### 性能规则

- 列表过滤/转换用 `useMemo`
- `Array.includes` 大数据量改 `Set.has`
- 搜索输入必须 debounce（300ms）
- 避免每秒级定时器
- 不要在 `useCallback` 依赖中放对象引用（会导致频繁重建）

---

## 接口变更流程（严格，不可跳过）

改组件 Props 接口时：

```
1. grep 组件名 → 找到所有 JSX 使用处（桌面端 + 移动端 + drawer 可能各一处）
2. 逐一确认每个使用处的 prop 是否匹配新接口
3. npx tsc --noEmit
4. cd client && npm run build（验证 tsconfig 严格模式）
```

**教训**：`replace_all: true` 不可靠——同一组件在不同 JSX 块中上下文不同，可能只匹配部分。

---

## 安全检查清单（每次提交前）

- [ ] 无硬编码 secrets
- [ ] 用户输入已验证
- [ ] SQL/NoSQL 注入防护（参数化查询）
- [ ] XSS 防护（HTML 转义）
- [ ] 错误信息不泄露敏感数据
- [ ] API 有速率限制

---

## Git 规范

- 类型：`feat` / `fix` / `refactor` / `docs` / `perf` / `chore`
- 格式：`<type>: <description>`
- 重要改动先创建分支，通过 PR 合并
- 合并前必须通过 `tsc --noEmit` + `npm run build`

---

## 关键文件速查

| 文件 | 用途 |
|------|------|
| `server/src/gamepulse/ai/provider.ts` | AI 提示词 + Provider 配置 |
| `server/src/gamepulse/ai/analyzer.ts` | 分析执行 + 后处理规则 |
| `server/src/gamepulse/adapters/community.ts` | 社区热点采集（B站+NGA+小黑盒）+ AI 情绪分析 |
| `server/src/gamepulse/routes/community.ts` | 社区 API 路由 + 并发锁缓存 |
| `server/src/gamepulse/storyAggregation.ts` | 故事聚合 + 合并规则 |
| `server/src/gamepulse/routes/stories.ts` | 情报 API + facets 计算 |
| `client/src/hooks/usePublicData.ts` | 核心数据 hook |
| `client/src/components/FeedPanel.tsx` | 情报流面板 |
| `client/src/components/CommunityPanel.tsx` | 社区热点面板 |
| `client/src/components/GameFilterPanel.tsx` | 左侧筛选面板 |
| `client/src/constants.ts` | 分类/来源/游戏/社区常量 |
| `client/src/index.css` | 全局样式 |
