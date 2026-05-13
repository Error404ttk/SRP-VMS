function getVehicles(token) {
  try {
    requireAdmin(token);
    return successResponse('โหลดข้อมูลรถราชการเรียบร้อยแล้ว', readVehicleRows());
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function getActiveVehicles(token) {
  try {
    requireAuth(token);

    var vehicles = getCachedActiveVehicles();

    return successResponse('โหลดข้อมูลรถที่พร้อมใช้งานเรียบร้อยแล้ว', vehicles);
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function createVehicle(payload, token) {
  try {
    var user = requireAdmin(token);
    var data = validateVehiclePayload(payload);
    var now = nowString();

    if (data.status === 'in_use') {
      return errorResponse('รถใหม่ไม่สามารถเริ่มด้วยสถานะกำลังใช้งานได้ กรุณาเพิ่มเป็นพร้อมใช้งานหรือสถานะอื่นก่อน', null);
    }

    var vehicle = {
      vehicle_id: generateUuid(),
      plate_no: data.plate_no,
      vehicle_name: data.vehicle_name,
      vehicle_type: data.vehicle_type,
      brand_model: data.brand_model,
      fuel_type: data.fuel_type,
      current_mileage: data.current_mileage,
      status: data.status,
      remark: data.remark,
      created_at: now,
      updated_at: now
    };

    appendRowObject(SHEET_NAMES.VEHICLES, vehicle);
    clearVehicleCache();
    writeAuditLog('CREATE_VEHICLE', 'Vehicle', 'เพิ่มรถราชการ: ' + vehicle.vehicle_name, user);

    return successResponse('เพิ่มข้อมูลรถราชการเรียบร้อยแล้ว', vehicle);
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function updateVehicle(vehicleId, payload, token) {
  try {
    var user = requireAdmin(token);
    vehicleId = String(vehicleId || '').trim();

    if (!vehicleId) {
      return errorResponse('ไม่พบรหัสรถราชการ', null);
    }

    var existingVehicle = findObjectById(SHEET_NAMES.VEHICLES, 'vehicle_id', vehicleId);

    if (!existingVehicle) {
      return errorResponse('ไม่พบข้อมูลรถราชการ', null);
    }

    var data = validateVehiclePayload(payload);

    var hasActiveUsage = hasActiveUsageForVehicle(vehicleId);

    if (hasActiveUsage && data.status !== 'in_use') {
      return errorResponse('รถคันนี้มีรายการใช้งานที่ยังไม่ปิดงาน กรุณาปิดงานหรือยกเลิกรายการใช้รถก่อนเปลี่ยนสถานะ', null);
    }

    if (!hasActiveUsage && data.status === 'in_use') {
      return errorResponse('สถานะกำลังใช้งานต้องเกิดจากการบันทึกขอใช้รถเท่านั้น', null);
    }

    var updatedVehicle = updateObjectById(SHEET_NAMES.VEHICLES, 'vehicle_id', vehicleId, {
      plate_no: data.plate_no,
      vehicle_name: data.vehicle_name,
      vehicle_type: data.vehicle_type,
      brand_model: data.brand_model,
      fuel_type: data.fuel_type,
      current_mileage: data.current_mileage,
      status: data.status,
      remark: data.remark,
      updated_at: nowString()
    });

    clearVehicleCache();
    writeAuditLog('UPDATE_VEHICLE', 'Vehicle', 'แก้ไขรถราชการ: ' + data.vehicle_name, user);

    return successResponse('แก้ไขข้อมูลรถราชการเรียบร้อยแล้ว', updatedVehicle);
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function getCachedActiveVehicles() {
  var cached = getCachedJson('SPH_ACTIVE_VEHICLES');

  if (cached) {
    return cached;
  }

  var vehicles = readVehicleRows().filter(function (vehicle) {
    return vehicle.status === 'available';
  });

  return putCachedJson('SPH_ACTIVE_VEHICLES', vehicles, 120);
}

function hasActiveUsageForVehicle(vehicleId) {
  vehicleId = String(vehicleId || '').trim();

  if (!vehicleId) {
    return false;
  }

  return readUsageRows().some(function (row) {
    return row.vehicle_id === vehicleId && row.status === 'in_use';
  });
}

function validateVehiclePayload(payload) {
  var allowedStatuses = ['available', 'in_use', 'repair', 'inactive'];
  var data = payload || {};
  var currentMileage = Number(data.current_mileage);
  var status = String(data.status || '').trim();
  var plateNo = enforceMaxLength(data.plate_no, 40, 'ทะเบียนรถ');
  var vehicleName = enforceMaxLength(data.vehicle_name, 120, 'ชื่อรถ');

  if (!plateNo) {
    throw new Error('กรุณากรอกทะเบียนรถ');
  }

  if (!vehicleName) {
    throw new Error('กรุณากรอกชื่อรถ');
  }

  if (isNaN(currentMileage) || currentMileage < 0) {
    throw new Error('เลขไมล์ปัจจุบันต้องเป็นตัวเลขและต้องไม่ติดลบ');
  }

  if (allowedStatuses.indexOf(status) === -1) {
    throw new Error('สถานะรถไม่ถูกต้อง');
  }

  return {
    plate_no: plateNo,
    vehicle_name: vehicleName,
    vehicle_type: enforceMaxLength(data.vehicle_type, 80, 'ประเภทรถ'),
    brand_model: enforceMaxLength(data.brand_model, 120, 'ยี่ห้อ/รุ่น'),
    fuel_type: enforceMaxLength(data.fuel_type, 50, 'ประเภทเชื้อเพลิง'),
    current_mileage: currentMileage,
    status: status,
    remark: enforceMaxLength(data.remark, 500, 'หมายเหตุ')
  };
}



function readVehicleRows() {
  return readSheetRowsBySchema(SHEET_NAMES.VEHICLES, SHEET_HEADERS.vehicles)
    .filter(function (vehicle) {
      return String(vehicle.vehicle_id || vehicle.plate_no || vehicle.vehicle_name || '').trim() !== '';
    })
    .map(function (vehicle) {
      return {
        vehicle_id: String(vehicle.vehicle_id || ''),
        plate_no: String(vehicle.plate_no || ''),
        vehicle_name: String(vehicle.vehicle_name || ''),
        vehicle_type: String(vehicle.vehicle_type || ''),
        brand_model: String(vehicle.brand_model || ''),
        fuel_type: String(vehicle.fuel_type || ''),
        current_mileage: parseNumber(String(vehicle.current_mileage || '').replace(/,/g, '')),
        status: String(vehicle.status || ''),
        remark: String(vehicle.remark || ''),
        created_at: String(vehicle.created_at || ''),
        updated_at: String(vehicle.updated_at || '')
      };
    });
}

function getVehicleDebugInfo(token) {
  try {
    requireAdmin(token);

    var sheet = getSheetByName(SHEET_NAMES.VEHICLES);

    if (!sheet) {
      return successResponse('ตรวจสอบข้อมูลรถเรียบร้อยแล้ว', {
        exists: false,
        lastRow: 0,
        lastColumn: 0,
        headers: [],
        vehicleCount: 0
      });
    }

    return successResponse('ตรวจสอบข้อมูลรถเรียบร้อยแล้ว', {
      exists: true,
      spreadsheetId: getSpreadsheet().getId(),
      spreadsheetName: getSpreadsheet().getName(),
      lastRow: sheet.getLastRow(),
      lastColumn: sheet.getLastColumn(),
      headers: getSheetHeaders(sheet),
      vehicleCount: readVehicleRows().length
    });
  } catch (error) {
    return errorResponse(error.message, null);
  }
}
