#!/usr/bin/env bash
# Usage: sudo bash scripts/server_update.sh
# Safe one-command update for a live Hostinger (or any Linux) deployment.
# Stops the app service, backs up the DB, checks integrity (recovers if needed),
# pulls code, fixes .env, migrates, then restarts.
set -euo pipefail

APP_NAME="${APP_NAME:-curevice}"
APP_DIR="${APP_DIR:-/root/${APP_NAME}}"
BRANCH="${BRANCH:-feature/nvn}"
PYTHON="${APP_DIR}/.venv/bin/python"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash scripts/server_update.sh"
  exit 1
fi

echo "==> [1/8] Stopping ${APP_NAME} service (prevents SQLite lock during migrate)"
systemctl stop "${APP_NAME}" 2>/dev/null || true

# ──────────────────────────────────────────────────────────────────────────────
echo "==> [2/8] Backing up SQLite database"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${APP_DIR}/backups/db-${STAMP}"
mkdir -p "${BACKUP_DIR}"
for f in db.sqlite3 db.sqlite3-wal db.sqlite3-shm; do
  if [[ -f "${APP_DIR}/${f}" ]]; then
    cp -a "${APP_DIR}/${f}" "${BACKUP_DIR}/${f}"
    echo "   backed up ${f}"
  fi
done

# ──────────────────────────────────────────────────────────────────────────────
echo "==> [3/8] Checking SQLite integrity (recovering if malformed)"
DB_PATH="${APP_DIR}/db.sqlite3"
if [[ -f "${DB_PATH}" ]]; then
  # Checkpoint WAL so all pages are in the main file before we check / dump
  sqlite3 "${DB_PATH}" "PRAGMA wal_checkpoint(TRUNCATE);" 2>/dev/null || true

  INTEGRITY="$(sqlite3 "${DB_PATH}" "PRAGMA integrity_check;" 2>&1 | head -1 || echo "error")"
  if [[ "${INTEGRITY}" == "ok" ]]; then
    echo "   Integrity: OK"
  else
    echo "   WARNING: Integrity check failed: ${INTEGRITY}"
    echo "   Attempting recovery via .dump → reload ..."
    RECOVER="${APP_DIR}/db_recover_${STAMP}.sqlite3"
    if sqlite3 "${DB_PATH}" ".dump" 2>/dev/null | sqlite3 "${RECOVER}" 2>/dev/null; then
      # Verify recovered file looks sane
      INTEGRITY2="$(sqlite3 "${RECOVER}" "PRAGMA integrity_check;" 2>&1 | head -1 || echo "error")"
      if [[ "${INTEGRITY2}" == "ok" ]]; then
        mv "${DB_PATH}" "${BACKUP_DIR}/db_corrupted_${STAMP}.sqlite3"
        mv "${RECOVER}" "${DB_PATH}"
        echo "   Recovery successful — original saved to ${BACKUP_DIR}/db_corrupted_${STAMP}.sqlite3"
      else
        rm -f "${RECOVER}"
        echo "   ERROR: Recovered database also failed integrity check."
        echo "   Manual intervention required. Backup: ${BACKUP_DIR}"
        systemctl start "${APP_NAME}" 2>/dev/null || true
        exit 1
      fi
    else
      rm -f "${RECOVER}" 2>/dev/null || true
      echo "   ERROR: .dump / recovery failed. Manual intervention required."
      echo "   Backup: ${BACKUP_DIR}"
      systemctl start "${APP_NAME}" 2>/dev/null || true
      exit 1
    fi
  fi
else
  echo "   No db.sqlite3 found — will be created fresh on first migrate"
fi

# ──────────────────────────────────────────────────────────────────────────────
echo "==> [4/8] Pulling latest code (${BRANCH})"
git -C "${APP_DIR}" fetch origin
git -C "${APP_DIR}" pull --ff-only origin "${BRANCH}"

# ──────────────────────────────────────────────────────────────────────────────
echo "==> [5/8] Fixing .env (multi-line CORS and other known issues)"
python3 - <<'PY'
import os, re, sys
app_dir = os.environ.get("APP_DIR", "/root/curevice")
env_path = os.path.join(app_dir, ".env")
if not os.path.exists(env_path):
    sys.exit(0)
text = open(env_path, encoding="utf-8").read()
changed = False

# Convert multi-line Python list values to comma-separated single lines.
# Handles any KEY = [\n  "val"\n] pattern, not just CORS.
def flatten_list(m):
    key = m.group(1).strip()
    values = re.findall(r'["\']([^"\']+)["\']', m.group(2))
    return f"{key}={','.join(values)}"

new_text = re.sub(
    r'^([\w]+)\s*=\s*\[([^\]]*)\]',
    flatten_list,
    text,
    flags=re.MULTILINE | re.DOTALL,
)
if new_text != text:
    open(env_path, "w", encoding="utf-8").write(new_text)
    print("   Fixed multi-line list values in .env")
else:
    print("   .env looks OK — no changes needed")
PY

# ──────────────────────────────────────────────────────────────────────────────
echo "==> [6/8] Installing / updating Python dependencies"
"${APP_DIR}/.venv/bin/pip" install -q --upgrade pip wheel
"${APP_DIR}/.venv/bin/pip" install -q -r "${APP_DIR}/requirements.txt"

# ──────────────────────────────────────────────────────────────────────────────
echo "==> [7/8] Running migrations and collecting static files"
# NOTE: Only 'migrate' is run here — NOT 'makemigrations'.
# makemigrations should only be run by developers when changing models.
# Running it on a server with a live database causes spurious migration files
# and can corrupt migration history.
"${PYTHON}" "${APP_DIR}/manage.py" migrate --noinput
"${PYTHON}" "${APP_DIR}/manage.py" collectstatic --noinput

# ──────────────────────────────────────────────────────────────────────────────
echo "==> [8/8] Restarting ${APP_NAME} service"
systemctl start "${APP_NAME}"
systemctl is-active "${APP_NAME}" \
  && echo "   Service is running OK" \
  || echo "   WARNING: service did not start — check: journalctl -u ${APP_NAME} -n 50"

echo ""
echo "Update complete. DB backed up to: ${BACKUP_DIR}"
