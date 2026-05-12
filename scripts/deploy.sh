#!/usr/bin/env bash
# Claw Agent Production Deployment Guide
# Server directory: /home/users/agent/workspace/claw-code
# Frontend domain: claw.ai.accuredit.com
#
# Prerequisites:
#   - Rust toolchain (rustup)
#   - Node.js 18+ and npm
#   - Nginx
#   - DNS A record: claw.ai.accuredit.com -> server IP

set -euo pipefail

DEPLOY_DIR="/home/users/agent/workspace/claw-code"
FRONTEND_PORT=3000
BACKEND_PORT=18008
DOMAIN="claw.ai.accuredit.com"

echo "============================================"
echo "  Claw Agent Deployment"
echo "  Directory: ${DEPLOY_DIR}"
echo "  Domain:    ${DOMAIN}"
echo "============================================"
echo ""

# ─────────────────────────────────────────────
# Step 0: Directory structure
# ─────────────────────────────────────────────
echo "[0/5] Preparing directories..."
mkdir -p "${DEPLOY_DIR}/rust/data/workspaces"
mkdir -p "${DEPLOY_DIR}/logs"

# Backup database before deploy (if it exists)
DB_FILE="${DEPLOY_DIR}/rust/claw_agent.db"
if [ -f "$DB_FILE" ]; then
    cp "$DB_FILE" "${DB_FILE}.bak.$(date +%Y%m%d%H%M%S)"
    echo "  -> Backed up database to ${DB_FILE}.bak.*"
fi

# ─────────────────────────────────────────────
# Step 1: Build Rust backend
# ─────────────────────────────────────────────
echo "[1/5] Building Rust backend (release)..."
cd "${DEPLOY_DIR}/rust"
cargo build --release -p api-server 2>&1
echo "  -> Backend binary: ${DEPLOY_DIR}/rust/target/release/api-server"

# ─────────────────────────────────────────────
# Step 2: Build Next.js frontend
# ─────────────────────────────────────────────
echo "[2/5] Building Next.js frontend..."
cd "${DEPLOY_DIR}/frontend"
npm ci --production=false 2>&1
npm run build 2>&1
echo "  -> Frontend built successfully"

# ─────────────────────────────────────────────
# Step 3: Configure backend .env
# ─────────────────────────────────────────────
echo "[3/5] Checking backend .env..."
ENV_FILE="${DEPLOY_DIR}/rust/.env"
if [ ! -f "$ENV_FILE" ]; then
    cat > "$ENV_FILE" << 'ENVEOF'
PORT=18008

OPENAI_BASE_URL=http://10.50.70.91:8000/v1
OPENAI_API_KEY=Empty
OPENAI_MODEL_NAME=qwen

CLAW_WORKSPACE_ROOT=./data/workspaces
ENVEOF
    echo "  -> Created ${ENV_FILE} (edit OPENAI_API_KEY before starting)"
else
    echo "  -> ${ENV_FILE} already exists, skipping"
fi

# ─────────────────────────────────────────────
# Step 4: Write systemd service files
# ─────────────────────────────────────────────
echo "[4/5] Writing systemd service files..."

# Backend service
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

# Frontend service
sudo tee /etc/systemd/system/claw-frontend.service > /dev/null << SERVICEEOF
[Unit]
Description=Claw Agent Frontend (Next.js)
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

# ─────────────────────────────────────────────
# Step 5: Write Nginx config
# ─────────────────────────────────────────────
echo "[5/5] Writing Nginx config..."

sudo tee /etc/nginx/conf.d/claw.conf > /dev/null << 'NGINXEOF'
# Claw Agent - claw.ai.accuredit.com
# SSE support: disable proxy buffering for real-time streaming

upstream claw_frontend {
    server 127.0.0.1:3000;
}

upstream claw_backend {
    server 127.0.0.1:18008;
}

server {
    listen 80;
    server_name claw.ai.accuredit.com;

    # Uncomment after obtaining SSL certificate:
    # listen 443 ssl;
    # ssl_certificate     /etc/nginx/ssl/claw.ai.accuredit.com.crt;
    # ssl_certificate_key /etc/nginx/ssl/claw.ai.accuredit.com.key;
    # return 301 https://$host$request_uri;

    client_max_body_size 50M;

    # API endpoints -> Rust backend (direct, for SSE streaming)
    location /v1/chat/completions {
        proxy_pass http://claw_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE: disable buffering for real-time event streaming
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
        chunked_transfer_encoding on;
    }

    # All other API endpoints -> Rust backend
    location /v1/ {
        proxy_pass http://claw_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }

    # Health check
    location /health {
        proxy_pass http://claw_backend;
    }

    # Everything else -> Next.js frontend
    location / {
        proxy_pass http://claw_frontend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
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
echo "  Deployment files created. Next steps:"
echo "============================================"
echo ""
echo "  1. Edit backend env:"
echo "     vim ${DEPLOY_DIR}/rust/.env"
echo ""
echo "  2. Reload systemd and start services:"
echo "     sudo systemctl daemon-reload"
echo "     sudo systemctl enable claw-backend claw-frontend"
echo "     sudo systemctl start claw-backend"
echo "     sudo systemctl start claw-frontend"
echo ""
echo "  3. Test Nginx config and reload:"
echo "     sudo nginx -t && sudo systemctl reload nginx"
echo ""
echo "  4. Initialize users:"
echo "     bash ${DEPLOY_DIR}/scripts/init_users.sh http://127.0.0.1:${BACKEND_PORT}"
echo ""
echo "  5. Verify:"
echo "     curl http://127.0.0.1:${BACKEND_PORT}/health"
echo "     curl -I http://${DOMAIN}"
echo ""
echo "  6. (Optional) Obtain SSL certificate:"
echo "     sudo certbot --nginx -d ${DOMAIN}"
echo ""
