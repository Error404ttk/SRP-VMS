var PROVIDER_AUTH_PROPERTY_KEYS = [
  'PROVIDER_AUTH_ENV',
  'HEALTH_ID_CLIENT_ID',
  'HEALTH_ID_CLIENT_SECRET',
  'PROVIDER_ID_CLIENT_ID',
  'PROVIDER_ID_SECRET_KEY',
  'PROVIDER_ALLOWED_HCODE',
  'PROVIDER_REDIRECT_URI',
  'PROVIDER_API_PROXY_URL'
];

function authorizeExternalRequest() {
  var response = UrlFetchApp.fetch('https://www.google.com', {
    muteHttpExceptions: true
  });

  return successResponse('Authorize external request เรียบร้อยแล้ว', {
    statusCode: response.getResponseCode()
  });
}

function getProviderAuthSettings(token) {
  try {
    requireAdmin(token);
    var props = PropertiesService.getScriptProperties();

    return successResponse('โหลดการตั้งค่า Provider ID เรียบร้อยแล้ว', {
      env: props.getProperty('PROVIDER_AUTH_ENV') || 'UAT',
      healthClientId: props.getProperty('HEALTH_ID_CLIENT_ID') || '',
      healthClientSecretSet: !!props.getProperty('HEALTH_ID_CLIENT_SECRET'),
      providerClientId: props.getProperty('PROVIDER_ID_CLIENT_ID') || '',
      providerSecretKeySet: !!props.getProperty('PROVIDER_ID_SECRET_KEY'),
      allowedHcode: props.getProperty('PROVIDER_ALLOWED_HCODE') || '',
      redirectUri: props.getProperty('PROVIDER_REDIRECT_URI') || getDefaultProviderRedirectUri(),
      proxyUrl: props.getProperty('PROVIDER_API_PROXY_URL') || '',
      configured: isProviderAuthConfigured()
    });
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function saveProviderAuthSettings(payload, token) {
  try {
    var user = requireAdmin(token);
    var data = validateProviderAuthSettings(payload || {});
    var props = PropertiesService.getScriptProperties();

    props.setProperty('PROVIDER_AUTH_ENV', data.env);
    props.setProperty('HEALTH_ID_CLIENT_ID', data.healthClientId);
    props.setProperty('PROVIDER_ID_CLIENT_ID', data.providerClientId);
    props.setProperty('PROVIDER_ALLOWED_HCODE', data.allowedHcode);
    props.setProperty('PROVIDER_REDIRECT_URI', data.redirectUri);

    if (data.proxyUrl) {
      props.setProperty('PROVIDER_API_PROXY_URL', data.proxyUrl);
    } else {
      props.deleteProperty('PROVIDER_API_PROXY_URL');
    }

    if (data.healthClientSecret) {
      props.setProperty('HEALTH_ID_CLIENT_SECRET', data.healthClientSecret);
    }

    if (data.providerSecretKey) {
      props.setProperty('PROVIDER_ID_SECRET_KEY', data.providerSecretKey);
    }

    writeAuditLog('SAVE_PROVIDER_AUTH_SETTINGS', 'ProviderAuth', 'บันทึกการตั้งค่า Provider ID ' + data.env, user);

    return getProviderAuthSettings(token);
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function getProviderLoginUrl() {
  try {
    return successResponse('สร้าง URL เข้าสู่ระบบ Provider ID เรียบร้อยแล้ว', {
      url: buildProviderAuthUrl()
    });
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function handleProviderCallback(parameters) {
  try {
    ensureDatabaseReady();
    assertProviderCallbackRateLimit();

    var code = String((parameters || {}).code || '').trim();
    var state = String((parameters || {}).state || '').trim();

    if (!code) {
      return errorResponse('ไม่พบ code จาก Health ID', null);
    }

    var settings = getProviderAuthConfig();
    assertProviderCallbackClient(parameters, settings);
    verifyProviderStateIfPresent(state);
    var flow = runProviderOAuthFlow(code, settings);
    var profile = flow.profile;
    var organization = flow.organization;
    var user = findProviderWhitelistedUser(profile);

    if (!organization) {
      writeAuditLog('LOGIN_PROVIDER_ID_DENIED', 'ProviderAuth', 'HCODE ไม่ได้รับอนุญาต', {
        username: 'provider',
        full_name: profile.name_th || '',
        role: ''
      });
      return errorResponse('บัญชีนี้ไม่ได้สังกัดหน่วยบริการที่ได้รับอนุญาต', null);
    }

    if (!user) {
      writeAuditLog('LOGIN_PROVIDER_ID_DENIED', 'ProviderAuth', 'ไม่พบ user whitelist สำหรับ Provider ID', {
        username: 'provider',
        full_name: profile.name_th || '',
        role: ''
      });
      return errorResponse('ไม่อยู่ในฐานข้อมูลผู้ใช้งาน กรุณาติดต่อผู้ดูแลระบบ', null);
    }

    if (String(user.status || '') !== 'active') {
      writeAuditLog('LOGIN_PROVIDER_ID_DENIED', 'ProviderAuth', 'user inactive: ' + user.username, sanitizeUser(user));
      return errorResponse('ผู้ใช้งานนี้ถูกปิดใช้งาน', null);
    }

    var now = nowString();
    var updatedUser = updateObjectById(SHEET_NAMES.USERS, 'user_id', user.user_id, {
      account_id: profile.account_id || user.account_id || '',
      provider_id: profile.provider_id || user.provider_id || '',
      hash_cid: String(profile.hash_cid || user.hash_cid || '').toLowerCase(),
      hcode: organization.hcode || user.hcode || '',
      provider_name: profile.name_th || user.provider_name || '',
      provider_last_login: now,
      last_login: now,
      updated_at: now
    });
    var safeUser = sanitizeUser(updatedUser || user);
    var session = createSession(safeUser);
    var targetPage = safeUser.role === 'admin' ? 'dashboard' : 'usage-form';

    writeAuditLog('LOGIN_PROVIDER_ID', 'ProviderAuth', 'เข้าสู่ระบบด้วย Provider ID: ' + safeUser.username, safeUser);

    return successResponse('เข้าสู่ระบบด้วย Provider ID สำเร็จ', {
      token: session.token,
      user: safeUser,
      targetPage: targetPage,
      redirectUrl: getPageRedirectUrl(targetPage)
    });
  } catch (error) {
    logProviderCallbackError(error);
    return errorResponse(error.message, null);
  }
}

function getPendingProviderLogins(token) {
  try {
    requireAdmin(token);
    ensureDatabaseReady();
    repairApprovedProviderBindings();
    return successResponse('โหลดรายการ Provider ID ที่รอผูกผู้ใช้เรียบร้อยแล้ว', readPendingProviderLoginRows().filter(function (row) {
      return row.status === 'pending';
    }));
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function approvePendingProviderLogin(pendingId, userId, token) {
  try {
    var currentUser = requireAdmin(token);
    ensureDatabaseReady();
    pendingId = String(pendingId || '').trim();
    userId = String(userId || '').trim();

    if (!pendingId || !userId) {
      return errorResponse('กรุณาเลือกรายการ Provider ID และผู้ใช้งาน', null);
    }

    var pending = findObjectById(SHEET_NAMES.PROVIDER_LOGIN_PENDING, 'pending_id', pendingId);
    var user = findObjectById(SHEET_NAMES.USERS, 'user_id', userId);

    if (!pending) {
      return errorResponse('ไม่พบรายการ Provider ID ที่รอผูก', null);
    }

    if (!user) {
      return errorResponse('ไม่พบผู้ใช้งานที่ต้องการผูก', null);
    }

    assertUniqueProviderBinding(pending.provider_id, pending.hash_cid, pending.account_id, userId);

    updateObjectById(SHEET_NAMES.USERS, 'user_id', userId, {
      account_id: pending.account_id || '',
      provider_id: pending.provider_id || '',
      hash_cid: String(pending.hash_cid || '').toLowerCase(),
      hcode: pending.hcode || '',
      provider_name: pending.provider_name || '',
      updated_at: nowString()
    });

    updateObjectById(SHEET_NAMES.PROVIDER_LOGIN_PENDING, 'pending_id', pendingId, {
      status: 'approved',
      matched_user_id: userId,
      updated_at: nowString()
    });

    writeAuditLog('APPROVE_PROVIDER_LOGIN', 'ProviderAuth', 'ผูก Provider ID กับผู้ใช้: ' + user.username, currentUser);

    return successResponse('ผูก Provider ID กับผู้ใช้งานเรียบร้อยแล้ว', {});
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function repairApprovedProviderBindings() {
  var pendingRows = readPendingProviderLoginRows().filter(function (row) {
    return row.status === 'approved' && row.matched_user_id && (row.account_id || row.provider_id || row.hash_cid);
  });
  var repairedCount = 0;

  pendingRows.forEach(function (pending) {
    var user = findObjectById(SHEET_NAMES.USERS, 'user_id', pending.matched_user_id);
    if (!user) {
      return;
    }

    var needsRepair = !String(user.account_id || '').trim() ||
      !String(user.provider_id || '').trim() ||
      !String(user.hash_cid || '').trim() ||
      !String(user.hcode || '').trim() ||
      !String(user.provider_name || '').trim();

    if (!needsRepair) {
      return;
    }

    updateObjectById(SHEET_NAMES.USERS, 'user_id', pending.matched_user_id, {
      account_id: user.account_id || pending.account_id || '',
      provider_id: user.provider_id || pending.provider_id || '',
      hash_cid: String(user.hash_cid || pending.hash_cid || '').toLowerCase(),
      hcode: user.hcode || pending.hcode || '',
      provider_name: user.provider_name || pending.provider_name || '',
      updated_at: nowString()
    });
    repairedCount++;
  });

  return repairedCount;
}

function getProviderAuthDiagnostics(token) {
  try {
    requireAdmin(token);
    var settings = getProviderAuthSettings(token).data || {};
    var config = null;
    var configured = false;

    try {
      config = getProviderAuthConfig();
      configured = true;
    } catch (error) {
      config = null;
    }

    var proxyUrl = config ? config.proxyUrl : (settings.proxyUrl || '');
    var fetchMode = proxyUrl
      ? 'proxy (' + proxyUrl + ') + resilientFetch'
      : 'resilientFetch (retry 3x + User-Agent) — ตรงจาก Apps Script';

    return successResponse('ตรวจการตั้งค่า Provider ID เรียบร้อยแล้ว', {
      configured: configured,
      env: settings.env,
      healthClientId: maskSecret(settings.healthClientId),
      healthClientSecretSet: settings.healthClientSecretSet,
      providerClientId: maskSecret(settings.providerClientId),
      providerSecretKeySet: settings.providerSecretKeySet,
      allowedHcode: settings.allowedHcode,
      redirectUri: settings.redirectUri,
      proxyUrl: proxyUrl || 'ไม่ได้ตั้งค่า (เรียก API ตรง)',
      defaultRedirectUri: getDefaultProviderRedirectUri(),
      healthTokenEndpoint: config ? config.healthUrl + '/api/v1/token' : '',
      providerTokenEndpoint: config ? config.providerUrl + '/api/v1/services/token' : '',
      providerProfileEndpoint: config ? config.providerUrl + '/api/v1/services/profile' : '',
      fetchMode: fetchMode
    });
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function testProviderPublicKey(token) {
  try {
    requireAdmin(token);
    var settings = getProviderAuthConfig();
    var response;

    if (settings.proxyUrl) {
      response = resilientFetch(settings.proxyUrl + '/provider-public-key', {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          provider_url: settings.providerUrl,
          payload: {
            client_id: settings.providerClientId,
            secret_key: settings.providerSecretKey
          }
        }),
        muteHttpExceptions: true
      });
    } else {
      response = resilientFetch(settings.providerUrl + '/api/v1/services/public-key', {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          client_id: settings.providerClientId,
          secret_key: settings.providerSecretKey
        }),
        muteHttpExceptions: true
      });
    }

    var statusCode = response.getResponseCode();
    var ok = statusCode >= 200 && statusCode < 300;

    writeAuditLog(ok ? 'TEST_PROVIDER_PUBLIC_KEY' : 'TEST_PROVIDER_PUBLIC_KEY_FAILED', 'ProviderAuth', 'ทดสอบ Provider public-key status ' + statusCode, requireAdmin(token));

    return successResponse(ok ? 'ทดสอบ Provider public-key สำเร็จ' : 'ทดสอบ Provider public-key ไม่สำเร็จ', {
      ok: ok,
      statusCode: statusCode,
      hasPublicKey: ok && response.getContentText().indexOf('BEGIN PUBLIC KEY') !== -1
    });
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function testHealthTokenEndpoint(token) {
  try {
    requireAdmin(token);
    var settings = getProviderAuthConfig();
    var endpoint = settings.healthUrl + '/api/v1/token';
    var response;

    if (settings.proxyUrl) {
      response = resilientFetch(settings.proxyUrl + '/health-token', {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          health_url: settings.healthUrl,
          payload: {
            grant_type: 'authorization_code',
            code: 'SPH_DIAGNOSTIC_CODE',
            redirect_uri: settings.redirectUri,
            client_id: settings.healthClientId,
            client_secret: settings.healthClientSecret
          }
        }),
        muteHttpExceptions: true
      });
    } else {
      response = resilientFetch(endpoint, {
        method: 'post',
        contentType: 'application/x-www-form-urlencoded',
        payload: {
          grant_type: 'authorization_code',
          code: 'SPH_DIAGNOSTIC_CODE',
          redirect_uri: settings.redirectUri,
          client_id: settings.healthClientId,
          client_secret: settings.healthClientSecret
        },
        muteHttpExceptions: true
      });
    }

    var statusCode = response.getResponseCode();
    var text = response.getContentText();
    var data = {};

    try {
      data = JSON.parse(text || '{}');
    } catch (parseError) {
      data = {};
    }

    return successResponse('ทดสอบ Health ID token endpoint เรียบร้อยแล้ว', {
      ok: true,
      endpoint: settings.proxyUrl ? settings.proxyUrl + '/health-token → ' + endpoint : endpoint,
      statusCode: statusCode,
      contentType: response.getHeaders()['Content-Type'] || response.getHeaders()['content-type'] || '',
      message: data.message_th || data.message || text.slice(0, 200),
      viaProxy: !!settings.proxyUrl
    });
  } catch (error) {
    var configForError = null;
    try { configForError = getProviderAuthConfig(); } catch (cfgErr) { configForError = null; }
    var errorEndpoint = configForError ? (configForError.proxyUrl ? configForError.proxyUrl + '/health-token' : configForError.healthUrl + '/api/v1/token') : 'unknown';
    return errorResponse(formatHealthEndpointFetchError(error, errorEndpoint), null);
  }
}

function testProviderOAuthCode(code, token) {
  try {
    var admin = requireAdmin(token);
    ensureDatabaseReady();
    code = String(code || '').trim();

    if (!code) {
      return errorResponse('กรุณาระบุ code ที่ได้จาก Health ID callback', null);
    }

    var settings = getProviderAuthConfig();
    var result = runProviderOAuthFlow(code, settings);
    var user = result.profile.account_id ? findUserByProviderAccountId(result.profile.account_id) : null;

    writeAuditLog(user ? 'TEST_PROVIDER_OAUTH_CODE_MATCHED' : 'TEST_PROVIDER_OAUTH_CODE_NOT_FOUND', 'ProviderAuth', 'ทดสอบ OAuth code account_id ' + maskSecret(result.profile.account_id || ''), admin);

    return successResponse(user ? 'ทดสอบสำเร็จ พบ account_id ในฐานข้อมูลผู้ใช้งาน' : 'ทดสอบสำเร็จ แต่ไม่พบ account_id ในฐานข้อมูลผู้ใช้งาน', {
      matched: !!user,
      matchedUser: user ? sanitizeUserForAdmin(user) : null,
      steps: buildProviderOAuthStepSnapshot(result)
    });
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function runProviderOAuthFlow(code, settings) {
  var healthToken = requestHealthIdToken(code, settings);
  assertOAuthAccessToken(healthToken, 'Health ID access_token', 'POST ' + settings.healthUrl + '/api/v1/token');
  var providerToken = requestProviderIdToken(healthToken.access_token, settings);
  assertOAuthAccessToken(providerToken, 'Provider ID access_token', 'POST ' + settings.providerUrl + '/api/v1/services/token');
  var profile = requestProviderProfile(providerToken.access_token, settings);
  assertProviderProfile(profile);
  var organization = findAllowedProviderOrganization(profile, settings.allowedHcode);

  return {
    endpoints: {
      healthToken: settings.healthUrl + '/api/v1/token',
      providerToken: settings.providerUrl + '/api/v1/services/token',
      providerProfile: settings.providerUrl + '/api/v1/services/profile'
    },
    healthToken: healthToken,
    providerToken: providerToken,
    profile: profile,
    organization: organization
  };
}

function buildProviderOAuthStepSnapshot(result) {
  var profile = result.profile || {};
  var organization = result.organization || {};
  var matchedUser = findUserByProviderAccountId(profile.account_id);
  var endpoints = result.endpoints || {};

  return [
    {
      step: '1. POST {HealthID-URL}/api/v1/token',
      ok: !!(result.healthToken && result.healthToken.access_token),
      values: {
        endpoint: endpoints.healthToken || '',
        input: 'authorization code จาก callback URL',
        output: 'Health ID access_token',
        token_type: result.healthToken.token_type || '',
        expires_in: result.healthToken.expires_in || '',
        account_id: result.healthToken.account_id || '',
        access_token: maskToken(result.healthToken.access_token)
      }
    },
    {
      step: '2. POST {Provider-URL}/api/v1/services/token',
      ok: !!(result.providerToken && result.providerToken.access_token),
      values: {
        endpoint: endpoints.providerToken || '',
        input: 'Health ID access_token + Provider client_id/secret_key + token_by Health ID',
        output: 'Provider ID access_token',
        token_type: result.providerToken.token_type || '',
        expires_in: result.providerToken.expires_in || '',
        account_id: result.providerToken.account_id || '',
        username: result.providerToken.username || '',
        login_by: result.providerToken.login_by || '',
        access_token: maskToken(result.providerToken.access_token)
      }
    },
    {
      step: '3. GET {Provider-URL}/api/v1/services/profile',
      ok: !!profile.provider_id,
      values: {
        endpoint: endpoints.providerProfile || '',
        input: 'Authorization Bearer Provider ID access_token',
        output: 'Provider profile',
        provider_id: profile.provider_id || '',
        hash_cid: maskSensitiveIdentifier(profile.hash_cid),
        name_th: profile.name_th || '',
        account_id: profile.account_id || '',
        hcode: organization.hcode || '',
        hname_th: organization.hname_th || '',
        position: organization.position || ''
      }
    },
    {
      step: '4. Match profile.account_id กับ users.account_id',
      ok: !!matchedUser,
      values: {
        account_id: profile.account_id || '',
        result: matchedUser ? 'พบในฐานข้อมูล' : 'ไม่อยู่ในฐานข้อมูล'
      }
    }
  ];
}

function assertOAuthAccessToken(tokenResponse, label, endpoint) {
  tokenResponse = tokenResponse || {};
  if (!String(tokenResponse.access_token || '').trim()) {
    throw new Error(label + ' ว่างหรือไม่มีใน response จาก ' + endpoint);
  }
}

function assertProviderProfile(profile) {
  profile = profile || {};
  if (!String(profile.account_id || '').trim()) {
    throw new Error('Provider profile ไม่มี account_id จึงไม่สามารถเทียบกับ users.account_id ได้');
  }
}

function buildProviderAuthUrl() {
  var settings = getProviderAuthConfig();
  var state = createSignedProviderAuthState();

  return settings.healthUrl + '/oauth/redirect?' + [
    'client_id=' + encodeURIComponent(settings.healthClientId),
    'redirect_uri=' + encodeURIComponent(settings.redirectUri),
    'response_type=code',
    'state=' + encodeURIComponent(state)
  ].join('&');
}

function assertProviderCallbackRateLimit() {
  var cache = CacheService.getScriptCache();
  var key = 'SPH_PROVIDER_CALLBACK_RATE_' + Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, 'yyyyMMddHHmm');
  var count = Number(cache.get(key) || 0);

  if (count >= PROVIDER_CALLBACK_RATE_LIMIT) {
    throw new Error('มีการเรียก Provider ID callback ถี่เกินไป กรุณาลองใหม่ภายหลัง');
  }

  cache.put(key, String(count + 1), PROVIDER_CALLBACK_RATE_WINDOW_SECONDS);
}

function assertProviderCallbackClient(parameters, settings) {
  var callbackClientId = extractProviderCallbackClientId(parameters && parameters.as_path);

  if (callbackClientId && callbackClientId !== settings.healthClientId) {
    throw new Error('Health ID Client ID ใน callback ไม่ตรงกับค่าที่ตั้งไว้ กรุณาเริ่มเข้าสู่ระบบ Provider ID ใหม่จากปุ่มในระบบหลังบันทึก config ล่าสุด');
  }
}

function extractProviderCallbackClientId(asPath) {
  asPath = String(asPath || '');
  if (!asPath) {
    return '';
  }

  try {
    asPath = decodeURIComponent(asPath);
  } catch (error) {
    // Use the original value if it is already decoded.
  }

  var match = asPath.match(/[?&]client_id=([^&]+)/);
  return match ? decodeURIComponent(match[1]).trim() : '';
}

function logProviderCallbackError(error) {
  try {
    writeAuditLog('LOGIN_PROVIDER_ID_ERROR', 'ProviderAuth', String(error && error.message ? error.message : error), {
      username: 'provider',
      full_name: '',
      role: ''
    });
  } catch (logError) {
    // Do not hide the original login error if audit logging fails.
  }
}

function getProviderAuthConfig() {
  var allProps = PropertiesService.getScriptProperties().getProperties();
  var env = String(allProps['PROVIDER_AUTH_ENV'] || 'UAT').toUpperCase();
  var config = {
    env: env,
    healthUrl: env === 'PRD' ? 'https://moph.id.th' : 'https://uat-moph.id.th',
    providerUrl: env === 'PRD' ? 'https://provider.id.th' : 'https://uat-provider.id.th',
    healthClientId: String(allProps['HEALTH_ID_CLIENT_ID'] || '').trim(),
    healthClientSecret: String(allProps['HEALTH_ID_CLIENT_SECRET'] || '').trim(),
    providerClientId: String(allProps['PROVIDER_ID_CLIENT_ID'] || '').trim(),
    providerSecretKey: String(allProps['PROVIDER_ID_SECRET_KEY'] || '').trim(),
    allowedHcode: String(allProps['PROVIDER_ALLOWED_HCODE'] || '').trim(),
    redirectUri: normalizeProviderRedirectUri(String(allProps['PROVIDER_REDIRECT_URI'] || getDefaultProviderRedirectUri()).trim()),
    proxyUrl: String(allProps['PROVIDER_API_PROXY_URL'] || '').trim().replace(/\/+$/, '')
  };

  if (!config.healthClientId || !config.healthClientSecret || !config.providerClientId || !config.providerSecretKey || !config.allowedHcode || !config.redirectUri) {
    throw new Error('ยังตั้งค่า Provider ID Login ไม่ครบ');
  }

  return config;
}

function isProviderAuthConfigured() {
  try {
    getProviderAuthConfig();
    return true;
  } catch (error) {
    return false;
  }
}

function validateProviderAuthSettings(payload) {
  var env = String(payload.env || 'UAT').toUpperCase();
  if (env !== 'UAT' && env !== 'PRD') {
    throw new Error('Environment ต้องเป็น UAT หรือ PRD');
  }

  return {
    env: env,
    healthClientId: enforceMaxLength(payload.healthClientId, 120, 'Health ID Client ID'),
    healthClientSecret: enforceMaxLength(payload.healthClientSecret, 255, 'Health ID Secret'),
    providerClientId: enforceMaxLength(payload.providerClientId, 120, 'Provider ID Client ID'),
    providerSecretKey: enforceMaxLength(payload.providerSecretKey, 255, 'Provider ID Secret Key'),
    allowedHcode: enforceMaxLength(payload.allowedHcode, 20, 'Allowed HCODE'),
    redirectUri: normalizeProviderRedirectUri(enforceMaxLength(payload.redirectUri || getDefaultProviderRedirectUri(), 500, 'Redirect URI')),
    proxyUrl: enforceMaxLength(String(payload.proxyUrl || '').trim().replace(/\/+$/, ''), 500, 'API Proxy URL')
  };
}

function normalizeProviderRedirectUri(uri) {
  uri = String(uri || '').trim();
  if (uri.indexOf('?page=provider-callback') !== -1) {
    return uri.split('?')[0];
  }
  return uri;
}

/**
 * UrlFetchApp wrapper with retry and User-Agent header.
 * moph.id.th (PRD) may block the default Google Apps Script User-Agent or
 * experience transient DNS failures. This helper retries up to 3 times with
 * exponential backoff and sends a browser-like User-Agent header so that WAF
 * and rate-limit rules are less likely to reject the request.
 */
function resilientFetch(url, options) {
  var maxAttempts = 3;
  var backoffMs = 1000;
  options = options || {};

  // Inject User-Agent header without overwriting other headers.
  var headers = options.headers ? JSON.parse(JSON.stringify(options.headers)) : {};
  if (!headers['User-Agent']) {
    headers['User-Agent'] = 'Mozilla/5.0 (compatible; SPH-Vehicle-Log/1.0; +https://script.google.com)';
  }
  options.headers = headers;

  var lastError = null;
  for (var attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return UrlFetchApp.fetch(url, options);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        Utilities.sleep(backoffMs);
        backoffMs *= 2;
      }
    }
  }
  throw lastError;
}

function requestHealthIdToken(code, settings) {
  var endpoint = settings.healthUrl + '/api/v1/token';
  var response;

  try {
    if (settings.proxyUrl) {
      response = resilientFetch(settings.proxyUrl + '/health-token', {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          health_url: settings.healthUrl,
          payload: {
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: settings.redirectUri,
            client_id: settings.healthClientId,
            client_secret: settings.healthClientSecret
          }
        }),
        muteHttpExceptions: true
      });
    } else {
      response = resilientFetch(endpoint, {
        method: 'post',
        contentType: 'application/x-www-form-urlencoded',
        payload: {
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: settings.redirectUri,
          client_id: settings.healthClientId,
          client_secret: settings.healthClientSecret
        },
        muteHttpExceptions: true
      });
    }
  } catch (error) {
    throw new Error(formatHealthEndpointFetchError(error, settings.proxyUrl ? settings.proxyUrl + '/health-token' : endpoint));
  }

  var data = parseJsonResponse(response, 'แลก Health ID token ไม่สำเร็จ');
  return data.data || {};
}

function formatHealthEndpointFetchError(error, endpoint) {
  var message = String(error && error.message ? error.message : error);
  return 'เชื่อมต่อ Health ID token endpoint ไม่สำเร็จ (ลอง 3 ครั้งแล้ว): ' + endpoint +
    ' | ' + message +
    ' | ถ้ายังอยู่ช่วงทดสอบให้ตั้ง Environment เป็น UAT' +
    ' | หากใช้งาน PRD แล้วยังขึ้นข้อความนี้ อาจเกิดจาก: (1) Health ID/MOPH บล็อก IP ของ Google Apps Script (2) DNS ชั่วคราว (3) WAF ปฏิเสธ request — กรุณาติดต่อสำนักสุขภาพดิจิทัล provider.id@moph.go.th โทร 02-590-2076';
}

function requestProviderIdToken(healthAccessToken, settings) {
  var response;

  if (settings.proxyUrl) {
    response = resilientFetch(settings.proxyUrl + '/provider-token', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        provider_url: settings.providerUrl,
        payload: {
          token: healthAccessToken,
          client_id: settings.providerClientId,
          secret_key: settings.providerSecretKey,
          token_by: 'Health ID'
        }
      }),
      muteHttpExceptions: true
    });
  } else {
    response = resilientFetch(settings.providerUrl + '/api/v1/services/token', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        token: healthAccessToken,
        client_id: settings.providerClientId,
        secret_key: settings.providerSecretKey,
        token_by: 'Health ID'
      }),
      muteHttpExceptions: true
    });
  }

  var data = parseJsonResponse(response, 'แลก Provider ID token ไม่สำเร็จ');
  return data.data || {};
}

function requestProviderProfile(providerAccessToken, settings) {
  var response;

  if (settings.proxyUrl) {
    response = resilientFetch(settings.proxyUrl + '/provider-profile', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        provider_url: settings.providerUrl,
        payload: {
          access_token: providerAccessToken,
          client_id: settings.providerClientId,
          secret_key: settings.providerSecretKey
        }
      }),
      muteHttpExceptions: true
    });
  } else {
    response = resilientFetch(settings.providerUrl + '/api/v1/services/profile', {
      method: 'get',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + providerAccessToken,
        'client-id': settings.providerClientId,
        'secret-key': settings.providerSecretKey
      },
      muteHttpExceptions: true
    });
  }

  var data = parseJsonResponse(response, 'ดึงข้อมูล Provider profile ไม่สำเร็จ');
  return data.data || {};
}

function parseJsonResponse(response, defaultMessage) {
  var statusCode = response.getResponseCode();
  var text = response.getContentText();
  var data = {};

  try {
    data = JSON.parse(text || '{}');
  } catch (error) {
    throw new Error(defaultMessage + ' (' + statusCode + ')');
  }

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(defaultMessage + ' (' + statusCode + '): ' + (data.message_th || data.message || 'ไม่ทราบสาเหตุ'));
  }

  return data;
}

function assertProviderState(state) {
  var validation = validateProviderAuthState(state);

  if (!validation.valid) {
    throw new Error(validation.message);
  }

  if (validation.legacy) {
    clearProviderAuthState(state);
  }
}

function verifyProviderStateIfPresent(state) {
  state = String(state || '').trim();
  if (!state) {
    writeAuditLog('LOGIN_PROVIDER_ID_STATE_OMITTED', 'ProviderAuth', 'Health ID callback ไม่ได้ส่ง state กลับมา จึงดำเนินการต่อตามคู่มือที่ state เป็น optional', {
      username: 'provider',
      full_name: '',
      role: ''
    });
    return;
  }

  assertProviderState(state);
}

function createSignedProviderAuthState() {
  var payload = {
    created_at: new Date().getTime(),
    nonce: generateUuid()
  };
  var encodedPayload = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  var signature = signProviderAuthState(encodedPayload);
  return encodedPayload + '.' + signature;
}

function validateProviderAuthState(state) {
  state = String(state || '').trim();
  if (!state) {
    return {
      valid: false,
      message: 'Provider ID state ไม่ถูกต้อง: ไม่พบ state จาก Health ID callback กรุณาเริ่มเข้าสู่ระบบใหม่จากปุ่ม Provider ID'
    };
  }

  if (state.indexOf('.') > -1) {
    return validateSignedProviderAuthState(state);
  }

  return validateLegacyProviderAuthState(state);
}

function validateSignedProviderAuthState(state) {
  var parts = String(state || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return {
      valid: false,
      message: 'Provider ID state รูปแบบไม่ถูกต้อง กรุณาเริ่มเข้าสู่ระบบใหม่จากปุ่ม Provider ID'
    };
  }

  var expectedSignature = signProviderAuthState(parts[0]);
  if (parts[1] !== expectedSignature) {
    return {
      valid: false,
      message: 'Provider ID state signature ไม่ถูกต้อง กรุณาเริ่มเข้าสู่ระบบใหม่จากปุ่ม Provider ID'
    };
  }

  try {
    var data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
    var ageSeconds = Math.floor((new Date().getTime() - Number(data.created_at || 0)) / 1000);
    if (ageSeconds > PROVIDER_AUTH_STATE_TTL_SECONDS) {
      return {
        valid: false,
        message: 'Provider ID state หมดอายุแล้ว (' + ageSeconds + ' วินาที) กรุณาเริ่มเข้าสู่ระบบใหม่จากปุ่ม Provider ID'
      };
    }
  } catch (error) {
    return {
      valid: false,
      message: 'Provider ID state อ่านค่าไม่ได้ กรุณาเริ่มเข้าสู่ระบบใหม่จากปุ่ม Provider ID'
    };
  }

  return {
    valid: true,
    legacy: false,
    message: ''
  };
}

function signProviderAuthState(encodedPayload) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(encodedPayload, getProviderAuthStateSecret()));
}

function getProviderAuthStateSecret() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('PROVIDER_AUTH_STATE_SECRET');
  if (!secret) {
    secret = generateUuid() + ':' + generateUuid();
    props.setProperty('PROVIDER_AUTH_STATE_SECRET', secret);
  }
  return secret;
}

function validateLegacyProviderAuthState(state) {
  var key = getProviderAuthStateKey(state);
  var payload = CacheService.getScriptCache().get(key) || PropertiesService.getScriptProperties().getProperty(key);

  if (!payload) {
    return {
      valid: false,
      message: 'Provider ID state ไม่ถูกต้องหรือหมดอายุ กรุณาเริ่มเข้าสู่ระบบใหม่จากปุ่ม Provider ID ห้าม refresh หรือเปิด callback URL เดิมซ้ำ'
    };
  }

  try {
    var data = JSON.parse(payload);
    var ageSeconds = Math.floor((new Date().getTime() - Number(data.created_at || 0)) / 1000);
    if (ageSeconds > PROVIDER_AUTH_STATE_TTL_SECONDS) {
      clearProviderAuthState(state);
      return {
        valid: false,
        message: 'Provider ID state หมดอายุแล้ว (' + ageSeconds + ' วินาที) กรุณาเริ่มเข้าสู่ระบบใหม่จากปุ่ม Provider ID'
      };
    }
  } catch (error) {
    clearProviderAuthState(state);
    return {
      valid: false,
      message: 'Provider ID state อ่านค่าไม่ได้ กรุณาเริ่มเข้าสู่ระบบใหม่จากปุ่ม Provider ID'
    };
  }

  return {
    valid: true,
    legacy: true,
    message: ''
  };
}

function clearProviderAuthState(state) {
  var key = getProviderAuthStateKey(state);
  CacheService.getScriptCache().remove(key);
  PropertiesService.getScriptProperties().deleteProperty(key);
}

function getProviderAuthStateKey(state) {
  return 'SPH_PROVIDER_AUTH_STATE_' + String(state || '').trim();
}

function cleanupExpiredProviderAuthStates() {
  var props = PropertiesService.getScriptProperties();
  var allProps = props.getProperties();
  var now = new Date().getTime();
  var keysToDelete = [];

  Object.keys(allProps).forEach(function (key) {
    if (key.indexOf('SPH_PROVIDER_AUTH_STATE_') !== 0) {
      return;
    }

    try {
      var data = JSON.parse(allProps[key] || '{}');
      var ageSeconds = Math.floor((now - Number(data.created_at || 0)) / 1000);
      if (ageSeconds > PROVIDER_AUTH_STATE_TTL_SECONDS) {
        keysToDelete.push(key);
      }
    } catch (error) {
      keysToDelete.push(key);
    }
  });

  keysToDelete.forEach(function (key) {
    props.deleteProperty(key);
  });
}

function findAllowedProviderOrganization(profile, allowedHcode) {
  var organizations = profile && profile.organization ? profile.organization : [];
  for (var i = 0; i < organizations.length; i++) {
    if (String(organizations[i].hcode || '').trim() === String(allowedHcode || '').trim()) {
      return organizations[i];
    }
  }
  return null;
}

function findProviderWhitelistedUser(profile) {
  var accountId = String(profile.account_id || '').trim();
  return findUserByProviderAccountId(accountId);
}

function findUserByProviderAccountId(accountId) {
  accountId = String(accountId || '').trim();
  if (!accountId) {
    return null;
  }

  var users = getRowsAsObjects(SHEET_NAMES.USERS);
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].account_id || '').trim() === accountId) {
      return users[i];
    }
  }

  return null;
}

function upsertPendingProviderLogin(profile, organization) {
  var accountId = String(profile.account_id || '').trim();
  var providerId = String(profile.provider_id || '').trim();
  var hashCid = String(profile.hash_cid || '').trim().toLowerCase();
  var rows = readPendingProviderLoginRows();
  var now = nowString();
  var existing = rows.find(function (row) {
    return (accountId && row.account_id === accountId) || (providerId && row.provider_id === providerId);
  });

  if (existing) {
    updateObjectById(SHEET_NAMES.PROVIDER_LOGIN_PENDING, 'pending_id', existing.pending_id, {
      account_id: accountId,
      provider_id: providerId,
      hash_cid: hashCid,
      provider_name: profile.name_th || '',
      hcode: organization.hcode || '',
      hname_th: organization.hname_th || '',
      position: organization.position || '',
      status: existing.status === 'approved' ? 'approved' : 'pending',
      updated_at: now,
      last_seen_at: now
    });
    return;
  }

  appendRowObject(SHEET_NAMES.PROVIDER_LOGIN_PENDING, {
    pending_id: generateUuid(),
    account_id: accountId,
    provider_id: providerId,
    hash_cid: hashCid,
    provider_name: profile.name_th || '',
    hcode: organization.hcode || '',
    hname_th: organization.hname_th || '',
    position: organization.position || '',
    status: 'pending',
    matched_user_id: '',
    note: '',
    created_at: now,
    updated_at: now,
    last_seen_at: now
  });
}

function readPendingProviderLoginRows() {
  return readSheetRowsBySchema(SHEET_NAMES.PROVIDER_LOGIN_PENDING, SHEET_HEADERS.provider_login_pending)
    .filter(function (row) {
      return String(row.pending_id || row.account_id || row.provider_id || row.hash_cid || '').trim() !== '';
    })
    .map(function (row) {
      return {
        pending_id: String(row.pending_id || ''),
        account_id: String(row.account_id || ''),
        provider_id: String(row.provider_id || ''),
        hash_cid: String(row.hash_cid || '').toLowerCase(),
        provider_name: String(row.provider_name || ''),
        hcode: String(row.hcode || ''),
        hname_th: String(row.hname_th || ''),
        position: String(row.position || ''),
        status: String(row.status || ''),
        matched_user_id: String(row.matched_user_id || ''),
        note: String(row.note || ''),
        created_at: normalizeResponseValue(row.created_at),
        updated_at: normalizeResponseValue(row.updated_at),
        last_seen_at: normalizeResponseValue(row.last_seen_at)
      };
    });
}

function maskSecret(value) {
  value = String(value || '');
  if (!value) {
    return '';
  }
  if (value.length <= 8) {
    return '****';
  }
  return value.slice(0, 4) + '****' + value.slice(-4);
}

function maskToken(value) {
  value = String(value || '');
  if (!value) {
    return '';
  }
  if (value.length <= 20) {
    return value.slice(0, 4) + '...' + value.slice(-4);
  }
  return value.slice(0, 12) + '...' + value.slice(-8);
}

function getDefaultProviderRedirectUri() {
  var appUrl = '';
  try {
    appUrl = ScriptApp.getService().getUrl();
  } catch (error) {
    appUrl = '';
  }
  return appUrl || '';
}

function getPageRedirectUrl(page) {
  var appUrl = '';
  try {
    appUrl = ScriptApp.getService().getUrl();
  } catch (error) {
    appUrl = '';
  }
  return appUrl ? appUrl + '?page=' + encodeURIComponent(page) : '';
}
