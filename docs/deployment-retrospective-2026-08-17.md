# ACG Pulse 生产部署复盘（2026-08-17）

## 结论

本次生产实例在到期前仍正常运行，内容抓取没有整体停止。用户感知到的“很久没有更新”主要由两类独立问题叠加造成：

1. Bilibili 相关来源大量触发风控，导致每轮 24 个来源中约 10–11 个失败。
2. AI 服务返回 HTTP 402，社区情感分析无法完成，但这不会阻断普通内容入库。

因此，这次不属于数据库损坏、定时任务停止或整站宕机，而是“部分来源持续失败 + AI 分析额度耗尽”造成内容覆盖率和分析完整度下降。

## 到期前状态快照

快照时间：2026-08-17 19:57（Asia/Shanghai）。

- 系统：Ubuntu 24.04，Linux 6.8。
- 磁盘：30 GB，总使用率 67%，剩余约 9.4 GB。
- 内存：约 1.6 GiB，快照时可用约 170 MiB；另有 2 GiB Swap，未使用。
- 应用容器：`game-pulse`，连续运行约 6 周，健康状态正常。
- RSSHub 容器：`game-pulse-rsshub`，连续运行约 2 周，健康状态正常。
- 应用端口：仅绑定 `127.0.0.1:3001`，未直接暴露公网。
- 反向代理：Caddy 2.6.2，域名 `acg.yingzhu.xyz` 转发到 `localhost:3001`。
- 生产代码：`master` 与 `origin/master` 一致，提交为 `4f87650`。
- 生产工作区没有未提交源码，仅存在备份目录和一个旧 healthcheck 备份文件。

## 数据状态

2026-08-17 18:12 左右执行的只读统计结果：

- `FeedItem` 总数：2,000。
- 最近 24 小时入库：71 条。
- 最近 7 天入库：299 条。
- 最新内容约在北京时间 18:00 入库，检查时仅过去约 12 分钟。

总数固定在 2,000 与生产配置 `MAX_FEED_ITEMS=2000` 一致，属于保留上限，不代表系统历史上只抓取过 2,000 条。

## 故障归因

### Bilibili 来源

日志中的主要错误组合为：

- Bilibili 直连 API：HTTP 412 或“风控校验失败”。
- 自建 RSSHub 回退：HTTP 503。
- 公共 `rsshub.app` 回退：HTTP 403。

受影响来源包括原神、崩坏：星穹铁道、绝区零、崩坏 3、鸣潮、明日方舟、明日方舟：终末地、异环、IGN 中国、夏日幻听 MCE、aki 惊蛰和乌鸦预告片等。日志快照中最近四轮定时检查均检查 24 个来源，每轮失败 10–11 个。

这说明 Bilibili Cookie、请求频率、出口 IP 风控和 RSSHub 路由需要一起检查，仅补充 AI 额度不能恢复这些来源。

### AI 分析

社区日志重复出现：

```text
[Community] AI sentiment error: Request failed with status code 402
```

HTTP 402 表示当前 AI 服务账户余额或额度不可用。现有架构将抓取入库与 AI 分析分开处理，因此它会造成情感分析和分析任务失败，但不会让普通抓取完全停止。

恢复时应先更换或充值 AI Provider，再处理失败分析任务。不要把 AI 402 当作 Bilibili 来源失败的根因。

## 已保存档案

### 生产数据备份

- 文件：`live-20260817-181027.tar.gz`
- SHA256：`f975880cec486ee58ab350b8ad7a9a6b3b03bc040a5b8c1ffc9872c6e3566b56`
- 内容：生产 `.env`、`docker-compose.yml`、`prod.db`
- SQLite `PRAGMA integrity_check`：`ok`

该文件包含管理员密码、JWT Secret、AI Key 和 Bilibili Cookie，必须作为敏感文件离线保存，不得提交 Git 或上传公开存储。

### 部署复盘档案

- 文件：`handover-20260817-195728.tar.gz`
- SHA256：`bc1ffd3b0c486eb970af4bb7dcdff2ac2f9d704eea75de1f61ba64d90468718e`
- 内容：源代码与 `.git`、生产 Git 状态、最近提交、容器与镜像信息、系统状态、应用日志和未提交补丁。

两个文件均已下载到本地并通过 SHA256 校验。生产数据备份还通过了 SQLite 内部完整性检查。

### Caddy 配置备份

- 文件：`caddy-backup-20260817.tar.gz`
- SHA256：`93e69e41f95a3cc2a9af76375804912a20059e960824c6a648cccb792f03bd0b`
- Caddy 版本：2.6.2。
- 服务：systemd 的 `caddy.service`，以 `caddy` 用户运行。
- 配置路径：`/etc/caddy/Caddyfile`。
- 转发规则：`acg.yingzhu.xyz` 转发到 `localhost:3001`。

该配置不包含单独保存的 TLS 私钥。Caddy 在新服务器上启动并且域名 DNS 已指向新 IP 后，可以自动重新申请证书。

## 管理后台密码

当前实现使用服务器 `.env` 中的 `ADMIN_PASSWORD`，不是数据库中的哈希记录。因此旧密码可以从离线生产备份的 `.env` 中恢复，但不应在聊天、终端截图或复盘文档中展示。

重新部署时建议直接设置新密码并轮换 `ADMIN_JWT_SECRET`、AI Key 和 Bilibili Cookie，避免继续使用已长期存放在旧实例上的凭据。

## 迁移恢复顺序

1. 准备至少 2 GiB 内存、30 GB 磁盘的 Linux 主机，并配置 Swap。
2. 克隆仓库并检出已归档的生产提交，或从 `source-and-git.tar.gz` 恢复生产工作区。
3. 从敏感备份恢复 `.env`，随后轮换管理员密码、JWT Secret 和外部 API 凭据。
4. 使用 `docker compose build` 构建应用和自建 RSSHub。
5. 创建 `app-data` 卷，将 `prod.db` 恢复到 `/app/server/data/prod.db`，确认文件权限可被容器用户读取。
6. 执行已有 Prisma 生产迁移流程，不使用 `prisma db push` 替代正式迁移。
7. 启动容器，确认 `/api/health`、数据库统计、管理登录和社区接口正常。
8. 安装 Caddy，将已归档的 Caddyfile 恢复到 `/etc/caddy/Caddyfile`；更新 DNS 后验证 HTTPS。应用端口继续只绑定本机地址。
9. 更新 Bilibili Cookie，降低并发并验证直连 API 与自建 RSSHub 各自的返回结果。
10. 配置有余额的 AI Provider，再检查失败分析任务是否需要重试。

## 下次部署应改进

- 将数据库自动备份同步到服务器之外，并定期执行恢复演练和 SQLite 完整性检查。
- 对“定时任务存活”“新增条数”“失败来源比例”“AI 队列失败率”分别监控，避免只看容器健康状态。
- 当连续多轮 `failedSources` 超过阈值时主动告警，并在管理后台展示具体来源和最后成功时间。
- 将 AI 402、Bilibili 风控、RSSHub 故障分成不同告警类型，明确它们对抓取和分析的不同影响。
- 管理员密码应逐步改为哈希存储或独立身份认证；至少不要长期使用可直接读取的明文环境变量。
- 为服务器到期设置提前 7 天、3 天和 1 天的提醒，预留最终停机快照和 DNS 切换时间。

## 尚待补齐

- RSSHub 容器的独立日志文件为空；现有应用日志已记录 RSSHub 503，但下次应确认 Docker 日志驱动和日志轮转策略。
- DNS 记录、ECS 安全组、实例规格和云厂商到期信息属于云端配置，需另行截图或导出，不能仅依赖服务器文件备份。
