function getDrivers(token) {
  try {
    requireAdmin(token);
    return successResponse('โหลดข้อมูลพนักงานขับรถเรียบร้อยแล้ว', readDriverRows());
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function getActiveDrivers(token) {
  try {
    requireAuth(token);

    var drivers = getCachedActiveDrivers();

    return successResponse('โหลดข้อมูลพนักงานขับรถที่ใช้งานเรียบร้อยแล้ว', drivers);
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function createDriver(payload, token) {
  try {
    var user = requireAdmin(token);
    var data = validateDriverPayload(payload);
    var now = nowString();
    var driver = {
      driver_id: generateUuid(),
      full_name: data.full_name,
      phone: data.phone,
      license_no: data.license_no,
      status: data.status,
      remark: data.remark,
      created_at: now,
      updated_at: now
    };

    appendRowObject(SHEET_NAMES.DRIVERS, driver);
    clearDriverCache();
    writeAuditLog('CREATE_DRIVER', 'Driver', 'เพิ่มพนักงานขับรถ: ' + driver.full_name, user);

    return successResponse('เพิ่มข้อมูลพนักงานขับรถเรียบร้อยแล้ว', driver);
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function updateDriver(driverId, payload, token) {
  try {
    var user = requireAdmin(token);
    driverId = String(driverId || '').trim();

    if (!driverId) {
      return errorResponse('ไม่พบรหัสพนักงานขับรถ', null);
    }

    var existingDriver = findObjectById(SHEET_NAMES.DRIVERS, 'driver_id', driverId);

    if (!existingDriver) {
      return errorResponse('ไม่พบข้อมูลพนักงานขับรถ', null);
    }

    var data = validateDriverPayload(payload);
    var updatedDriver = updateObjectById(SHEET_NAMES.DRIVERS, 'driver_id', driverId, {
      full_name: data.full_name,
      phone: data.phone,
      license_no: data.license_no,
      status: data.status,
      remark: data.remark,
      updated_at: nowString()
    });

    clearDriverCache();
    writeAuditLog('UPDATE_DRIVER', 'Driver', 'แก้ไขพนักงานขับรถ: ' + data.full_name, user);

    return successResponse('แก้ไขข้อมูลพนักงานขับรถเรียบร้อยแล้ว', updatedDriver);
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function getCachedActiveDrivers() {
  var cached = getCachedJson('SPH_ACTIVE_DRIVERS');

  if (cached) {
    return cached;
  }

  var drivers = readDriverRows().filter(function (driver) {
    return driver.status === 'active';
  });

  return putCachedJson('SPH_ACTIVE_DRIVERS', drivers, 120);
}

function validateDriverPayload(payload) {
  var data = payload || {};
  var status = String(data.status || '').trim();
  var fullName = enforceMaxLength(data.full_name, 120, 'ชื่อ-สกุลพนักงานขับรถ');

  if (!fullName) {
    throw new Error('กรุณากรอกชื่อ-สกุลพนักงานขับรถ');
  }

  if (status !== 'active' && status !== 'inactive') {
    throw new Error('สถานะพนักงานขับรถไม่ถูกต้อง');
  }

  return {
    full_name: fullName,
    phone: enforceMaxLength(data.phone, 40, 'เบอร์โทรศัพท์'),
    license_no: enforceMaxLength(data.license_no, 80, 'เลขใบอนุญาตขับขี่'),
    status: status,
    remark: enforceMaxLength(data.remark, 500, 'หมายเหตุ')
  };
}

function readDriverRows() {
  return readSheetRowsBySchema(SHEET_NAMES.DRIVERS, SHEET_HEADERS.drivers)
    .filter(function (driver) {
      return String(driver.driver_id || driver.full_name || '').trim() !== '';
    })
    .map(function (driver) {
      return {
        driver_id: String(driver.driver_id || ''),
        full_name: String(driver.full_name || ''),
        phone: String(driver.phone || ''),
        license_no: String(driver.license_no || ''),
        status: String(driver.status || ''),
        remark: String(driver.remark || ''),
        created_at: String(driver.created_at || ''),
        updated_at: String(driver.updated_at || '')
      };
    });
}
