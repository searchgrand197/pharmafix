# Hospital Management System (HMS)
# naveen code
# fixed all issues includind vardraan into vardaan
Django REST API backend + React admin UI.

## Backend thing

```bash
.\.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8000
```

- API: `http://127.0.0.1:8000/api/v1/`
- OpenAPI: `http://127.0.0.1:8000/api/v1/docs/`

## Frontend (React admin)

See **[frontend/README.md](frontend/README.md)**.

```bash
cd frontend
npm install
npm run dev
```

Open **http://127.0.0.1:5173** — Vite proxies `/api/*` to the Django server on port 8000.

## Deployment

- Hostinger VPS (Django + Gunicorn + Nginx): `docs/HOSTINGER_DJANGO_DEPLOY.md`
- One-shot setup script: `scripts/deploy_hostinger.sh`

## fixed bugs

## LAN access (biometric + onboarding)

Use this when biometric devices or employees must reach the app via your PC's LAN IP (not `localhost`). Django serves the built React app on port **8000** — do **not** use `npm run dev` / `:5173` in this mode.

```bash
cd frontend && npm run build
```

In `.env` (replace `192.168.x.x` with your machine's IP):

```env
SITE_BASE_URL=http://192.168.x.x:8000
FRONTEND_BASE_URL=http://192.168.x.x:8000
ALLOWED_HOSTS=localhost,127.0.0.1,192.168.x.x
SERVE_FRONTEND=1
```

```bash
.\.venv\Scripts\python.exe manage.py runserver 0.0.0.0:8000
```

- HR portal: `http://<IP>:8000`
- Onboarding upload link: `http://<IP>:8000/offer/onboarding/<token>`
- Biometric K90 server URL: `http://<IP>:8000/iclock/`

Re-send onboarding welcome emails after changing base URLs; older emails may still point at `localhost:5173`.
# pharmafix
# pharmafix
# pharmafix
