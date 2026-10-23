# P1-4 上游观察证据（2026-10-22）

> 结论范围：三轮隔离 12 源 check。**有失败的轮次均为 RSSHub HTTP 503，失败 UID 轮换**；B 轮失败的 `1955897084` 在 C 轮恢复，C 轮失败的 `401742377`、`1636034895` **尚未复测**。不能据此声称上游已长期稳定。

## 方法

- 每轮新建隔离 SQLite，复制真实 schema/migrations 后执行 `prisma migrate deploy`，并断言 `PRAGMA database_list` 只包含临时库。
- 阻断 `server/.env` 读取；显式禁用 `BILIBILI_DIRECT_API_FALLBACK`；不设置 AI Key，并在 HTTP 层阻断聊天补全请求。
- 通过本地 socat 代理访问自建 RSSHub；预置占位头像，跳过头像直连请求，避免干扰 RSSHub 计时。
- 逐源记录 `healthStatus`、`lastSuccessAt`、`newItems`、健康日志错误、完成偏移和 RSS 请求耗时。
- 原始 JSON 保存在本地 `tmp/upstream-observation/`（已忽略，不入库）；本文件是脱敏摘要。

## 结果

| 轮次 | UTC 开始 | 总耗时 | healthy | newItems | 失败源 | RSS 请求耗时 |
| --- | --- | ---: | ---: | ---: | --- | --- |
| A | 2026-10-21T08:09:58Z | 92.5s | 12/12 | 360 | 无 | 5.5–22.0s |
| B | 2026-10-22T00:34:36Z | 32.0s | 11/12 | 330 | `1955897084`（鸣潮）HTTP 503 | 2.8–7.6s |
| C | 2026-10-22T03:30:58Z | 64.3s | 10/12 | 300 | `401742377`（原神）、`1636034895`（绝区零）HTTP 503 | 5.2–14.1s |

## 判读

- `15319615`、`224267770` 三轮均 `healthy`，每轮各入库 30 条；此前慢源问题不是永久失败。
- B 轮唯一失败的 `1955897084` 在 C 轮恢复为 `healthy`，说明至少该次 503 是瞬态的。
- C 轮两个失败项没有后续复测；是否恢复仍未知。不能把“失败 UID 轮换”扩张为“所有失败都会在下一轮恢复”。
- 逐源 `completionOffsetMs` 包含并发队列等待（`SOURCE_CHECK_CONCURRENCY=2`），不等于单源抓取耗时；上表的 RSS 请求耗时才是单请求耗时。
- 三轮总耗时差异大（32.0–92.5s），说明 RSSHub/上游窗口方差仍然明显；这不是长期稳定性证明。

## 复现

先确保自建 RSSHub 和本地代理可用，然后在仓库根目录运行：

```bash
UPSTREAM_RSSHUB_BASE_URL=http://127.0.0.1:1201 \
  server/node_modules/.bin/tsx scripts/observe-upstream.mts --label=round-$(date -u +%Y%m%dT%H%MZ)
```

脚本默认把原始 JSON 写入 `tmp/upstream-observation/`，并保留隔离数据库供本地核查；该目录不进入 Git。
