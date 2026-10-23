# ACG Pulse 优化路线图

> 状态：2026-10-22。本文只保留当前计划、当前事实摘要和里程碑；2026-10-22 之前的详细阶段计划与验收快照已归档到 [2026-10 路线图历史](archive/roadmap-2026-10-history.md)。

## 文档口径

- **轮次**：一次隔离 12 源 check；**窗口**只用于描述历史时间窗口，不再用“窗口”代替轮次。
- 源健康统一使用 `healthy` / `degraded` / `failed`；有失败的轮次必须记录失败 UID、HTTP 状态和是否复测。
- 当前测试基线：后端 33 个文件、**243 项通过**，`server` build 通过；client `lint`/`build` 通过（2026-10-22）。

## 当前事实

- **P1-4 长间隔观察已完成**：三轮隔离 12 源 check 分别为 92.5s、32.0s、64.3s；healthy 为 12/12、11/12、10/12；新增 360、330、300。有失败的轮次均为 RSSHub HTTP 503，失败 UID 轮换：B 轮 `1955897084`，C 轮 `401742377`、`1636034895`。B 轮失败项在 C 轮恢复；**C 轮两个失败项尚未复测**。`15319615`、`224267770` 三轮均成功。证据见 [P1-4 上游观察证据](evidence/p1-4-upstream-observation.md)。
- **P1-6 社区 AI 情绪截断已修复**：每批 ≤5 条、`max_tokens=4096`、60s；截断或缺失序号只对失败项拆半重试（深度 2）；`failed` 结果 6h 冷却。隔离真实 AI 复验冷刷新 26 条，NGA 15/15 `completed`、`unknown/failed=0`；5 次调用全部 `stop`，8,699 tokens，58.1s；增量 28 条、2 次调用。
- **B站采集**：自建 RSSHub 为主路径，应用容器不接收 Cookie；直连 API 只在 `BILIBILI_DIRECT_API_FALLBACK` 或源配置显式开启时备用。
- **社区上游**：上次真实验收为 B站 `degraded`、NGA `degraded`、小黑盒 `healthy`；B站 game ranking 仍 `-400`，NGA 仍有个别论坛权限不足。不能把历史窗口结果写成当前全部恢复。
- **部署**：未恢复公开部署；应用容器当前不作为运行中的生产服务。

## 当前优先级

| 优先级 | 任务 | 验收 |
| --- | --- | --- |
| P2-1 | 管理端视觉/移动端验收 | 在可见视口截图检查 loading、错误态、结果列表和窄屏布局；无可见视口时明确未验证 |
| P1-1 | Cookie 映射与默认源一致 | 新增/删除 B站源时同步两份 Compose 和 `bilibiliCookieMapping.test.ts` |
| P1-5 | preview 30s 是否仍合适 | 只在冷缓存窗口出现 preview 超时且 check 成功时复评；不因单次失败直接调大或改主路径 |
| P2-2 | 付费采集源评估 | 先积累自建 RSSHub 成功率、失败类型和 Cookie 寿命；需用户单独授权，不得默认启用 |
| P2-3 | 公开部署 | 未获单独授权不恢复；恢复时按 [deployment-guide.md](deployment-guide.md) 执行并轮换旧实例凭据 |

## 已完成里程碑

- **2026-10-22**：P1-4 三轮上游观察完成；观察脚本移入 `scripts/observe-upstream.mts`，脱敏证据纳入 `docs/evidence/`。
- **2026-10-21**：社区条目校验、`degraded` 部分成功语义、preview 超时与空 `game` 预览、管理端请求头合并修复；社区 AI 情绪截断修复并完成隔离真实 AI 复验。
- **2026-10-20**：B站主路径切换到自建 RSSHub；直连 fallback 改为显式开启；12 个 UID 的 Cookie 映射与真实源验收。
- **2026-10-19 及更早**：采集可靠性、AI 队列持久化、FTS5、Stories 分页与 facets 优化等；详见 [历史归档](archive/README.md)。

## 边界与操作约束

- 不使用 B站直连 fallback 绕过 RSSHub 故障；单轮 503 不等于固定源故障。
- 真实 AI 调用、付费采集源和公开部署都需要单独授权；验收默认使用隔离 SQLite、空 AI Key 或受控 Provider。
- 原始观察 JSON 和隔离库保留在本地 `tmp/upstream-observation/`（已忽略）；仓库只提交脱敏摘要和可复用脚本。
- 多轮成功仍不代表长期稳定；报告必须注明执行时间、失败 UID 和复测状态。

当前交接、风险和下一窗口提示词见 [NEXT_WINDOW_PROMPTS.md](NEXT_WINDOW_PROMPTS.md)；协作规则与优先级同步在 [AGENT_WORKFLOW.md](AGENT_WORKFLOW.md)。
