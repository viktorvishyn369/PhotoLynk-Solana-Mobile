#!/bin/bash
# PhotoLynk Server - StealthLynk (stealthlynk.io) Installer
# Usage (recommended): curl -fsSL https://raw.githubusercontent.com/viktorvishyn369/PhotoLynk/main/install-server-PhotoSync.sh | bash

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}$*${NC}"; }
warn() { echo -e "${YELLOW}$*${NC}"; }
err() { echo -e "${RED}$*${NC}"; }

log "╔════════════════════════════════════════════════════╗"
log "║   PhotoLynk Server Installer (stealthlynk.io)     ║"
log "╚════════════════════════════════════════════════════╝"

# Root/sudo detection
if [ "${EUID:-$(id -u)}" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

# Determine which user should run the systemd service.
# When executed with sudo, $USER may be "root".
SERVICE_USER="${SUDO_USER:-${USER:-$(whoami)}}"

DEFAULT_INSTALL_DIR="/opt/photolynk"
LEGACY_INSTALL_DIR="/opt/photosync"
INSTALL_DIR="$DEFAULT_INSTALL_DIR"

SERVICE_NAME="photolynk"

SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

ENV_DIR="/etc/${SERVICE_NAME}"
ENV_FILE="${ENV_DIR}/${SERVICE_NAME}.env"
CAPACITY_SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}-capacity.service"
CAPACITY_TIMER_FILE="/etc/systemd/system/${SERVICE_NAME}-capacity.timer"
SWEEP_SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}-sweep-expired.service"
SWEEP_TIMER_FILE="/etc/systemd/system/${SERVICE_NAME}-sweep-expired.timer"
RECONCILE_SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}-reconcile-cloud-usage.service"
RECONCILE_TIMER_FILE="/etc/systemd/system/${SERVICE_NAME}-reconcile-cloud-usage.timer"

# Storage paths for stealthlynk.io:
# - NVMe (/mnt/nvme-buffer): manifests, database, uploads, capacity (fast access)
# - RAID10 (/data/chunks): chunk storage (bulk storage)
# Prerequisites: NVMe mounted at /mnt/nvme-buffer, RAID10 available at /data

NVME_MOUNT="/mnt/nvme-buffer"
RAID_MOUNT="/data"

# Check if NVMe is mounted (required for optimal performance)
if [ -d "$NVME_MOUNT" ] && mountpoint -q "$NVME_MOUNT" 2>/dev/null; then
  # NVMe available - use optimal split storage
  UPLOAD_DIR="${NVME_MOUNT}/uploads"
  DB_PATH="${NVME_MOUNT}/db/backup.db"
  CLOUD_DIR="${NVME_MOUNT}/cloud"
  CHUNKS_DIR="${RAID_MOUNT}/chunks"
  CAPACITY_JSON_PATH="${NVME_MOUNT}/capacity/${SERVICE_NAME}-capacity.json"
  AUX_ROOT="${NVME_MOUNT}"
  USE_SPLIT_STORAGE="true"
else
  # Fallback: all on RAID or install dir
  if [ -d "$RAID_MOUNT" ]; then
    UPLOAD_DIR="${RAID_MOUNT}/uploads"
    DB_PATH="${RAID_MOUNT}/db/backup.db"
    CLOUD_DIR="${RAID_MOUNT}/cloud"
    CHUNKS_DIR="${RAID_MOUNT}/chunks"
    CAPACITY_JSON_PATH="${RAID_MOUNT}/capacity/${SERVICE_NAME}-capacity.json"
    AUX_ROOT="${RAID_MOUNT}"
  else
    UPLOAD_DIR="${INSTALL_DIR}/server/uploads"
    DB_PATH="${INSTALL_DIR}/server/backup.db"
    CLOUD_DIR="${INSTALL_DIR}/server/cloud"
    CHUNKS_DIR="${INSTALL_DIR}/server/chunks"
    CAPACITY_JSON_PATH="${INSTALL_DIR}/server/capacity/${SERVICE_NAME}-capacity.json"
    AUX_ROOT="${INSTALL_DIR}/server"
  fi
  USE_SPLIT_STORAGE="false"
fi

stop_existing_service() {
  if $SUDO systemctl list-unit-files | grep -q "^${SERVICE_NAME}\.service"; then
    $SUDO systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
  fi

  # Best-effort: stop any leftover PhotoSync node process (do not kill unrelated services)
  if command -v pkill >/dev/null 2>&1; then
    $SUDO pkill -f "${INSTALL_DIR}/server/server\.js" 2>/dev/null || true
  fi
}

ensure_cmd() {
  local cmd="$1"
  local install_hint="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "✗ Missing required command: ${cmd}"
    warn "$install_hint"
    exit 1
  fi
}

install_git_if_missing() {
  log "[1/7] Checking Git..."
  if command -v git >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Git found: $(git --version)"
    return
  fi

  warn "⚠ Git not found. Installing..."
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update -y
    $SUDO apt-get install -y git
  elif command -v dnf >/dev/null 2>&1; then
    $SUDO dnf install -y git
  elif command -v yum >/dev/null 2>&1; then
    $SUDO yum install -y git
  elif command -v pacman >/dev/null 2>&1; then
    $SUDO pacman -S --noconfirm git
  else
    err "✗ Could not install Git automatically"
    warn "Install Git manually and rerun this script."
    exit 1
  fi

  echo -e "${GREEN}✓${NC} Git installed"
}

install_node_if_missing() {
  log "[2/7] Checking Node.js..."
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Node.js found: $(node -v)"
    return
  fi

  warn "⚠ Node.js not found. Installing LTS..."
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_lts.x | $SUDO -E bash -
    $SUDO apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_lts.x | $SUDO bash -
    $SUDO dnf install -y nodejs
  elif command -v yum >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_lts.x | $SUDO bash -
    $SUDO yum install -y nodejs
  elif command -v pacman >/dev/null 2>&1; then
    $SUDO pacman -S --noconfirm nodejs npm
  else
    err "✗ Could not install Node.js automatically"
    warn "Install Node.js manually from https://nodejs.org/ and rerun this script."
    exit 1
  fi

  echo -e "${GREEN}✓${NC} Node.js installed: $(node -v)"
}

clone_or_update_repo() {
  log "[3/7] Downloading / updating PhotoLynk..."

  stop_existing_service

  REPO_URL="https://github.com/viktorvishyn369/PhotoLynk.git"
  if [ -n "${PHOTOLYNK_GITHUB_TOKEN:-}" ]; then
    REPO_URL="https://x-access-token:${PHOTOLYNK_GITHUB_TOKEN}@github.com/viktorvishyn369/PhotoLynk.git"
  elif [ -n "${GITHUB_TOKEN:-}" ]; then
    REPO_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/viktorvishyn369/PhotoLynk.git"
  fi

  if [ -d "$INSTALL_DIR/.git" ]; then
    warn "⚠ Existing repo found at $INSTALL_DIR. Updating..."
    cd "$INSTALL_DIR"
    $SUDO git remote set-url origin "$REPO_URL" >/dev/null 2>&1 || true
    GIT_TERMINAL_PROMPT=0 $SUDO git pull
  else
    if [ -d "$INSTALL_DIR" ]; then
      warn "⚠ Directory exists at $INSTALL_DIR but is not a git repo."
      warn "   Please move it aside or delete it, then rerun."
      exit 1
    fi
    GIT_TERMINAL_PROMPT=0 $SUDO git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  fi

  echo -e "${GREEN}✓${NC} Repo ready at $INSTALL_DIR"
}

install_server_deps() {
  log "[4/7] Installing server dependencies..."
  cd "$INSTALL_DIR/server"
  $SUDO npm install --production
  echo -e "${GREEN}✓${NC} Server dependencies installed"
}

write_systemd_unit() {
  log "[5/7] Configuring systemd service (${SERVICE_NAME})..."

  # Ensure storage dirs exist (important for StealthCloud)
  $SUDO mkdir -p "$UPLOAD_DIR" "$CLOUD_DIR" "$CHUNKS_DIR" "$(dirname "$CAPACITY_JSON_PATH")" "$(dirname "$DB_PATH")"
  $SUDO mkdir -p "${CLOUD_DIR}/users" "${CHUNKS_DIR}/users"

  # Default to service user ownership if possible
  $SUDO chown -R "$SERVICE_USER":"$SERVICE_USER" "$UPLOAD_DIR" "$CLOUD_DIR" 2>/dev/null || true

  $SUDO tee "$INSTALL_DIR/server/generate-capacity-json.js" > /dev/null <<'EOF'
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const sqlite3 = require('sqlite3').verbose();

const CLOUD_DIR = process.env.CLOUD_DIR;
const CAPACITY_JSON_PATH = process.env.CAPACITY_JSON_PATH;
const DB_PATH = process.env.DB_PATH;

if (!CLOUD_DIR || !CAPACITY_JSON_PATH) {
  process.exit(2);
}

const getDfValueBytes = (p, col) => {
  try {
    const out = execFileSync('df', ['-B1', `--output=${col}`, p], { encoding: 'utf8' });
    const lines = String(out).trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return null;
    const v = Number(lines[1]);
    return Number.isFinite(v) ? v : null;
  } catch (e) {
    return null;
  }
};

const getDfAvailBytes = (p) => getDfValueBytes(p, 'avail');
const getDfTotalBytes = (p) => getDfValueBytes(p, 'size');

const getAllocatedBytesFromDb = (dbPath) => {
  return new Promise((resolve) => {
    if (!dbPath || !fs.existsSync(dbPath)) return resolve([]);

    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) return resolve([]);
    });

    db.serialize(() => {
      db.all(
        `SELECT plan_gb, COUNT(*) AS cnt
           FROM user_plans
          WHERE plan_gb IS NOT NULL
            AND (deleted_at IS NULL OR deleted_at = 0)
            AND status IN ('active','grace')
          GROUP BY plan_gb`,
        [],
        (err, rows) => {
          try {
            db.close();
          } catch (e) {
          }
          if (err) return resolve([]);
          const list = Array.isArray(rows) ? rows : [];
          return resolve(list);
        }
      );
    });
  });
};

const computeReserveBytesForPlan = ({ planBytes, reservePct, reserveMinBytes, reserveMaxBytes }) => {
  const raw = Math.ceil(planBytes * reservePct);
  return Math.max(reserveMinBytes, Math.min(reserveMaxBytes, raw));
};

const computeRequiredBytesForTier = ({ tierGb, reservePct, reserveMinBytes, reserveMaxBytes }) => {
  const GB = 1000 * 1000 * 1000;
  const planBytes = Math.ceil(Number(tierGb) * GB);
  const reserveBytes = computeReserveBytesForPlan({ planBytes, reservePct, reserveMinBytes, reserveMaxBytes });
  return planBytes + reserveBytes;
};

const computeCanCreate = ({ freeBytes, totalBytes, allocatedBytes, reservePct, reserveMinBytes, reserveMaxBytes }) => {
  const GB = 1000 * 1000 * 1000;
  const SAFETY = 20 * GB;
  const tiers = [100, 200, 400, 1000];
  const canCreate = {};

  const total = typeof totalBytes === 'number' && Number.isFinite(totalBytes) ? totalBytes : 0;
  const alloc = typeof allocatedBytes === 'number' && Number.isFinite(allocatedBytes) ? allocatedBytes : 0;
  const remainingAllocBytes = Math.max(0, total - alloc - SAFETY);

  for (const tierGb of tiers) {
    const requiredBytes = computeRequiredBytesForTier({ tierGb, reservePct, reserveMinBytes, reserveMaxBytes });
    const reserved = requiredBytes + SAFETY;
    const freeOk = typeof freeBytes === 'number' && freeBytes >= reserved;
    const allocOk = remainingAllocBytes >= requiredBytes;
    canCreate[String(tierGb)] = freeOk && allocOk;
  }
  return canCreate;
};

const ensureDir = (p) => {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const main = async () => {
  ensureDir(CAPACITY_JSON_PATH);

  const GB = 1000 * 1000 * 1000;
  const SAFETY = 20 * GB;
  const RESERVE_PCT = Number(process.env.CAPACITY_RESERVE_PCT || '0.10');
  const RESERVE_MIN_BYTES = Math.ceil(Number(process.env.CAPACITY_RESERVE_MIN_GB || '5') * GB);
  const RESERVE_MAX_BYTES = Math.ceil(Number(process.env.CAPACITY_RESERVE_MAX_GB || '50') * GB);

  const freeBytes = getDfAvailBytes(CLOUD_DIR);
  const totalBytes = getDfTotalBytes(CLOUD_DIR);

  const planRows = await getAllocatedBytesFromDb(DB_PATH);
  const allocatedBytes = (Array.isArray(planRows) ? planRows : []).reduce((sum, r) => {
    const gb = r && r.plan_gb !== undefined && r.plan_gb !== null ? Number(r.plan_gb) : 0;
    const cnt = r && r.cnt !== undefined && r.cnt !== null ? Number(r.cnt) : 0;
    if (!Number.isFinite(gb) || gb <= 0) return sum;
    if (!Number.isFinite(cnt) || cnt <= 0) return sum;
    const required = computeRequiredBytesForTier({
      tierGb: gb,
      reservePct: RESERVE_PCT,
      reserveMinBytes: RESERVE_MIN_BYTES,
      reserveMaxBytes: RESERVE_MAX_BYTES,
    });
    return sum + (required * cnt);
  }, 0);

  const canCreate = computeCanCreate({
    freeBytes,
    totalBytes,
    allocatedBytes,
    reservePct: RESERVE_PCT,
    reserveMinBytes: RESERVE_MIN_BYTES,
    reserveMaxBytes: RESERVE_MAX_BYTES,
  });
  const anyAvailable = Object.values(canCreate).some(v => v === true);
  const defaultMessage = anyAvailable ? null : 'Temporarily unavailable — we\'re expanding capacity.';

  const tiers = {};
  Object.keys(canCreate).forEach((k) => {
    tiers[k] = { canCreate: !!canCreate[k] };
  });

  const payload = {
    schemaVersion: 2,
    updatedAt: Date.now(),
    freeBytes: typeof freeBytes === 'number' ? freeBytes : 0,
    totalBytes: typeof totalBytes === 'number' ? totalBytes : 0,
    allocatedBytes: Number.isFinite(allocatedBytes) ? allocatedBytes : 0,
    safetyBytes: SAFETY,
    reservePct: RESERVE_PCT,
    reserveMinBytes: RESERVE_MIN_BYTES,
    reserveMaxBytes: RESERVE_MAX_BYTES,
    canCreate,
    tiers,
    message: process.env.CAPACITY_MESSAGE ? String(process.env.CAPACITY_MESSAGE) : defaultMessage,
  };

  const tmpPath = `${CAPACITY_JSON_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload), 'utf8');
  fs.renameSync(tmpPath, CAPACITY_JSON_PATH);
};

main();
EOF

  $SUDO tee "$INSTALL_DIR/server/sweep-expired-users.js" > /dev/null <<'EOF'
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = process.env.DB_PATH;
const CLOUD_DIR = process.env.CLOUD_DIR;

if (!DB_PATH || !CLOUD_DIR) {
  process.exit(2);
}

const sanitizeKey = (value) => {
  const s = (value || '').toString();
  const safe = s.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
  return safe || null;
};

const removeDirSafe = (dirPath) => {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
    return true;
  } catch (e) {
    return false;
  }
};

const main = () => {
  const now = Date.now();
  const db = new sqlite3.Database(DB_PATH);

  db.serialize(() => {
    db.all(
      `SELECT up.user_id,
              up.grace_until,
              u.user_uuid AS user_uuid,
              GROUP_CONCAT(d.device_uuid, ',') AS device_uuids
         FROM user_plans up
         LEFT JOIN users u ON u.id = up.user_id
         LEFT JOIN devices d ON d.user_id = up.user_id
        WHERE up.status = 'grace'
          AND up.grace_until IS NOT NULL
          AND up.grace_until <= ?
          AND (up.deleted_at IS NULL OR up.deleted_at = 0)
        GROUP BY up.user_id`,
      [now],
      (err, rows) => {
        if (err) {
          db.close();
          process.exit(1);
          return;
        }

        const list = Array.isArray(rows) ? rows : [];
        list.forEach((r) => {
          const userId = r && r.user_id ? r.user_id : null;
          if (!userId) return;

          const keys = new Set();
          keys.add(String(userId));

          const userUuidKey = sanitizeKey(r.user_uuid);
          if (userUuidKey) keys.add(userUuidKey);

          const deviceUuids = (r && r.device_uuids ? String(r.device_uuids) : '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

          deviceUuids.forEach((du) => {
            const k = sanitizeKey(du);
            if (k) keys.add(k);
          });

          keys.forEach((k) => {
            const userDir = path.join(CLOUD_DIR, 'users', k);
            removeDirSafe(userDir);
          });

          db.run(
            `DELETE FROM cloud_chunks WHERE user_id = ?`,
            [userId]
          );

          db.run(
            `UPDATE user_plans
                SET status = 'deleted',
                    deleted_at = ?,
                    updated_at = ?
              WHERE user_id = ?`,
            [now, now, userId]
          );
        });

        db.close();
      }
    );
  });
};

main();
EOF

  $SUDO tee "$INSTALL_DIR/server/reconcile-cloud-usage.js" > /dev/null <<'EOF'
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = process.env.DB_PATH;
const CLOUD_DIR = process.env.CLOUD_DIR;

if (!DB_PATH || !CLOUD_DIR) {
  process.exit(2);
}

const sanitizeKey = (value) => {
  const s = (value || '').toString();
  const safe = s.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
  return safe || null;
};

const isValidChunkId = (name) => /^[a-f0-9]{64}$/i.test(String(name || ''));

const main = () => {
  const usersRoot = path.join(CLOUD_DIR, 'users');
  if (!fs.existsSync(usersRoot)) {
    process.exit(0);
  }

  const now = Date.now();
  const db = new sqlite3.Database(DB_PATH);

  db.serialize(() => {
    db.run(`PRAGMA journal_mode=WAL`);
    db.run(`PRAGMA synchronous=NORMAL`);
    db.run(`PRAGMA busy_timeout=5000`);

    db.all(
      `SELECT u.id AS user_id,
              u.user_uuid AS user_uuid,
              GROUP_CONCAT(d.device_uuid, ',') AS device_uuids
         FROM users u
         LEFT JOIN devices d ON d.user_id = u.id
        GROUP BY u.id`,
      [],
      (err, rows) => {
        if (err) {
          db.close();
          process.exit(1);
          return;
        }

        const list = Array.isArray(rows) ? rows : [];

        list.forEach((r) => {
          const userId = r && r.user_id ? r.user_id : null;
          if (!userId) return;

          const keys = new Set();
          keys.add(String(userId));

          const userUuidKey = sanitizeKey(r.user_uuid);
          if (userUuidKey) keys.add(userUuidKey);

          const deviceUuids = (r && r.device_uuids ? String(r.device_uuids) : '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

          deviceUuids.forEach((du) => {
            const k = sanitizeKey(du);
            if (k) keys.add(k);
          });

          let userDir = null;
          for (const k of keys) {
            const candidate = path.join(usersRoot, k);
            if (fs.existsSync(candidate)) {
              userDir = candidate;
              break;
            }
          }
          if (!userDir) return;

          const chunksDir = path.join(userDir, 'chunks');
          if (!fs.existsSync(chunksDir)) return;

          let files;
          try {
            files = fs.readdirSync(chunksDir);
          } catch (e) {
            return;
          }

          const seen = new Set();

          files
            .filter((f) => !String(f).startsWith('.'))
            .filter(isValidChunkId)
            .forEach((chunkId) => {
              const chunkPath = path.join(chunksDir, chunkId);
              try {
                const st = fs.statSync(chunkPath);
                if (!st.isFile()) return;
                const size = Number(st.size);
                if (!Number.isFinite(size) || size <= 0) return;

                seen.add(chunkId);
                db.run(
                  `INSERT INTO cloud_chunks (user_id, chunk_id, size, created_at)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(user_id, chunk_id) DO UPDATE SET
                     size=excluded.size`,
                  [userId, chunkId, size, now]
                );
              } catch (e) {
                return;
              }
            });

          db.all(
            `SELECT chunk_id FROM cloud_chunks WHERE user_id = ?`,
            [userId],
            (e2, rows2) => {
              if (e2) return;
              const dbChunks = Array.isArray(rows2) ? rows2 : [];
              dbChunks.forEach((row) => {
                const cid = row && row.chunk_id ? String(row.chunk_id) : '';
                if (!cid) return;
                if (!seen.has(cid)) {
                  db.run(
                    `DELETE FROM cloud_chunks WHERE user_id = ? AND chunk_id = ?`,
                    [userId, cid]
                  );
                }
              });
            }
          );
        });

        setTimeout(() => {
          db.close();
        }, 500);
      }
    );
  });
};

main();
EOF

  $SUDO chmod 644 "$INSTALL_DIR/server/generate-capacity-json.js" "$INSTALL_DIR/server/sweep-expired-users.js" "$INSTALL_DIR/server/reconcile-cloud-usage.js" 2>/dev/null || true
  $SUDO chown "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR/server/generate-capacity-json.js" "$INSTALL_DIR/server/sweep-expired-users.js" "$INSTALL_DIR/server/reconcile-cloud-usage.js" 2>/dev/null || true

  $SUDO tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=PhotoLynk Server (stealthlynk.io)
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR/server
Environment="UPLOAD_DIR=$UPLOAD_DIR"
Environment="DB_PATH=$DB_PATH"
Environment="CLOUD_DIR=$CLOUD_DIR"
Environment="CHUNKS_DIR=$CHUNKS_DIR"
Environment="CAPACITY_JSON_PATH=$CAPACITY_JSON_PATH"
Environment="PHOTOSYNC_DATA_DIR=$AUX_ROOT"
ExecStart=$(which node) server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF

  $SUDO mkdir -p "$ENV_DIR"
  $SUDO tee "$ENV_FILE" > /dev/null <<EOF
CLOUD_DIR=$CLOUD_DIR
CHUNKS_DIR=$CHUNKS_DIR
DB_PATH=$DB_PATH
CAPACITY_JSON_PATH=$CAPACITY_JSON_PATH
PHOTOSYNC_DATA_DIR=$AUX_ROOT
SUBSCRIPTION_GRACE_DAYS=10
REVENUECAT_WEBHOOK_SECRET=
EOF
  $SUDO chmod 600 "$ENV_FILE" 2>/dev/null || true
  $SUDO chown root:root "$ENV_FILE" 2>/dev/null || true

  $SUDO tee "$CAPACITY_SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=PhotoLynk Capacity JSON Generator
After=network.target

[Service]
Type=oneshot
WorkingDirectory=$INSTALL_DIR/server
EnvironmentFile=-$ENV_FILE
ExecStart=/usr/bin/env node $INSTALL_DIR/server/generate-capacity-json.js
EOF

  $SUDO tee "$CAPACITY_TIMER_FILE" > /dev/null <<EOF
[Unit]
Description=Run PhotoLynk capacity generator periodically

[Timer]
OnBootSec=30s
OnUnitActiveSec=2min
Unit=${SERVICE_NAME}-capacity.service

[Install]
WantedBy=timers.target
EOF

  $SUDO tee "$RECONCILE_SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=PhotoLynk StealthCloud Usage Reconciler
After=network.target

[Service]
Type=oneshot
WorkingDirectory=$INSTALL_DIR/server
EnvironmentFile=-$ENV_FILE
ExecStart=/usr/bin/env node $INSTALL_DIR/server/reconcile-cloud-usage.js
EOF

  $SUDO tee "$RECONCILE_TIMER_FILE" > /dev/null <<EOF
[Unit]
Description=Run PhotoLynk StealthCloud usage reconciler periodically

[Timer]
OnBootSec=3min
OnUnitActiveSec=15min
Unit=${SERVICE_NAME}-reconcile-cloud-usage.service

[Install]
WantedBy=timers.target
EOF

  $SUDO tee "$SWEEP_SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=PhotoLynk Sweeper (delete users after grace period)
After=network.target

[Service]
Type=oneshot
WorkingDirectory=$INSTALL_DIR/server
EnvironmentFile=-$ENV_FILE
ExecStart=/usr/bin/env node $INSTALL_DIR/server/sweep-expired-users.js
EOF

  $SUDO tee "$SWEEP_TIMER_FILE" > /dev/null <<EOF
[Unit]
Description=Run PhotoLynk sweeper periodically

[Timer]
OnBootSec=2min
OnUnitActiveSec=30min
Unit=${SERVICE_NAME}-sweep-expired.service

[Install]
WantedBy=timers.target
EOF

  $SUDO systemctl daemon-reload
  $SUDO systemctl enable "$SERVICE_NAME"
  $SUDO systemctl restart "$SERVICE_NAME"

  # Run capacity generator at least once now, then enable periodic updates
  $SUDO systemctl enable "${SERVICE_NAME}-capacity.timer"
  $SUDO systemctl restart "${SERVICE_NAME}-capacity.timer"
  $SUDO systemctl start "${SERVICE_NAME}-capacity.service" || true

  # Enable periodic sweeper (deletes data after grace period)
  $SUDO systemctl enable "${SERVICE_NAME}-sweep-expired.timer"
  $SUDO systemctl restart "${SERVICE_NAME}-sweep-expired.timer"
  $SUDO systemctl start "${SERVICE_NAME}-sweep-expired.service" || true

  # Enable periodic usage reconciliation (fixes drift between FS and DB)
  $SUDO systemctl enable "${SERVICE_NAME}-reconcile-cloud-usage.timer"
  $SUDO systemctl restart "${SERVICE_NAME}-reconcile-cloud-usage.timer"
  $SUDO systemctl start "${SERVICE_NAME}-reconcile-cloud-usage.service" || true

  echo -e "${GREEN}✓${NC} systemd service installed: $SERVICE_FILE"
}

install_admin_tools() {
  log "[6/7] Installing admin monitoring tools..."

  if command -v apt-get >/dev/null 2>&1; then
    # Optional tooling for better observability (script still works without them)
    # apt can be busy (unattended-upgrades/apt-daily). Don't fail the installer if it's locked.
    $SUDO apt-get -o DPkg::Lock::Timeout=120 update -y >/dev/null 2>&1 \
      || warn "⚠ apt-get update failed or timed out (apt locked). Skipping optional admin packages."

    $SUDO apt-get -o DPkg::Lock::Timeout=120 install -y sysstat nload iftop inotify-tools jq >/dev/null 2>&1 \
      || warn "⚠ apt-get install failed or timed out (apt locked). Admin script will still work with reduced features."
  else
    warn "⚠ Skipping optional package install (only apt-get is supported here)."
  fi

  local ADMIN_DIR="/root/ADMIN_PHOTOLYNK"
  local ADMIN_SCRIPT="${ADMIN_DIR}/photolynk-admin.sh"
  $SUDO mkdir -p "$ADMIN_DIR" "${ADMIN_DIR}/logs"

  $SUDO tee "$ADMIN_SCRIPT" > /dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

ADMIN_DIR="/root/ADMIN_PHOTOLYNK"
LOG_DIR="${ADMIN_DIR}/logs"
mkdir -p "$LOG_DIR"

SERVICE_NAME="photolynk"
if command -v systemctl >/dev/null 2>&1; then
  if systemctl list-unit-files 2>/dev/null | grep -q '^photosync\.service'; then
    SERVICE_NAME="photosync"
  fi
fi

ts() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

human_bytes() {
  local b="${1:-0}"
  if ! [[ "$b" =~ ^[0-9]+$ ]]; then echo "$b"; return; fi
  awk -v b="$b" 'BEGIN{
    split("B KB MB GB TB PB",u," ");
    for(i=1; b>=1024 && i<6; i++) b/=1024;
    printf("%.2f %s", b, u[i]);
  }'
}

get_service_env() {
  local out
  out="$(systemctl show "${SERVICE_NAME}" -p Environment 2>/dev/null || true)"
  out="${out#Environment=}"
  echo "$out"
}

env_get() {
  local key="$1"
  local envline="$2"
  printf '%s\n' "$envline" | tr ' ' '\n' | awk -F= -v k="$key" '$1==k{print substr($0,index($0,"=")+1)}' | tail -n 1
}

net_bytes_total() {
  awk -F: 'NR>2{gsub(/^[ \t]+/,"",$2); split($2,a," "); rx+=a[1]; tx+=a[9]} END{printf "%d %d\n", rx, tx}' /proc/net/dev 2>/dev/null || echo "0 0"
}

list_connections_port() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -nt "sport = :${port}" 2>/dev/null | awk 'NR>1{print $5}' | cut -d: -f1 | sort | uniq -c | sort -nr || true
  fi
}

find_nginx_access_log() {
  local candidates=()
  [ -f "/var/log/nginx/access.log" ] && candidates+=("/var/log/nginx/access.log")
  # Prefer the most recently modified access log if present
  if [ -d "/var/log/nginx" ]; then
    while IFS= read -r f; do
      [ -f "$f" ] && candidates+=("$f")
    done < <(ls -1t /var/log/nginx/*access*.log 2>/dev/null || true)
  fi

  # De-dup while keeping order
  local seen="|"
  for f in "${candidates[@]}"; do
    if [[ "$seen" != *"|$f|"* ]]; then
      echo "$f"
      return
    fi
    seen+="$f|"
  done
}

nginx_recent_api_summary() {
  local lines="${1:-2000}"
  local log
  log="$(find_nginx_access_log || true)"
  if [ -z "${log:-}" ] || [ ! -f "$log" ]; then
    echo "nginx access log not found under /var/log/nginx (cannot show real client IPs)."
    return
  fi

  echo "nginx access log: $log"
  echo "Recent /api activity (approx last ${lines} lines):"
  # Works with default nginx 'combined' log format.
  # Example: 1.2.3.4 - - [18/Dec/2025:10:00:00 +0000] "POST /api/cloud/chunks HTTP/1.1" 200 92 "-" "ua"
  tail -n "$lines" "$log" 2>/dev/null \
    | awk '
      BEGIN{IGNORECASE=1}
      {
        ip=$1;
        if($0 ~ /\"(GET|POST|PUT|PATCH|DELETE) \/api\//){
          # extract method + path
          match($0, /\"(GET|POST|PUT|PATCH|DELETE) ([^ ]+)/, m);
          method=m[1]; path=m[2];
          key=ip " " method " " path;
          cnt_ip[ip]++;
          cnt_ep[method " " path]++;
          cnt_key[key]++;
        }
      }
      END{
        print "  Top client IPs:";
        for(i in cnt_ip) print cnt_ip[i], i | "sort -nr | head -n 10";
        close("sort -nr | head -n 10");
        print "";
        print "  Top endpoints:";
        for(e in cnt_ep) print cnt_ep[e], e | "sort -nr | head -n 12";
        close("sort -nr | head -n 12");
      }'
}

zfs_pool_from_path() {
  local p="$1"
  if command -v zfs >/dev/null 2>&1; then
    zfs list -H -o name,mountpoint 2>/dev/null | awk -v p="$p" '$2==p{print $1}' | head -n 1
  fi
}

zpool_from_fs_path() {
  local p="$1"
  local ds
  ds="$(zfs list -H -o name,mountpoint 2>/dev/null | awk -v p="$p" '$2==p{print $1}' | head -n 1)"
  if [ -z "${ds:-}" ]; then
    # try parent mountpoints
    local cur="$p"
    while [ "$cur" != "/" ] && [ -n "$cur" ]; do
      ds="$(zfs list -H -o name,mountpoint 2>/dev/null | awk -v p="$cur" '$2==p{print $1}' | head -n 1)"
      [ -n "${ds:-}" ] && break
      cur="$(dirname "$cur")"
    done
  fi
  if [ -n "${ds:-}" ]; then
    echo "$ds" | awk -F/ '{print $1}'
  fi
}

dir_stats() {
  local label="$1"
  local path="$2"
  if [ ! -d "$path" ]; then
    printf '%s: (missing) %s\n' "$label" "$path"
    return
  fi

  local bytes files dirs
  bytes="$(du -sb "$path" 2>/dev/null | awk '{print $1}' || true)"
  if [ -z "${bytes:-}" ]; then
    bytes="$(du -sk "$path" 2>/dev/null | awk '{print $1*1024}' || echo 0)"
  fi
  files="$(find "$path" -type f 2>/dev/null | wc -l | tr -d ' ' || echo 0)"
  dirs="$(find "$path" -type d 2>/dev/null | wc -l | tr -d ' ' || echo 0)"
  printf '%s: %s | files=%s dirs=%s | %s\n' "$label" "$path" "$files" "$dirs" "$(human_bytes "$bytes")"
}

recent_activity() {
  local label="$1"
  local path="$2"
  local minutes="${3:-10}"
  if [ ! -d "$path" ]; then
    return
  fi
  echo "Recent activity (${label}, last ${minutes}m):"
  find "$path" -type f -mmin "-${minutes}" -printf '%TY-%Tm-%Td %TH:%TM:%TSZ\t%s\t%p\n' 2>/dev/null \
    | head -n 60 \
    | awk '{size=$2; $2=""; sub(/^ /, ""); printf("  %s\t%s\t%s\n", $1, size, $0)}'
}

cloud_user_stats() {
  local cloud_dir="$1"
  local users_root="$cloud_dir/users"
  if [ ! -d "$users_root" ]; then
    echo "Cloud users dir missing: $users_root"
    return
  fi
  echo "StealthCloud per-user usage:"
  for u in "$users_root"/*; do
    [ -d "$u" ] || continue
    local key
    key="$(basename "$u")"
    local chunks_dir="$u/chunks"
    local manifests_dir="$u/manifests"
    local chunks_bytes=0 chunks_files=0 manifests_files=0
    if [ -d "$chunks_dir" ]; then
      chunks_bytes="$(du -sb "$chunks_dir" 2>/dev/null | awk '{print $1}' || true)"
      [ -z "${chunks_bytes:-}" ] && chunks_bytes="$(du -sk "$chunks_dir" 2>/dev/null | awk '{print $1*1024}' || echo 0)"
      chunks_files="$(find "$chunks_dir" -type f 2>/dev/null | wc -l | tr -d ' ' || echo 0)"
    fi
    if [ -d "$manifests_dir" ]; then
      manifests_files="$(find "$manifests_dir" -type f 2>/dev/null | wc -l | tr -d ' ' || echo 0)"
    fi
    printf '  user=%s | chunks=%s (%s) | manifests=%s | path=%s\n' "$key" "$chunks_files" "$(human_bytes "$chunks_bytes")" "$manifests_files" "$u"
  done
}

recent_service_requests() {
  local minutes="${1:-10}"
  if ! command -v journalctl >/dev/null 2>&1; then
    return
  fi
  echo "Recent requests (last ${minutes}m):"
  journalctl -u "${SERVICE_NAME}" --since "${minutes} minutes ago" --no-pager 2>/dev/null \
    | grep -E "POST /api/|GET /api/|\[SC\]" \
    | tail -n 80 \
    | sed 's/^/  /'
}

snapshot() {
  local tag="${1:-snapshot}"
  local out_file="${LOG_DIR}/photolynk-${tag}-$(date -u '+%Y%m%d-%H%M%S').log"

  local envline upload_dir cloud_dir db_path
  envline="$(get_service_env)"
  upload_dir="$(env_get UPLOAD_DIR "$envline")"
  cloud_dir="$(env_get CLOUD_DIR "$envline")"
  db_path="$(env_get DB_PATH "$envline")"

  {
    echo "=== PhotoLynk Admin Snapshot ==="
    echo "time: $(ts)"
    echo
    echo "Service env:"
    echo "  UPLOAD_DIR=${upload_dir:-}"
    echo "  CLOUD_DIR=${cloud_dir:-}"
    echo "  DB_PATH=${db_path:-}"
    echo
    echo "Edge connections to :443 (by source IP):"
    list_connections_port 443 | sed 's/^/  /' || true
    echo

    echo "App connections to :3000 (by source IP):"
    list_connections_port 3000 | sed 's/^/  /' || true
    echo

    nginx_recent_api_summary 2000 | sed 's/^/  /' || true
    echo

    echo "Network throughput (total, all interfaces):"
    read -r rx1 tx1 < <(net_bytes_total)
    sleep 1
    read -r rx2 tx2 < <(net_bytes_total)
    local rxps=$((rx2-rx1))
    local txps=$((tx2-tx1))
    echo "  rx: $(human_bytes "$rxps")/s"
    echo "  tx: $(human_bytes "$txps")/s"
    echo

    if command -v zpool >/dev/null 2>&1 && [ -n "${cloud_dir:-}" ]; then
      local pool
      pool="$(zpool_from_fs_path "$cloud_dir" || true)"
      if [ -n "${pool:-}" ]; then
        echo "ZFS pool iostat (${pool}, 1s):"
        zpool iostat -v "$pool" 1 2>/dev/null | sed 's/^/  /' || true
        echo
      fi
    fi

    dir_stats "UPLOAD_DIR" "${upload_dir:-}" || true
    dir_stats "CLOUD_DIR" "${cloud_dir:-}" || true
    if [ -n "${db_path:-}" ]; then
      if [ -f "$db_path" ]; then
        echo "DB_PATH: $db_path | size=$(human_bytes "$(stat -c %s "$db_path" 2>/dev/null || echo 0)")"
      else
        echo "DB_PATH: (missing) $db_path"
      fi
    fi
    echo

    if [ -n "${cloud_dir:-}" ]; then
      cloud_user_stats "$cloud_dir" || true
      echo
    fi

    if [ -n "${upload_dir:-}" ]; then
      recent_activity "uploads" "$upload_dir" 10 || true
      echo
    fi
    if [ -n "${cloud_dir:-}" ]; then
      recent_activity "cloud" "$cloud_dir" 10 || true
      echo
    fi

    recent_service_requests 10 || true
    echo
    echo "output_file: $out_file"
  } | tee "$out_file" >/dev/null

  echo "$out_file"
}

watch_fs() {
  local envline upload_dir cloud_dir
  envline="$(get_service_env)"
  upload_dir="$(env_get UPLOAD_DIR "$envline")"
  cloud_dir="$(env_get CLOUD_DIR "$envline")"

  local out_file="${LOG_DIR}/photolynk-watch-$(date -u '+%Y%m%d-%H%M%S').log"
  echo "Watching filesystem events. Writing to: $out_file"
  echo "(Ctrl+C to stop)"

  if ! command -v inotifywait >/dev/null 2>&1; then
    echo "inotifywait not found. Install: apt-get install -y inotify-tools" | tee -a "$out_file"
    exit 2
  fi

  {
    echo "=== PhotoLynk FS Watch ==="
    echo "time: $(ts)"
    echo "UPLOAD_DIR=${upload_dir:-}"
    echo "CLOUD_DIR=${cloud_dir:-}"
  } | tee -a "$out_file" >/dev/null

  local paths=()
  [ -n "${upload_dir:-}" ] && [ -d "$upload_dir" ] && paths+=("$upload_dir")
  [ -n "${cloud_dir:-}" ] && [ -d "$cloud_dir" ] && paths+=("$cloud_dir")

  if [ ${#paths[@]} -eq 0 ]; then
    echo "No valid paths to watch." | tee -a "$out_file"
    exit 0
  fi

  inotifywait -m -r -e create,modify,close_write,move,delete --format '%T\t%e\t%w%f' --timefmt '%Y-%m-%d %H:%M:%S' "${paths[@]}" 2>/dev/null \
    | awk '{print "  " $0}' \
    | tee -a "$out_file" >/dev/null
}

usage() {
  cat <<USAGE
Usage:
  photolynk-admin.sh snapshot            # write one snapshot report to /root/ADMIN_PHOTOLYNK/logs
  photolynk-admin.sh watch               # watch filesystem events (requires inotify-tools)
USAGE
}

cmd="${1:-snapshot}"
case "$cmd" in
  snapshot)
    snapshot "snapshot" >/dev/null
    ;;
  watch)
    watch_fs
    ;;
  *)
    usage
    exit 1
    ;;
esac
EOF

  $SUDO chmod 700 "$ADMIN_SCRIPT" 2>/dev/null || true
  echo -e "${GREEN}✓${NC} Admin tools installed: $ADMIN_SCRIPT"
}

install_nginx() {
  log "[7/8] Installing and configuring Nginx..."
  
  if ! command -v nginx >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      $SUDO apt-get update -y
      $SUDO apt-get install -y nginx
    elif command -v dnf >/dev/null 2>&1; then
      $SUDO dnf install -y nginx
    elif command -v yum >/dev/null 2>&1; then
      $SUDO yum install -y nginx
    else
      warn "⚠ Could not install nginx automatically. Please install manually."
      return
    fi
  fi

  # Create nginx config for PhotoLynk
  $SUDO tee /etc/nginx/sites-available/photosync > /dev/null <<'NGINXEOF'
server {
    listen 80;
    server_name stealthlynk.io;

    client_max_body_size 500M;
    client_body_timeout 300s;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
    }
}
NGINXEOF

  # Enable the site
  $SUDO ln -sf /etc/nginx/sites-available/photosync /etc/nginx/sites-enabled/
  $SUDO rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

  # Test and restart nginx
  if $SUDO nginx -t; then
    $SUDO systemctl restart nginx
    $SUDO systemctl enable nginx
    echo -e "${GREEN}✓${NC} Nginx installed and configured"
  else
    err "✗ Nginx configuration test failed"
  fi
}

open_firewall_if_present() {
  log "[8/8] Firewall configuration (port 80)..."
  if command -v ufw >/dev/null 2>&1; then
    $SUDO ufw allow 3000/tcp
    echo -e "${GREEN}✓${NC} UFW: Port 3000 opened"
  elif command -v firewall-cmd >/dev/null 2>&1; then
    $SUDO firewall-cmd --permanent --add-port=3000/tcp
    $SUDO firewall-cmd --reload
    echo -e "${GREEN}✓${NC} Firewalld: Port 3000 opened"
  else
    warn "⚠ No firewall tool detected (ufw/firewalld). Skipping."
  fi
}

# --- Run ---
install_git_if_missing
install_node_if_missing
ensure_cmd curl "Install curl and rerun."

clone_or_update_repo
install_server_deps
write_systemd_unit
install_admin_tools
install_nginx
open_firewall_if_present

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ PhotoLynk Server installed and running${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}Service:${NC}"
echo -e "  Status:  ${YELLOW}sudo systemctl status ${SERVICE_NAME}${NC}"
echo -e "  Logs:    ${YELLOW}sudo journalctl -u ${SERVICE_NAME} -f${NC}"
echo ""
echo -e "${BLUE}Storage paths (stealthlynk.io):${NC}"
echo -e "  UPLOAD_DIR:  ${YELLOW}$UPLOAD_DIR${NC}"
echo -e "  CLOUD_DIR:   ${YELLOW}$CLOUD_DIR${NC} (manifests on NVMe)"
echo -e "  CHUNKS_DIR:  ${YELLOW}$CHUNKS_DIR${NC} (chunks on RAID10)"
echo -e "  DB_PATH:     ${YELLOW}$DB_PATH${NC}"
if [ "$USE_SPLIT_STORAGE" = "true" ]; then
  echo -e "  ${GREEN}✓ Split storage enabled: NVMe + RAID10${NC}"
else
  echo -e "  ${YELLOW}⚠ Single storage mode (NVMe not detected at /mnt/nvme-buffer)${NC}"
fi
echo ""
echo -e "${BLUE}Admin tools:${NC}"
echo -e "  Snapshot report: ${YELLOW}sudo /root/ADMIN_PHOTOLYNK/photolynk-admin.sh snapshot${NC}"
echo -e "  Live FS watch:   ${YELLOW}sudo /root/ADMIN_PHOTOLYNK/photolynk-admin.sh watch${NC}"
echo ""
echo -e "${BLUE}Note:${NC} Nginx/Cloudflare tunnel should proxy https://stealthlynk.io/api/* to this service on :3000."
