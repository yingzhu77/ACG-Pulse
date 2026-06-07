#!/bin/bash
# 保存 B站 Cookie 到数据库
# 用法: bash save-cookie.sh

set -e

echo "=== 保存 B站 Cookie ==="

# 获取 token
TOKEN=$(curl -s -X POST http://localhost:3001/api/admin/login -H "Content-Type: application/json" -d '{"password":"acg2026"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "❌ 登录失败"
  exit 1
fi

echo "✅ 登录成功"

# 保存 cookie
COOKIE='SESSDATA=e5b8acd4%2C1796358501%2Ca1964%2A61CjC5PELcqSTBdZ3GvdLIJebwCGnjrd4U4pFs-dBngFwWR7hwAeAYNa31xyctMTnhOJoSVmoxb1ExZzV1amRWMmlNM0NHV0ZoQWtXT0EzR216Y0w3OVA3NzdjQ0s1Rk9ReUpmNDBETmJRczYwMDhLeEN1V3RCQ0lkR0JPdGszYnM4NDVkUzY4STRBIIEC; bili_jct=f67487f1bd41e43ed294dcfc9b0de27a; DedeUserID=670101736'

curl -s -X PUT http://localhost:3001/api/admin/settings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"BILIBILI_COOKIE\":\"$COOKIE\"}"

echo ""
echo "✅ Cookie 已保存"

# 重启服务
echo "=== 重启服务 ==="
cd /opt/personal-hot-monitor
sudo docker compose down
sudo docker compose up -d

echo "✅ 服务已重启"
echo ""
echo "等待 15 秒后验证..."
sleep 15

# 验证
curl -s http://localhost:3001/api/health
echo ""

# 采集
echo "=== 触发采集 ==="
TOKEN=$(curl -s -X POST http://localhost:3001/api/admin/login -H "Content-Type: application/json" -d '{"password":"acg2026"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
curl -s -X POST http://localhost:3001/api/admin/check -H "Authorization: Bearer $TOKEN"

echo ""
echo "✅ 完成"
