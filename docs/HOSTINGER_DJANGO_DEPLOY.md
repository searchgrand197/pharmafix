# Hostinger Deployment (Django + Gunicorn + Nginx)

This project can be deployed as a Django app on a Hostinger VPS using one script.

## 1) VPS prerequisites

- Ubuntu 22.04/24.04 VPS
- Root/sudo access
- Domain pointed to VPS IP (A record)

## 2) Run deployment script

From your project folder on the server:

```bash
sudo APP_NAME=curevice \
APP_USER=curevice \
APP_DIR=/srv/curevice \
REPO_URL="https://healthcare_curevice-admin@bitbucket.org/healthcare_curevice/curevice.git" \
BRANCH=feature/nvn \
DOMAIN=yourdomain.com \
DJANGO_ENV=production \
bash scripts/deploy_hostinger.sh
```

What the script does:

- installs `nginx`, python/venv/build deps
- creates app user
- clones/pulls branch
- creates `.venv` and installs `requirements.txt`
- creates `.env` from `.env.example` and patches production-safe defaults
- runs migrations + collectstatic
- builds frontend (`npm ci && npm run build`) if `npm` is installed
- creates and enables:
  - systemd service: `curevice.service` (gunicorn)
  - nginx site: `/etc/nginx/sites-available/curevice`

## 3) Check services

```bash
sudo systemctl status curevice --no-pager
sudo systemctl status nginx --no-pager
sudo journalctl -u curevice -n 200 --no-pager
```

## 4) HTTPS (recommended)

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

## 5) Update deployment after new code push

**Safe update order (required):** backup DB → pull code only → migrate → restart.

Never run `git reset --hard` on a live Hostinger/VPS checkout: it can overwrite or desync `db.sqlite3` (+ `-wal`/`-shm`) and corrupt client data. SQLite DB files are gitignored and must not be committed.

```bash
cd /srv/curevice
# 1) Backup live SQLite (skip if using Postgres)
sudo -u curevice mkdir -p backups
STAMP=$(date +%Y%m%d-%H%M%S)
sudo -u curevice bash -lc 'mkdir -p backups/db-'"$STAMP"' && cp -a db.sqlite3* backups/db-'"$STAMP"'/ 2>/dev/null || true'
# 2) Code only
sudo -u curevice git pull --ff-only origin feature/nvn
sudo -u curevice /srv/curevice/.venv/bin/pip install -r requirements.txt
# 3) Migrate
sudo -u curevice /srv/curevice/.venv/bin/python manage.py migrate --noinput
sudo -u curevice /srv/curevice/.venv/bin/python manage.py collectstatic --noinput
# 4) Restart
sudo systemctl restart curevice
```

**Production DB tips**

- Prefer `POSTGRES_DB=...` (and related `POSTGRES_*`) in `.env` for multi-hospital / biometric hosts.
- Or keep SQLite **outside** the git tree: `SQLITE_PATH=/var/lib/curevice/db.sqlite3` so pulls cannot touch it.

If frontend changed:

```bash
cd /srv/curevice/frontend
sudo -u curevice npm ci
sudo -u curevice npm run build
sudo systemctl restart curevice
```

## 6) Useful paths

- App: `/srv/curevice`
- Env: `/srv/curevice/.env`
- Gunicorn service: `/etc/systemd/system/curevice.service`
- Nginx site: `/etc/nginx/sites-available/curevice`
- Socket: `/run/curevice.sock`

## 7) Notes

- Script uses branch `feature/nvn` by default.
- Change `DOMAIN` and verify `ALLOWED_HOSTS`/`CSRF_TRUSTED_ORIGINS` in `.env`.
- For PostgreSQL, set `POSTGRES_*` values in `.env`.
