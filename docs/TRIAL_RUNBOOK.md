# ACG Pulse 私有试用运行手册

基于审批分支 `feat/daily-reading-cycle` 的 `8a2788d`。本手册用于在自己的电脑或私有 Linux 主机上跑有持久 SQLite 的实例，不是 `editorial-preview.sh` 的一次性合成预览，也不接管旧生产环境。

## 第一次启动

需要 Linux 或 Windows WSL、Bash、Node.js 22.12+（本轮使用 Node 24）、Python 3、`curl`、npm。解压运行包，进入含 `server/` 和 `scripts/` 的目录。运行包与数据库可分开，建议把试用数据放在自己的持久目录：

```bash
export ACG_PULSE_TRIAL_DIR="$HOME/acg-pulse-trial-data"
(cd server && npm ci) && (cd client && npm ci)
bash scripts/trial.sh prepare
bash scripts/trial.sh start
bash scripts/trial.sh status
```

打开 **http://127.0.0.1:3014**。这是运行该服务的机器自己的地址，同机才能直接访问；Windows WSL 可先在 Windows 浏览器试这个地址，若 WSL 的自动转发未启用，则在 WSL 同机使用浏览器或 `curl` 检查。服务只监听 IPv4 回环。旧生产域名、公开分享链接、远程 CI 主机和临时验证环境不是本试用入口。

如果在一台自己可 SSH 登录的私有主机运行，从自己的电脑另开 SSH 隧道：

```bash
ssh -N -L 3014:127.0.0.1:3014 <账号>@<私有主机>
```

然后仍访问本机的 3014。保留隧道会话，不需要给 3014 开公网入口。应用管理员密码在数据目录内生成的私有配置中，只在自己的主机读取，不放进聊天、日志或 Git。修改端口时，两端和下列命令必须使用相同的 `ACG_PULSE_TRIAL_PORT`。

## 从空实例进入真实试用

默认不访问外部来源、不接收费模型、不自动铺默认源。首次启动可先检查服务、登录管理页和访问入口。要试真实数据，先通过管理页录入原先已验证的少量来源；若源依赖 RSSHub，先确认自建入口可用，不要用直连 Cookie 或临时扩大来源掩盖故障。没有旧库时从空库开始；不要把旧生产数据库直接作为试用数据库使用。

准备好明确的来源后，停止离线模式，再显式启用采集：

```bash
bash scripts/trial.sh stop
ACG_PULSE_TRIAL_NETWORK=1 bash scripts/trial.sh start
bash scripts/trial.sh logs
```

私有模式仍只监听本机，只跑配置来源的采集、分析队列的无模型回退和日报任务；不启动社区或热搜联网刷新。启动命令不继承收费模型 Key。无模型时普通资讯仍可在全部动态阅读，但「今日精选」只保留符合保守兜底的明确运营消息；若想评估依赖模型的精选效果，需要另行决定模型和费用。

普通采集约每 30 分钟一次，也可从管理员界面手动检查。第一轮非空抓取建立历史基线，不应把回填内容当今日新消息。确认后续真实新条目进入后，检查次日北京时间 00:10 后上一期日报已保存，再把当天当作试用第 1 天。当前自动追溯只覆盖最近 3 个已结束的上海日期；关机或掉线要在试用记录中标为采集中断。继续用 [两周记录表](ROADMAP.md#每日阅读试用)。

## 日常运行、访问和日志

- 状态和地址：`bash scripts/trial.sh status`、`bash scripts/trial.sh access`，健康探针是 `curl -fsS http://127.0.0.1:3014/api/health`。
- 运行日志：`bash scripts/trial.sh logs`，日志在数据目录的 `logs/server.log`，单份约 2 MiB，并保留一份 `server.log.1`。排查顺序是先看健康接口，再看近期采集成功／失败计数和所选源的最近成功时间。
- 停止：`bash scripts/trial.sh stop`；再次启动时保留数据库。每次启动都按实际需要重复设置 `ACG_PULSE_TRIAL_NETWORK=1`，避免误开网络。
- 长期试用要把服务放在 14 天期间能保持运行的主机。本机退出会话、关机或云工作区回收可能结束进程。可在可控的主机服务管理器中用 `bash scripts/trial.sh foreground` 监督，设置明确的工作目录、数据目录、Node PATH，以及是否启用采集；不要与后台 `start` 同时运行。没有可用的长驻主机时，本地过程验证不等于常驻实例交付。

## 备份和恢复

数据库与配置分开。运行中可做一致性快照；不能在服务写入时直接拷贝 SQLite 主文件而忽略 WAL。建议在变更前、定期以及试用期末各做一次，将已验证快照和校验文件保留在另一处由自己控制的存储。不把数据库、Cookie 或私有环境文件上传到仓库。

```bash
python3 scripts/trial-db.py backup
python3 scripts/trial-db.py verify /绝对路径/备份文件.db
# 先恢复到独立路径演练，不覆写运行目录中的数据库：
python3 scripts/trial-db.py restore /绝对路径/备份文件.db --to /绝对路径/演练库.db
# 若需要真正回滚，先停掉试用实例：
bash scripts/trial.sh stop
python3 scripts/trial-db.py restore /绝对路径/备份文件.db
bash scripts/trial.sh start
```

快照不含管理员环境文件或浏览器本地收藏。数据库快照保留内容、事件、日报和源状态；已知 Cookie、其他后台设置、认证形态的 URL 字段和上游错误详情不带出。它不是全机器或全配置备份。若你曾单独配置了认证来源，恢复后要在自己的机器恢复认证，不能假设备份包含它。已有试用库先会生成额外回滚快照；不要手动删 SQLite 的 WAL/SHM，出现提示时先确认实例和其他连接均已退出。恢复后查看健康接口、源数量、事件和日报，再决定是否恢复采集。


## 本轮验证的范围

Linux 隔离目录在私有绑定下完成构建、建立 SQLite、健康检查、离线启动和显式采集模式。后端 36 文件、262 项通过；实际进程上用一个本机 RSS 验证首次回填、后续新条目、关闭/启动数据不丢、在线快照、哈希及完整性校验、独立恢复、在线替换拒绝、停服恢复后重启。这里的 RSS 是本机合成源，未运行真实外部采集、收费模型或次日自动出刊，未开放或验证长驻远程入口。
