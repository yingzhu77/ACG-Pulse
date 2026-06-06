# 下次会话接手提示词

更新时间：2026-06-04

## 项目路径
`D:\111222333\personal-hot-monitor`

## 当前状态
- 服务端构建：通过
- 客户端构建：通过
- 测试：22 个通过
- 数据库：已运行 seed-defaults，包含 23 个源（含异环）

## 架构优化完成

### 前端组件拆分
- App.tsx 从 1314 行减少到 109 行
- 拆分为 13 个组件、4 个 hooks、3 个工具文件

### 后端路由模块化
- 路由按功能拆分：stories、sources、stats
- 添加统一错误处理和请求日志中间件

### 类型安全增强
- 添加 validation.ts 使用 Zod 进行输入验证
- 完善类型定义

## 分类边界规则（已验证有效）

### music 分类
- 游戏官方源（sourceIsOfficial=true）→ 游戏EP
- 非官方源（sourceIsOfficial=false）→ 最新音乐

### game_trailer 分类（严格限制）
- 【必须】sourceIsOfficial=true 才能使用
- 【禁止】非官方UP主的游戏预告归入此类
- 非官方UP主的游戏预告必须归为 trailer

### 后处理逻辑
- analyzer.ts 中添加后处理：非官方源的 game_trailer 强制改为 trailer

## 关键文件

| 文件 | 用途 |
|------|------|
| `server/src/gamepulse/storyAggregation.ts` | 情报聚合逻辑 |
| `server/src/gamepulse/routes/public.ts` | 公共 API 路由组合 |
| `server/src/gamepulse/routes/stories.ts` | 情报路由 |
| `server/src/gamepulse/routes/sources.ts` | 源路由 |
| `server/src/gamepulse/routes/stats.ts` | 统计路由 |
| `server/src/gamepulse/routes/admin.ts` | 管理 API |
| `server/src/gamepulse/ai/provider.ts` | AI 分析提示词 |
| `server/src/gamepulse/ai/analyzer.ts` | AI 分析执行（含后处理） |
| `server/src/gamepulse/validation.ts` | Zod 输入验证 |
| `client/src/App.tsx` | 主组件（109行） |
| `client/src/hooks/` | 自定义 hooks |
| `client/src/components/` | UI 组件 |
| `client/src/services/api.ts` | API 服务 |
| `client/src/services/socket.ts` | WebSocket 服务 |

## 构建命令
```powershell
cd D:\111222333\personal-hot-monitor\server
npm.cmd run build
npm.cmd test

cd D:\111222333\personal-hot-monitor\client
npm.cmd run build
```
