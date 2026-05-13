import express from 'express';

const app = express();
const port = process.env.PORT || 9999;

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

app.get('/healthz', (req, res) => {
  res.json({ ok: true });
});

app.post('/health-token', asyncHandler(async (req, res) => {
  const body = getProxyPayload(req);
  const healthUrl = getBaseUrl(req, 'health_url', 'https://moph.id.th');
  const response = await fetch(`${healthUrl}/api/v1/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: stringValue(body.grant_type),
      code: stringValue(body.code),
      redirect_uri: stringValue(body.redirect_uri),
      client_id: stringValue(body.client_id),
      client_secret: stringValue(body.client_secret)
    })
  });

  await pipeResponse(response, res);
}));

app.post('/provider-token', asyncHandler(async (req, res) => {
  const body = getProxyPayload(req);
  const providerUrl = getBaseUrl(req, 'provider_url', 'https://provider.id.th');
  const response = await fetch(`${providerUrl}/api/v1/services/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      token: stringValue(body.token),
      client_id: stringValue(body.client_id),
      secret_key: stringValue(body.secret_key),
      token_by: stringValue(body.token_by || 'Health ID')
    })
  });

  await pipeResponse(response, res);
}));

app.post('/provider-profile', asyncHandler(async (req, res) => {
  const body = getProxyPayload(req);
  const providerUrl = getBaseUrl(req, 'provider_url', 'https://provider.id.th');
  const response = await fetch(`${providerUrl}/api/v1/services/profile`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${stringValue(body.access_token)}`,
      'client-id': stringValue(body.client_id),
      'secret-key': stringValue(body.secret_key)
    }
  });

  await pipeResponse(response, res);
}));

app.post('/provider-public-key', asyncHandler(async (req, res) => {
  const body = getProxyPayload(req);
  const providerUrl = getBaseUrl(req, 'provider_url', 'https://provider.id.th');
  const response = await fetch(`${providerUrl}/api/v1/services/public-key`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_id: stringValue(body.client_id),
      secret_key: stringValue(body.secret_key)
    })
  });

  await pipeResponse(response, res);
}));

app.use((req, res) => {
  res.status(404).json({ status: 404, message: 'Not found' });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({
    status: 500,
    message: 'Proxy request failed',
    message_th: 'Proxy เรียก API ปลายทางไม่สำเร็จ'
  });
});

app.listen(port, () => {
  console.log(`Provider API proxy listening on ${port}`);
});

function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function getProxyPayload(req) {
  return req.body && req.body.payload && typeof req.body.payload === 'object'
    ? req.body.payload
    : {};
}

function getBaseUrl(req, key, fallback) {
  const value = stringValue(req.body && req.body[key]);
  return value ? value.replace(/\/+$/, '') : fallback;
}

function stringValue(value) {
  return value === undefined || value === null ? '' : String(value);
}

async function pipeResponse(response, res) {
  const text = await response.text();
  const contentType = response.headers.get('content-type') || 'application/json; charset=utf-8';
  res.status(response.status);
  res.set('content-type', contentType);
  res.set('x-sph-provider-proxy', '1');
  res.send(text);
}
