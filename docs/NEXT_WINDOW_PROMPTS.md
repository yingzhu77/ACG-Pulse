# 小窗口任务队列与上下文交接

> 状态：2026-10-22。本文只保留当前事实、剩余任务和下个窗口提示词；2026-10-22 之前的详细验收过程见 [历史归档](archive/README.md)，当前计划见 [ROADMAP.md](ROADMAP.md)。

## 当前事实

- **P1-4 长间隔观察已完成**：三轮隔离 12 源 check 为 A 92.5s/12 healthy/360 条、B 32.0s/11 healthy/330 条、C 64.3s/10 healthy/300 条。有失败的轮次均为 RSSHub HTTP 503：B 轮 `1955897084`，C 轮 `401742377`、`1636034895`。B 轮失败项在 C 轮恢复；**C 轮两个失败项尚未复测**。`15319615`、`224267770` 三轮均成功。摘要见 [P1-4 证据](evidence/p1-4-upstream-observation.md)，原始 JSON 在本地 `tmp/upstream-observation/`（已忽略）。
- **P1-6 社区 AI 情绪截断已修复**：每批 ≤5、`max_tokens=4096`、60s；截断或缺失序号只对失败项拆半重试（深度 2）；`failed` 结果 6h 冷却。隔离真实 AI 冷刷新 26 条，NGA 15/15 `completed`、`unknown/failed=0`；5 次调用全部 `stop`、8,699 tokens、58.1s；增量 28 条、2 次调用。
- **B站主路径**：自建 RSSHub；应用容器不接收 Cookie。`BILIBILI_DIRECT_API_FALLBACK` 默认 `false`，只有显式开启或单源配置才直连。
- **preview**：`SOURCE_PREVIEW_TIMEOUT_MS` 默认 30s、最低 5s；仅预览层允许空/缺失 `game`，创建/更新仍要求非空。
- **社区上游**：上次真实验收为 B站 `degraded`、NGA `degraded`、小黑盒 `healthy`；B站 game ranking 仍 `-400`，NGA 仍有个别论坛权限不足。历史窗口成功不能写成当前全部恢复。
- **运行状态**：未恢复公开部署；上一次后端基线为 33 文件、243 项测试通过，server build 通过；client lint/build 通过。

## 剩余任务队列

| 优先级 | 任务 | 验收 |
| --- | --- | --- |
| P2-1 | 管理端视觉/移动端 | 在可见视口截图检查 loading、错误态、结果列表和窄屏布局；无可见视口时明确未验证 |
| P1-1 | Cookie 映射与默认源一致 | 新增/删除 B站源时同步两份 Compose 和 `bilibiliCookieMapping.test.ts` |
| P1-5 | preview 30s 是否仍合适 | 只在冷缓存窗口出现 preview 超时且 check 成功时复评；不得因单次失败直接调大或改主路径 |
| P2-2 | 付费采集源评估 | 先积累自建 RSSHub 成功率、失败类型和 Cookie 寿命；需单独授权，不得默认启用 |
| P2-3 | 公开部署 | 未获单独授权不恢复；恢复时按 [deployment-guide.md](deployment-guide.md) 执行并轮换旧实例凭据 |

## 已知风险与边界

- P1-4 的失败 UID 每轮不同，符合间歇 503/风控特征；但只有 B 轮失败项在 C 轮复测恢复，C 轮两项仍未确认。不能把“轮换”写成“全部自动恢复”。
- 逐源 `completionOffsetMs` 包含 `SOURCE_CHECK_CONCURRENCY=2` 的排队时间，不等于单源抓取耗时；应同时看 RSS 请求耗时和整体 check 时长。
- 多轮成功不是长期稳定性证明；报告必须注明执行时间、失败 UID、HTTP 状态和是否复测。
- 65s 级 check 可能超过 preview 默认 30s；preview 超时不能判定源不可用，必须以 check、`newItems` 和健康记录为准。
- 社区 B站 game ranking `-400`、NGA 个别论坛权限不足仍存在；按平台记录错误，不转空列表，不启用直连 fallback 掩盖。
- `deepseek-v4-flash` 是推理模型；调整批大小、`max_tokens` 或超时需同步更新截断/部分返回/重试上限测试。
- 管理端写请求已修复 `Content-Type` 合并顺序，但尚未逐一浏览器回归所有写接口；截图与移动端仍未验证。
- 不读取、打印或提交真实 Cookie、API Key、管理员密码、生产数据库或归档数据；原始 P1-4 JSON 和隔离库留在本地 `tmp/`，不入库。

## 验证证据

- 后端：`cd server && npm.cmd test` → 33 文件、243 项通过；`npm.cmd run build` 通过。
- 前端：`cd client && npm.cmd run lint && npm.cmd run build` 通过。
- P1-4：见 [docs/evidence/p1-4-upstream-observation.md](evidence/p1-4-upstream-observation.md)；复跑脚本为 [scripts/observe-upstream.mts](../scripts/observe-upstream.mts)。
- P1-6：隔离 SQLite + 真实三源 + 真实 `deepseek-v4-flash`；冷刷新 26 条、NGA 15/15 `completed`、`unknown/failed=0`，5 次调用全部 `stop`，8,699 tokens、58.1s；增量 28 条、2 次调用均为新增话题。
- 未验证：管理端截图/移动端布局、C 轮失败项复测、上游长期稳定性、生产部署。

## 下个窗口提示词（可直接复制）

```text
你在 D:\111222333\personal-hot-monitor（ACG Pulse）项目中工作。目标：补齐管理端浏览器视觉/移动端验收，并保持 Cookie 映射一致。

背景（2026-10-22 已完成）：
- P1-4 三轮隔离 12 源 check：A 92.5s/12 healthy/360 条；B 32.0s/11 healthy/330 条（1955897084 503）；C 64.3s/10 healthy/300 条（401742377、1636034895 503）。B 轮失败项在 C 恢复，C 轮两项未复测；15319615、224267770 三轮均成功。
- P1-6 社区 AI 情绪截断已修复：每批 ≤5、max_tokens=4096、60s；截断/缺失序号只拆半重试失败项（深度 2）；failed 6h 冷却；隔离真实 AI 复验 NGA unknown/failed=0。
- 上游仍有方差：B站 game ranking -400、NGA fid=694 权限不足、B站 API 空 JSON/浏览器回退；check 耗时 32.0–92.5s。

任务：
1. 在可见视口下验收管理端 loading、error、结果列表和窄屏布局；无可见视口时明确未验证。
2. 保持 P1-1：新增/删除 B站源时同步两份 Compose 与 bilibiliCookieMapping.test.ts。
3. 如需复跑上游观察，使用 scripts/observe-upstream.mts（默认输出到 tmp/upstream-observation）；不要用单轮 503 直接改采集路径。

约束：
- 不读取/打印真实凭据、Cookie、生产数据库；不恢复部署；不启用付费采集源。
- 真实 AI 调用需用户单独确认；先做无付费测试，再做小批量真实探针。
- 最小修改，复用现有测试设施；不要把失败写成成功空列表。

验收方法提示：
- Prisma 必须在 import 前设置隔离 DATABASE_URL，迁移后断言 PRAGMA database_list；不要用未指定 datasourceUrl 的 PrismaClient。
- 统计 AI 调用如需 patch axios，使用 ESM 入口（node_modules/axios/index.js）的默认实例；CJS 实例不同。
- 真实调用需记录 model、finish_reason、usage.completion_tokens_details.reasoning_tokens、耗时和调用次数；不要打印 headers 或内容。
```
