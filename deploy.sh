#!/bin/bash
set -e

# ============================================
# ACG Pulse 一键部署脚本
# 用法: ./deploy.sh [服务器地址] [SSH用户]
# 示例: ./deploy.sh 1.2.3.4 root
# ============================================

SERVER="${1}"
USER="${2:-root}"

if [ -z "$SERVER" ]; then
    echo "用法: ./deploy.sh <服务器IP> [SSH用户]"
    echo "示例: ./deploy.sh 1.2.3.4 root"
    exit 1
fi
REMOTE_DIR="/opt/personal-hot-monitor"
SSH_CMD="ssh ${USER}@${SERVER}"

echo "=========================================="
echo "  ACG Pulse 部署到 ${USER}@${SERVER}"
echo "=========================================="

# 1. 检查 SSH 连接
echo ""
echo "[1/6] 检查 SSH 连接..."
if ! ssh -o ConnectTimeout=5 ${USER}@${SERVER} "echo OK" 2>/dev/null; then
    echo "  ❌ 无法连接到 ${SERVER}"
    echo "  请确认："
    echo "    - 服务器 IP 正确"
    echo "    - SSH 密钥已配置"
    echo "    - 防火墙允许 22 端口"
    exit 1
fi
echo "  ✅ SSH 连接正常"

# 2. 安装 Docker（如果未安装）
echo ""
echo "[2/6] 检查 Docker..."
if ! ssh ${USER}@${SERVER} "command -v docker" &>/dev/null; then
    echo "  📦 安装 Docker..."
    ssh ${USER}@${SERVER} "curl -fsSL https://get.docker.com | sh && systemctl enable docker && systemctl start docker"
    echo "  ✅ Docker 安装完成"
else
    echo "  ✅ Docker 已安装"
fi

# 3. 安装 Docker Compose（如果未安装）
echo ""
echo "[3/6] 检查 Docker Compose..."
if ! ssh ${USER}@${SERVER} "docker compose version" &>/dev/null; then
    echo "  📦 安装 Docker Compose..."
    ssh ${USER}@${SERVER} "apt install docker-compose-plugin -y"
    echo "  ✅ Docker Compose 安装完成"
else
    echo "  ✅ Docker Compose 已安装"
fi

# 4. 配置防火墙
echo ""
echo "[4/6] 配置防火墙..."
ssh ${USER}@${SERVER} "
    if command -v ufw &>/dev/null; then
        ufw allow 22/tcp 2>/dev/null || true
        ufw allow 3001/tcp 2>/dev/null || true
        ufw allow 1200/tcp 2>/dev/null || true
        echo '  ✅ 防火墙规则已添加'
    else
        echo '  ⚠️  ufw 未安装，跳过防火墙配置'
    fi
"

# 5. 拉取代码并部署
echo ""
echo "[5/6] 部署应用..."
ssh ${USER}@${SERVER} "
    # 克隆或拉取代码
    if [ -d '${REMOTE_DIR}' ]; then
        cd ${REMOTE_DIR}
        echo '  📥 拉取最新代码...'
        git pull origin master
    else
        echo '  📥 克隆仓库...'
        cd /opt
        git clone https://github.com/yingzhu77/personal-hot-monitor.git
        cd personal-hot-monitor
    fi

    # 配置环境变量（首次）
    if [ ! -f .env ]; then
        echo '  ⚠️  首次部署，请手动配置 .env：'
        echo '    cp .env.production.example .env'
        echo '    nano .env'
        echo ''
        echo '  必填项：'
        echo '    AI_PROVIDER=mimo'
        echo '    MIMO_API_KEY=你的key'
        echo '    ADMIN_PASSWORD=你的密码'
        echo '    ADMIN_JWT_SECRET=随机字符串'
        echo ''
        exit 1
    fi

    # 构建并启动
    echo '  🏗️  构建并启动服务...'
    docker compose up -d --build
"

# 6. 验证部署
echo ""
echo "[6/6] 验证部署..."
sleep 5

# 检查容器状态
echo "  📋 容器状态："
ssh ${USER}@${SERVER} "docker compose -f ${REMOTE_DIR}/docker-compose.yml ps"

# 检查服务健康
echo ""
echo "  🔍 检查服务健康..."
HEALTH=$(ssh ${USER}@${SERVER} "curl -s http://localhost:3001/api/public/stats" 2>/dev/null)
if echo "$HEALTH" | grep -q '"total"'; then
    echo "  ✅ 服务运行正常"
    echo "  📊 数据统计："
    echo "$HEALTH" | grep -o '"total":[0-9]*' | head -1
else
    echo "  ⚠️  服务可能还在启动中，请稍后检查："
    echo "    curl http://${SERVER}:3001/api/public/stats"
fi

echo ""
echo "=========================================="
echo "  部署完成！"
echo "=========================================="
echo ""
echo "  前端访问: http://${SERVER}:3001"
echo "  API 地址: http://${SERVER}:3001/api/public/stats"
echo ""
echo "  管理后台："
echo "    1. 访问前端页面"
echo "    2. 点击右上角管理按钮"
echo "    3. 输入管理员密码登录"
echo ""
echo "  查看日志："
echo "    ssh ${USER}@${SERVER}"
echo "    cd ${REMOTE_DIR}"
echo "    docker compose logs -f app"
echo ""
