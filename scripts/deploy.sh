#!/usr/bin/env bash
# Claw Agent Production Deployment
#
# 架构: nginx(80) -> Next.js(3010) + Rust 后端(18008)
#   部署目录:   /storage/users/agent/claw-code
#   域名:      claw.ai.accuredit.com

set -euo pipefail

# ──────────────── 配置区 ────────────────
DEPLOY_DIR="/storage/users/agent/claw-code"
BACKEND_PORT=18008
FRONTEND_PORT=3010
DOMAIN="claw.ai.accuredit.com"

echo "============================================"
echo "  Claw Agent 部署"
echo "  部署目录: ${DEPLOY_DIR}"
echo "  域名:     ${DOMAIN}"
echo "============================================"
echo ""

# ──────────────── Step 0: 准备目录 ────────────────
echo "[0/5] 准备目录结构..."
mkdir -p "${DEPLOY_DIR}/rust/data/workspaces"
mkdir -p "${DEPLOY_DIR}/logs"

# 解析参数
SKIP_DB_BACKUP=false
if [[ "${1:-}" == "--skip-backup" ]]; then
    SKIP_DB_BACKUP=true
fi

# 备份数据库（如果存在）
DB_FILE="${DEPLOY_DIR}/rust/claw_agent.db"
if [ -f "$DB_FILE" ]; then
    if [ "$SKIP_DB_BACKUP" = true ]; then
        echo "  -> 收到 --skip-backup 参数，跳过数据库备份"
    else
        cp "$DB_FILE" "${DB_FILE}.bak.$(date +%Y%m%d%H%M%S)"
        echo "  -> 已备份数据库"
        
        # 仅保留最近的 5 份备份，删除其余旧备份
        # 使用 ls -t 降序排列，tail -n +6 获取从第6个开始的列表，然后删除
        ls -t "${DB_FILE}.bak."* 2>/dev/null | tail -n +6 | xargs -r rm -f
        echo "  -> 已清理旧备份，仅保留最近 5 份"
    fi
fi

# ──────────────── Step 1: 编译 Rust 后端 ────────────────
echo "[1/5] 编译 Rust 后端..."
cd "${DEPLOY_DIR}/rust"
cargo build --release -p api-server 2>&1
echo "  -> 后端二进制: ${DEPLOY_DIR}/rust/target/release/api-server"

# ──────────────── Step 2: 构建 Next.js 前端 ────────────────
echo "[2/5] 构建 Next.js 前端..."
cd "${DEPLOY_DIR}"

# 恢复可能被删除的前端源码文件
git checkout -- frontend/ 2>/dev/null || true

cd "${DEPLOY_DIR}/frontend"
npm install 2>&1
rm -rf .next
npm run build 2>&1
echo "  -> 前端构建完成"

# ──────────────── Step 3: 后端环境变量 ────────────────
echo "[3/5] 检查后端 .env..."
ENV_FILE="${DEPLOY_DIR}/rust/.env"
if [ ! -f "$ENV_FILE" ]; then
    cat > "$ENV_FILE" << 'ENVEOF'
PORT=18008
OPENAI_BASE_URL=http://10.50.70.91:8000/v1
OPENAI_API_KEY=Empty
OPENAI_MODEL_NAME=qwen
CLAW_WORKSPACE_ROOT=./data/workspaces
ENVEOF
    echo "  -> 已创建 ${ENV_FILE}"
else
    echo "  -> ${ENV_FILE} 已存在，跳过"
fi

# ──────────────── Step 4: Systemd 服务 ────────────────
echo "[4/5] 写入 systemd 服务配置..."

# 后端服务
sudo tee /etc/systemd/system/claw-backend.service > /dev/null << SERVICEEOF
[Unit]
Description=Claw Agent Backend (api-server)
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=${DEPLOY_DIR}/rust
ExecStart=${DEPLOY_DIR}/rust/target/release/api-server
Restart=on-failure
RestartSec=5
Environment=RUST_LOG=info,api_server=debug

[Install]
WantedBy=multi-user.target
SERVICEEOF

# 前端服务
sudo tee /etc/systemd/system/claw-frontend.service > /dev/null << SERVICEEOF
[Unit]
Description=Claw Agent Frontend (Next.js on port ${FRONTEND_PORT})
After=network.target claw-backend.service

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=${DEPLOY_DIR}/frontend
ExecStart=$(which node) ${DEPLOY_DIR}/frontend/node_modules/.bin/next start -p ${FRONTEND_PORT}
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=API_INTERNAL_BASE_URL=http://127.0.0.1:${BACKEND_PORT}

[Install]
WantedBy=multi-user.target
SERVICEEOF

echo "  -> /etc/systemd/system/claw-backend.service"
echo "  -> /etc/systemd/system/claw-frontend.service"

# ──────────────── Step 5: Nginx 配置 ────────────────
echo "[5/5] 写入 Nginx 配置..."

sudo tee /etc/nginx/conf.d/claw.conf > /dev/null << 'NGINXEOF'
upstream claw_backend {
    server 127.0.0.1:18008;
}

upstream claw_frontend {
    server 127.0.0.1:3010;
}

server {
    listen 80;
    server_name claw.ai.accuredit.com;

    client_max_body_size 100M;

    # API -> Rust 后端
    location /v1/ {
        proxy_pass http://claw_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    # 健康检查
    location /health {
        proxy_pass http://claw_backend;
    }

    # 其他请求 -> Next.js SSR
    location / {
        proxy_pass http://claw_frontend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINXEOF

echo "  -> /etc/nginx/conf.d/claw.conf"
echo ""
echo "============================================"
echo "  后续操作:"
echo "============================================"
echo ""
echo "  1. 重载 systemd 并启动服务:"
echo "     sudo systemctl daemon-reload"
echo "     sudo systemctl enable claw-backend claw-frontend"
echo "     sudo systemctl restart claw-backend"
echo "     sudo systemctl restart claw-frontend"
echo ""
echo "  2. 测试并重载 Nginx:"
echo "     sudo nginx -t && sudo systemctl reload nginx"
echo ""
echo "  3. 初始化用户（可重复执行，已存在会跳过）:"
echo "     bash ${DEPLOY_DIR}/scripts/init_users.sh http://127.0.0.1:${BACKEND_PORT}"
echo ""
echo "  4. 验证:"
echo "     curl http://127.0.0.1:${BACKEND_PORT}/health"
echo "     curl -I http://${DOMAIN}"
echo ""
