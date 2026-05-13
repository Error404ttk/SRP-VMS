function login(username, password) {
  try {
    ensureDatabaseReady();

    username = String(username || '').trim();
    password = String(password || '');

    if (!username || !password) {
      return errorResponse('กรุณากรอก username และ password', null);
    }

    if (isLoginLocked(username)) {
      return errorResponse('เข้าสู่ระบบผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่', null);
    }

    var users = getRowsAsObjects(SHEET_NAMES.USERS);
    var user = users.find(function (row) {
      return String(row.username) === username && verifyPassword(password, row.password);
    });

    if (!user) {
      registerFailedLogin(username);
      return errorResponse('username หรือ password ไม่ถูกต้อง', null);
    }

    if (user.status !== 'active') {
      registerFailedLogin(username);
      return errorResponse('ผู้ใช้งานนี้ถูกปิดใช้งาน', null);
    }

    clearFailedLogin(username);

    var safeUser = sanitizeUser(user);
    var session = createSession(safeUser);
    var loginUpdate = {
      last_login: nowString(),
      updated_at: nowString()
    };

    if (shouldUpgradePasswordHash(user.password)) {
      loginUpdate.password = hashPassword(password);
    }

    updateObjectById(SHEET_NAMES.USERS, 'user_id', user.user_id, loginUpdate);

    writeAuditLog('LOGIN', 'Auth', 'เข้าสู่ระบบ', safeUser);
    var targetPage = safeUser.role === 'admin' ? 'dashboard' : 'usage-form';
    var appUrl = '';

    try {
      appUrl = ScriptApp.getService().getUrl();
    } catch (error) {
      appUrl = '';
    }

    return successResponse('เข้าสู่ระบบสำเร็จ', {
      token: session.token,
      user: safeUser,
      targetPage: targetPage,
      redirectUrl: appUrl ? (appUrl + '?page=' + encodeURIComponent(targetPage)) : ''
    });
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function logout(token) {
  try {
    var user = getCurrentUser(token).data;
    clearSession(token);

    if (user) {
      writeAuditLog('LOGOUT', 'Auth', 'ออกจากระบบ', user);
    }

    return successResponse('ออกจากระบบสำเร็จ', {});
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function getCurrentUser(token) {
  try {
    var session = getSession(token);

    if (!session) {
      return errorResponse('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่', null);
    }

    var latestUser = findObjectById(SHEET_NAMES.USERS, 'user_id', session.user.user_id);

    if (!latestUser) {
      clearSession(token);
      return errorResponse('ไม่พบข้อมูลผู้ใช้งาน กรุณาเข้าสู่ระบบใหม่', null);
    }

    if (latestUser.status !== 'active') {
      clearSession(token);
      return errorResponse('ผู้ใช้งานนี้ถูกปิดใช้งาน', null);
    }

    refreshSessionUser(token, latestUser);

    return successResponse('พบข้อมูลผู้ใช้งาน', sanitizeUser(latestUser));
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function requireAuth(token) {
  var response = getCurrentUser(token);

  if (!response.success) {
    throw new Error(response.message);
  }

  return response.data;
}

function requireAdmin(token) {
  var user = requireAuth(token);

  if (user.role !== 'admin') {
    throw new Error('คุณไม่มีสิทธิ์เข้าถึงเมนูนี้');
  }

  return user;
}

function createSession(user) {
  var token = generateUuid();
  var session = {
    token: token,
    user: sanitizeUser(user),
    created_at: nowString()
  };

  // ใช้ CacheService เป็น session storage อย่างง่ายสำหรับ Web App Version 1
  CacheService.getScriptCache().put(getSessionKey(token), JSON.stringify(session), SESSION_TTL_SECONDS);

  return session;
}

function refreshSessionUser(token, user) {
  var session = getSession(token);

  if (!session) {
    return;
  }

  session.user = sanitizeUser(user);
  CacheService.getScriptCache().put(getSessionKey(token), JSON.stringify(session), SESSION_TTL_SECONDS);
}

function getSession(token) {
  token = String(token || '').trim();

  if (!token) {
    return null;
  }

  var cached = CacheService.getScriptCache().get(getSessionKey(token));

  if (!cached) {
    return null;
  }

  return JSON.parse(cached);
}

function clearSession(token) {
  token = String(token || '').trim();

  if (token) {
    CacheService.getScriptCache().remove(getSessionKey(token));
  }
}

function getSessionKey(token) {
  return 'SPH_VEHICLE_LOG_SESSION_' + token;
}

function sanitizeUser(user) {
  var cleanUser = {
    user_id: String(user.user_id || ''),
    username: String(user.username || ''),
    full_name: String(user.full_name || ''),
    role: String(user.role || ''),
    department: String(user.department || ''),
    status: String(user.status || ''),
    created_at: normalizeResponseValue(user.created_at),
    updated_at: normalizeResponseValue(user.updated_at),
    last_login: normalizeResponseValue(user.last_login),
    account_id: maskSensitiveIdentifier(user.account_id),
    provider_id: maskSensitiveIdentifier(user.provider_id),
    hash_cid: maskSensitiveIdentifier(user.hash_cid),
    hcode: String(user.hcode || ''),
    provider_name: String(user.provider_name || ''),
    provider_last_login: normalizeResponseValue(user.provider_last_login),
    allowed_pages: String(user.allowed_pages || '')
  };

  return cleanUser;
}

function hashPassword(password, salt) {
  return hashPasswordV2(password, salt);
}

function hashPasswordV2(password, salt, iterations) {
  salt = salt || generateUuid();
  iterations = iterations || PASSWORD_HASH_ITERATIONS;
  var hash = String(password || '');

  for (var i = 0; i < iterations; i++) {
    hash = bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + i + ':' + hash));
  }

  return 'sha256i$' + iterations + '$' + salt + '$' + hash;
}

function hashPasswordV1(password, salt) {
  salt = salt || generateUuid();
  return 'sha256$' + salt + '$' + bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + String(password || '')));
}

function bytesToHex(bytes) {
  return bytes.map(function (byte) {
    var value = byte < 0 ? byte + 256 : byte;
    return ('0' + value.toString(16)).slice(-2);
  }).join('');
}

function maskSensitiveIdentifier(value) {
  value = String(value || '').trim();
  if (!value) {
    return '';
  }
  if (value.length <= 10) {
    return '****';
  }
  return value.slice(0, 6) + '...' + value.slice(-4);
}

function sanitizeUserForAdmin(user) {
  var cleanUser = sanitizeUser(user);
  cleanUser.account_id = String(user.account_id || '');
  cleanUser.provider_id = String(user.provider_id || '');
  cleanUser.hash_cid = String(user.hash_cid || '');
  return cleanUser;
}

function verifyPasswordV2(password, storedPassword) {
  var parts = String(storedPassword || '').split('$');

  if (parts.length !== 4 || parts[0] !== 'sha256i') {
    return false;
  }

  var iterations = Number(parts[1]);
  if (!iterations || iterations < 1) {
    return false;
  }

  return hashPasswordV2(password, parts[2], iterations) === storedPassword;
}

function verifyPasswordV1(password, storedPassword) {
  var parts = String(storedPassword || '').split('$');

  if (parts.length !== 3 || parts[0] !== 'sha256') {
    return false;
  }

  return hashPasswordV1(password, parts[1]) === storedPassword;
}

function isPasswordHashV2(storedPassword) {
  return /^sha256i\$\d+\$[^$]+\$[a-f0-9]{64}$/.test(String(storedPassword || ''));
}

function isPasswordHashV1(storedPassword) {
  return /^sha256\$[^$]+\$[a-f0-9]{64}$/.test(String(storedPassword || ''));
}

function shouldUpgradePasswordHash(storedPassword) {
  return !isPasswordHashV2(storedPassword);
}

/*
function legacyHashPassword(password, salt) {
  salt = salt || generateUuid();
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + String(password || ''));
  var hash = digest.map(function (byte) {
    var value = byte < 0 ? byte + 256 : byte;
    return ('0' + value.toString(16)).slice(-2);
  }).join('');

  return 'sha256$' + salt + '$' + hash;
}
*/

function verifyPassword(password, storedPassword) {
  storedPassword = String(storedPassword || '');

  if (isPasswordHashV2(storedPassword)) {
    return verifyPasswordV2(password, storedPassword);
  }

  if (isPasswordHashV1(storedPassword)) {
    return verifyPasswordV1(password, storedPassword);
  }

  if (!isPasswordHash(storedPassword)) {
    return storedPassword === String(password || '');
  }

  return false;
}

function isPasswordHash(storedPassword) {
  return isPasswordHashV1(storedPassword) || isPasswordHashV2(storedPassword);
}

function isLoginLocked(username) {
  var cache = CacheService.getScriptCache();
  return cache.get(getLoginLockKey(username)) === 'locked';
}

function registerFailedLogin(username) {
  var cache = CacheService.getScriptCache();
  var key = getLoginFailKey(username);
  var failedCount = Number(cache.get(key) || '0') + 1;

  cache.put(key, String(failedCount), LOGIN_LOCKOUT_SECONDS);

  if (failedCount >= LOGIN_MAX_FAILED_ATTEMPTS) {
    cache.put(getLoginLockKey(username), 'locked', LOGIN_LOCKOUT_SECONDS);
  }
}

function clearFailedLogin(username) {
  var cache = CacheService.getScriptCache();
  cache.remove(getLoginFailKey(username));
  cache.remove(getLoginLockKey(username));
}

function getLoginFailKey(username) {
  return 'SPH_LOGIN_FAIL_' + String(username || '').trim().toLowerCase();
}

function getLoginLockKey(username) {
  return 'SPH_LOGIN_LOCK_' + String(username || '').trim().toLowerCase();
}

function normalizeResponseValue(value) {
  if (!value) {
    return '';
  }

  if (Object.prototype.toString.call(value) === '[object Date]') {
    return formatDateTime(value);
  }

  return String(value);
}
