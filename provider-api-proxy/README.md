# Provider API Proxy

Small Cloud Run-compatible proxy for SPH Vehicle Log Provider ID login.

Use this when Google Apps Script `UrlFetchApp` cannot call `https://moph.id.th` or `https://provider.id.th` directly.

## Endpoints

- `POST /health-token`
- `POST /provider-token`
- `POST /provider-profile`
- `POST /provider-public-key`
- `GET /healthz`

Apps Script sends:

```json
{
  "env": "PRD",
  "health_url": "https://moph.id.th",
  "provider_url": "https://provider.id.th",
  "payload": {}
}
```

## Run On Hospital Server

```bash
npm install --omit=dev
npm start
```

The default port is `9999`. You can override it with `PORT`.

```bash
PORT=9999 npm start
```

Health check:

```bash
curl http://127.0.0.1:9999/healthz
```

Nginx reverse proxy example:

```nginx
location /provider-api-proxy/ {
  proxy_pass http://127.0.0.1:9999/;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
}
```

After the public HTTPS URL is ready, put it into **Provider ID Config > API Proxy URL**.

Example:

```text
https://api.example.go.th/provider-api-proxy
```

## Deploy To Cloud Run

```bash
gcloud run deploy provider-api-proxy \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated
```

After deploy, put the Cloud Run service URL into **Provider ID Config > API Proxy URL**.
