function getUsers(token) {
  try {
    var currentUser = requireAuth(token);
    if (currentUser.role !== 'admin' && currentUser.role !== 'manager') {
      throw new Error('คุณไม่มีสิทธิ์เข้าถึงเมนูนี้');
    }
    ensureDatabaseReady();
    repairApprovedProviderBindings();
    return successResponse('โหลดข้อมูลผู้ใช้งานเรียบร้อยแล้ว', readUserRows().map(sanitizeUserForAdmin));
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function createUser(payload, token) {
  try {
    var currentUser = requireAuth(token);
    if (currentUser.role !== 'admin' && currentUser.role !== 'manager') {
      throw new Error('คุณไม่มีสิทธิ์เข้าถึงเมนูนี้');
    }
    ensureDatabaseReady();
    var data = validateUserPayload(payload, true);
    if (currentUser.role === 'manager' && data.role === 'admin') {
      throw new Error('คุณไม่มีสิทธิ์สร้างบัญชีผู้ดูแลระบบ (Admin)');
    }
    var duplicate = readUserRows().some(function (user) {
      return user.username.toLowerCase() === data.username.toLowerCase();
    });

    if (duplicate) {
      return errorResponse('Username นี้ถูกใช้งานแล้ว', null);
    }

    assertUniqueProviderBinding(data.provider_id, data.hash_cid, data.account_id, '');

    var now = nowString();
    var user = {
      user_id: generateUuid(),
      username: data.username,
      password: hashPassword(data.password),
      full_name: data.full_name,
      role: data.role,
      department: data.department,
      status: data.status,
      created_at: now,
      updated_at: now,
      last_login: '',
      account_id: data.account_id,
      provider_id: data.provider_id,
      hash_cid: data.hash_cid,
      hcode: data.hcode,
      provider_name: data.provider_name,
      provider_last_login: '',
      allowed_pages: data.allowed_pages
    };

    appendRowObject(SHEET_NAMES.USERS, user);
    writeAuditLog('CREATE_USER', 'User', 'เพิ่มผู้ใช้งาน: ' + user.username, currentUser);

    return successResponse('เพิ่มข้อมูลผู้ใช้งานเรียบร้อยแล้ว', sanitizeUserForAdmin(user));
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function updateUser(userId, payload, token) {
  try {
    var currentUser = requireAuth(token);
    if (currentUser.role !== 'admin' && currentUser.role !== 'manager') {
      throw new Error('คุณไม่มีสิทธิ์เข้าถึงเมนูนี้');
    }
    ensureDatabaseReady();
    userId = String(userId || '').trim();

    if (!userId) {
      return errorResponse('ไม่พบรหัสผู้ใช้งาน', null);
    }

    var existingUser = findObjectById(SHEET_NAMES.USERS, 'user_id', userId);

    if (!existingUser) {
      return errorResponse('ไม่พบข้อมูลผู้ใช้งาน', null);
    }

    var data = validateUserPayload(payload, false);
    var duplicate = readUserRows().some(function (user) {
      return user.user_id !== userId && user.username.toLowerCase() === data.username.toLowerCase();
    });

    if (duplicate) {
      return errorResponse('Username นี้ถูกใช้งานแล้ว', null);
    }

    assertUniqueProviderBinding(data.provider_id, data.hash_cid, data.account_id, userId);

    var updateData = {
      username: data.username,
      full_name: data.full_name,
      role: data.role,
      department: data.department,
      status: data.status,
      account_id: data.account_id,
      provider_id: data.provider_id,
      hash_cid: data.hash_cid,
      hcode: data.hcode,
      provider_name: data.provider_name,
      allowed_pages: data.allowed_pages,
      updated_at: nowString()
    };

    if (data.password) {
      updateData.password = hashPassword(data.password);
    }

    if (currentUser.role === 'manager') {
      if (existingUser.role === 'admin') {
        throw new Error('คุณไม่มีสิทธิ์แก้ไขบัญชีผู้ดูแลระบบ (Admin)');
      }
      if (data.role === 'admin') {
        throw new Error('คุณไม่มีสิทธิ์ยกระดับบัญชีอื่นให้เป็นผู้ดูแลระบบ (Admin)');
      }
    }

    if (userId === currentUser.user_id && data.status !== 'active') {
      return errorResponse('ไม่สามารถปิดใช้งานบัญชีของตัวเองได้', null);
    }

    if (userId === currentUser.user_id && data.role !== 'admin') {
      return errorResponse('ไม่สามารถลดสิทธิ์บัญชีของตัวเองได้', null);
    }

    var updatedUser = updateObjectById(SHEET_NAMES.USERS, 'user_id', userId, updateData);
    writeAuditLog('UPDATE_USER', 'User', 'แก้ไขผู้ใช้งาน: ' + data.username, currentUser);

    return successResponse('แก้ไขข้อมูลผู้ใช้งานเรียบร้อยแล้ว', sanitizeUserForAdmin(updatedUser));
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function validateUserPayload(payload, isCreate) {
  var data = payload || {};
  var username = String(data.username || '').trim();
  var password = String(data.password || '');
  var fullName = enforceMaxLength(data.full_name, 120, 'ชื่อ-สกุล');
  var role = String(data.role || '').trim();
  var status = String(data.status || '').trim();
  var providerId = enforceMaxLength(data.provider_id, 80, 'Provider ID');
  var hashCid = enforceMaxLength(data.hash_cid, 128, 'Hash CID').toLowerCase();
  var accountId = enforceMaxLength(data.account_id, 80, 'Account ID');
  var hcode = enforceMaxLength(data.hcode, 20, 'HCODE');

  if (!username) {
    throw new Error('กรุณากรอก username');
  }

  if (!/^[A-Za-z0-9]{3,40}$/.test(username)) {
    throw new Error('Username ต้องเป็นตัวอักษรภาษาอังกฤษ และตัวเลข 3-40 ตัวอักษรเท่านั้น (ไม่มีภาษาไทย ช่องว่าง หรือสัญลักษณ์พิเศษ)');
  }

  if (isCreate && !password) {
    throw new Error('กรุณากรอกรหัสผ่าน');
  }

  if (password && password.length < 6) {
    throw new Error('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
  }

  if (password && !/(?=.*[a-zA-Z])(?=.*\d)/.test(password)) {
    throw new Error('รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข');
  }

  if (!fullName) {
    throw new Error('กรุณากรอกชื่อ-สกุล');
  }

  if (role !== 'admin' && role !== 'user' && role !== 'manager' && role !== 'driver_head' && role !== 'driver') {
    throw new Error('สิทธิ์ผู้ใช้งานไม่ถูกต้อง');
  }

  if (status !== 'active' && status !== 'inactive') {
    throw new Error('สถานะผู้ใช้งานไม่ถูกต้อง');
  }

  return {
    username: username,
    password: password,
    full_name: fullName,
    role: role,
    department: enforceMaxLength(data.department, 120, 'หน่วยงาน'),
    status: status,
    account_id: accountId,
    provider_id: providerId,
    hash_cid: hashCid,
    hcode: hcode,
    provider_name: enforceMaxLength(data.provider_name, 120, 'ชื่อจาก Provider ID'),
    allowed_pages: String(data.allowed_pages || '').trim()
  };
}

function assertUniqueProviderBinding(providerId, hashCid, accountId, currentUserId) {
  providerId = String(providerId || '').trim();
  hashCid = String(hashCid || '').trim().toLowerCase();
  accountId = String(accountId || '').trim();
  currentUserId = String(currentUserId || '').trim();

  if (!providerId && !hashCid && !accountId) {
    return;
  }

  var duplicate = readUserRows().some(function (user) {
    if (String(user.user_id || '') === currentUserId) {
      return false;
    }

    if (hashCid && String(user.hash_cid || '').trim().toLowerCase() === hashCid) {
      return true;
    }

    if (accountId && String(user.account_id || '').trim() === accountId) {
      return true;
    }

    return providerId && String(user.provider_id || '').trim() === providerId;
  });

  if (duplicate) {
    throw new Error('Account ID, Provider ID หรือ Hash CID นี้ถูกผูกกับผู้ใช้งานอื่นแล้ว');
  }
}

function readUserRows() {
  return readSheetRowsBySchema(SHEET_NAMES.USERS, SHEET_HEADERS.users, sanitizeUser)
    .filter(function (user) {
      return String(user.user_id || user.username || '').trim() !== '';
    });
}
