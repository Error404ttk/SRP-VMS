function createUsageLog(payload, token) {
  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);

    var user = requireAuth(token);
    var data = validateUsagePayload(payload);
    var vehicle = findObjectById(SHEET_NAMES.VEHICLES, 'vehicle_id', data.vehicle_id);
    var driver = findObjectById(SHEET_NAMES.DRIVERS, 'driver_id', data.driver_id);

    if (!vehicle) {
      throw new Error('ไม่พบข้อมูลรถราชการ');
    }

    if (vehicle.status === 'repair' || vehicle.status === 'inactive') {
      throw new Error('รถคันนี้ไม่พร้อมใช้งาน');
    }

    if (vehicle.status === 'in_use') {
      throw new Error('รถคันนี้กำลังถูกใช้งานอยู่');
    }

    if (parseNumber(vehicle.current_mileage) > data.start_mileage) {
      throw new Error('เลขไมล์ก่อนออกต้องไม่น้อยกว่าเลขไมล์ปัจจุบันของรถ');
    }

    if (!driver) {
      throw new Error('ไม่พบข้อมูลพนักงานขับรถ');
    }

    if (driver.status !== 'active') {
      throw new Error('พนักงานขับรถนี้ไม่อยู่ในสถานะใช้งาน');
    }

    var now = nowString();
    var usageLog = {
      log_id: generateUuid(),
      usage_date: data.usage_date,
      start_time: data.start_time,
      end_time: '',
      vehicle_id: data.vehicle_id,
      plate_no: vehicle.plate_no || '',
      vehicle_name: vehicle.vehicle_name || '',
      driver_id: data.driver_id,
      driver_name: driver.full_name || '',
      mission_type: data.mission_type,
      destination: data.destination,
      requester_name: data.requester_name,
      requester_department: data.requester_department,
      start_mileage: data.start_mileage,
      end_mileage: '',
      total_km: 0,
      passenger_count: data.passenger_count,
      note: data.note,
      status: 'in_use',
      created_by: user.user_id,
      created_by_name: user.full_name,
      created_at: now,
      updated_at: now,
      cancel_reason: ''
    };

    appendRowObject(SHEET_NAMES.USAGE_LOGS, usageLog);
    updateObjectById(SHEET_NAMES.VEHICLES, 'vehicle_id', data.vehicle_id, {
      status: 'in_use',
      updated_at: now
    });
    clearVehicleCache();
    writeAuditLog('CREATE_USAGE', 'Usage', 'เริ่มใช้งานรถ: ' + usageLog.vehicle_name + ' ไป ' + usageLog.destination, user);

    return successResponse('บันทึกเริ่มใช้งานรถเรียบร้อยแล้ว', usageLog);
  } catch (error) {
    return errorResponse(error.message, null);
  } finally {
    try {
      lock.releaseLock();
    } catch (error) {
      // Lock may not have been acquired if waitLock failed.
    }
  }
}

function updateUsageLog(logId, payload, token) {
  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);

    var user = requireAuth(token);
    logId = String(logId || '').trim();

    if (!logId) {
      return errorResponse('ไม่พบรหัสรายการใช้รถ', null);
    }

    var existingLog = findObjectById(SHEET_NAMES.USAGE_LOGS, 'log_id', logId);

    if (!existingLog) {
      return errorResponse('ไม่พบข้อมูลรายการใช้รถ', null);
    }

    if (user.role !== 'admin' && existingLog.created_by !== user.user_id) {
      return errorResponse('คุณไม่มีสิทธิ์แก้ไขรายการนี้', null);
    }

    if (existingLog.status === 'cancelled' && user.role !== 'admin') {
      return errorResponse('ไม่สามารถแก้ไขรายการที่ยกเลิกแล้ว', null);
    }

    if (existingLog.status === 'in_use') {
      return errorResponse('กรุณาใช้ปุ่มปิดงานสำหรับรายการที่กำลังใช้งาน', null);
    }

    return saveCompletedUsageLog(logId, payload, user, existingLog, 'UPDATE_USAGE', 'แก้ไขรายการใช้รถ: ', 'แก้ไขข้อมูลการใช้รถเรียบร้อยแล้ว');
  } catch (error) {
    return errorResponse(error.message, null);
  } finally {
    try {
      lock.releaseLock();
    } catch (error) {
      // Lock may not have been acquired if waitLock failed.
    }
  }
}

function completeUsageLog(logId, payload, token) {
  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);

    var user = requireAuth(token);
    logId = String(logId || '').trim();

    if (!logId) {
      return errorResponse('ไม่พบรหัสรายการใช้รถ', null);
    }

    var existingLog = findObjectById(SHEET_NAMES.USAGE_LOGS, 'log_id', logId);

    if (!existingLog) {
      return errorResponse('ไม่พบข้อมูลรายการใช้รถ', null);
    }

    if (user.role !== 'admin' && existingLog.created_by !== user.user_id) {
      return errorResponse('คุณไม่มีสิทธิ์ปิดงานรายการนี้', null);
    }

    if (existingLog.status !== 'in_use') {
      return errorResponse('รายการนี้ไม่ได้อยู่ในสถานะกำลังใช้งาน', null);
    }

    return saveCompletedUsageLog(logId, mergeCompletionPayload(existingLog, payload), user, existingLog, 'COMPLETE_USAGE', 'ปิดงานใช้รถ: ', 'ปิดงานใช้รถเรียบร้อยแล้ว');
  } catch (error) {
    return errorResponse(error.message, null);
  } finally {
    try {
      lock.releaseLock();
    } catch (error) {
      // Lock may not have been acquired if waitLock failed.
    }
  }
}

function mergeCompletionPayload(existingLog, payload) {
  payload = payload || {};

  return {
    usage_date: existingLog.usage_date,
    start_time: existingLog.start_time,
    end_time: payload.end_time,
    vehicle_id: existingLog.vehicle_id,
    driver_id: existingLog.driver_id,
    mission_type: existingLog.mission_type,
    destination: existingLog.destination,
    requester_name: existingLog.requester_name,
    requester_department: existingLog.requester_department,
    start_mileage: existingLog.start_mileage,
    end_mileage: payload.end_mileage,
    passenger_count: payload.passenger_count,
    note: payload.note
  };
}

function saveCompletedUsageLog(logId, payload, user, existingLog, auditAction, auditPrefix, successMessage) {
  var data = validateUsagePayload(payload);

  if (!data.end_time || data.end_mileage === null) {
    return errorResponse('กรุณาระบุเวลากลับและเลขไมล์หลังกลับเพื่อปิดงานใช้รถ', null);
  }

  var vehicle = findObjectById(SHEET_NAMES.VEHICLES, 'vehicle_id', data.vehicle_id);
  var driver = findObjectById(SHEET_NAMES.DRIVERS, 'driver_id', data.driver_id);

  if (!vehicle) {
    throw new Error('ไม่พบข้อมูลรถราชการ');
  }

  if (vehicle.status === 'repair' || vehicle.status === 'inactive') {
    throw new Error('รถคันนี้ไม่พร้อมใช้งาน');
  }

  if (existingLog.vehicle_id !== data.vehicle_id && vehicle.status === 'in_use') {
    throw new Error('รถคันนี้กำลังถูกใช้งานอยู่');
  }

  if (existingLog.vehicle_id !== data.vehicle_id && parseNumber(vehicle.current_mileage) > data.end_mileage) {
    throw new Error('เลขไมล์หลังกลับต้องไม่น้อยกว่าเลขไมล์ปัจจุบันของรถ');
  }

  if (!driver) {
    throw new Error('ไม่พบข้อมูลพนักงานขับรถ');
  }

  if (driver.status !== 'active') {
    throw new Error('พนักงานขับรถนี้ไม่อยู่ในสถานะใช้งาน');
  }

  var now = nowString();
  var updatedLog = updateObjectById(SHEET_NAMES.USAGE_LOGS, 'log_id', logId, {
    usage_date: data.usage_date,
    start_time: data.start_time,
    end_time: data.end_time,
    vehicle_id: data.vehicle_id,
    plate_no: vehicle.plate_no || '',
    vehicle_name: vehicle.vehicle_name || '',
    driver_id: data.driver_id,
    driver_name: driver.full_name || '',
    mission_type: data.mission_type,
    destination: data.destination,
    requester_name: data.requester_name,
    requester_department: data.requester_department,
    start_mileage: data.start_mileage,
    end_mileage: data.end_mileage,
    total_km: data.end_mileage - data.start_mileage,
    passenger_count: data.passenger_count,
    note: data.note,
    status: 'completed',
    updated_at: now
  });

  updateVehicleMileageFromUsage(data.vehicle_id, data.end_mileage);
  if (existingLog.vehicle_id && existingLog.vehicle_id !== data.vehicle_id) {
    updateVehicleMileageFromUsage(existingLog.vehicle_id, null);
  }
  clearVehicleCache();
  writeAuditLog(auditAction, 'Usage', auditPrefix + logId, user);

  return successResponse(successMessage, updatedLog);
}

function cancelUsageLog(logId, reason, token) {
  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);

    var user = requireAuth(token);
    logId = String(logId || '').trim();
    reason = enforceMaxLength(reason, 500, 'เหตุผลการยกเลิก');

    if (!logId) {
      return errorResponse('ไม่พบรหัสรายการใช้รถ', null);
    }

    if (!reason) {
      return errorResponse('กรุณาระบุเหตุผลการยกเลิก', null);
    }

    var existingLog = findObjectById(SHEET_NAMES.USAGE_LOGS, 'log_id', logId);

    if (!existingLog) {
      return errorResponse('ไม่พบข้อมูลรายการใช้รถ', null);
    }

    if (user.role !== 'admin' && existingLog.created_by !== user.user_id) {
      return errorResponse('คุณไม่มีสิทธิ์ยกเลิกรายการนี้', null);
    }

    if (existingLog.status === 'cancelled') {
      return errorResponse('รายการนี้ถูกยกเลิกแล้ว', null);
    }

    var cancelledLog = updateObjectById(SHEET_NAMES.USAGE_LOGS, 'log_id', logId, {
      status: 'cancelled',
      updated_at: nowString(),
      cancel_reason: reason
    });

    if (existingLog.vehicle_id) {
      updateVehicleMileageFromUsage(existingLog.vehicle_id, existingLog.start_mileage);
    }

    clearVehicleCache();
    writeAuditLog('CANCEL_USAGE', 'Usage', 'ยกเลิกรายการใช้รถ: ' + logId + ' เหตุผล: ' + reason, user);

    return successResponse('ยกเลิกรายการใช้รถเรียบร้อยแล้ว', cancelledLog);
  } catch (error) {
    return errorResponse(error.message, null);
  } finally {
    try {
      lock.releaseLock();
    } catch (error) {
      // Lock may not have been acquired if waitLock failed.
    }
  }
}

function getUsageLogs(filters, token) {
  try {
    var user = requireAuth(token);
    var data = filterUsageRows(readUsageRows(), filters || {}, user);
    var page = normalizePagination(filters, 20, 100);

    return successResponse('โหลดรายการใช้รถเรียบร้อยแล้ว', {
      rows: data.slice(page.offset, page.offset + page.limit),
      totalRows: data.length,
      limit: page.limit,
      offset: page.offset
    });
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function getUsageFormOptions(token) {
  try {
    requireAuth(token);

    return successResponse('โหลดตัวเลือกแบบฟอร์มเรียบร้อยแล้ว', {
      vehicles: getCachedActiveVehicles(),
      drivers: getCachedActiveDrivers(),
      departments: getCachedActiveDepartments(),
      missionTypes: getCachedActiveMissionTypes(),
      destinations: getCachedActiveDestinations()
    });
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function getUsageListInitialData(filters, token) {
  try {
    var user = requireAuth(token);
    filters = filters || {};

    var data = filterUsageRows(readUsageRows(), filters, user);
    var page = normalizePagination(filters, 20, 100);

    return successResponse('โหลดหน้ารายการใช้รถเรียบร้อยแล้ว', {
      vehicles: getCachedActiveVehicles(),
      drivers: getCachedActiveDrivers(),
      departments: getCachedActiveDepartments(),
      missionTypes: getCachedActiveMissionTypes(),
      destinations: getCachedActiveDestinations(),
      logs: {
        rows: data.slice(page.offset, page.offset + page.limit),
        totalRows: data.length,
        limit: page.limit,
        offset: page.offset
      }
    });
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function getUsageLogById(logId, token) {
  try {
    var user = requireAuth(token);
    logId = String(logId || '').trim();

    if (!logId) {
      return errorResponse('ไม่พบรหัสรายการใช้รถ', null);
    }

    var log = findUsageRowById(logId);

    if (!log) {
      return errorResponse('ไม่พบข้อมูลรายการใช้รถ', null);
    }

    if (user.role !== 'admin' && log.created_by !== user.user_id) {
      return errorResponse('คุณไม่มีสิทธิ์ดูรายการนี้', null);
    }

    return successResponse('พบข้อมูลรายการใช้รถ', log);
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function getUsageDateTimeIssues(token) {
  try {
    requireAdmin(token);

    var sheet = getSheetByName(SHEET_NAMES.USAGE_LOGS);

    if (!sheet || sheet.getLastRow() < 2) {
      return successResponse('ไม่พบข้อมูลวันที่/เวลาที่ผิดรูปแบบ', {
        issueCount: 0,
        issues: []
      });
    }

    var rows = readUsageRows();
    var issues = [];

    rows.forEach(function (row, index) {
      var rowNumber = index + 2;

      if (!isValidIsoDate(row.usage_date)) {
        issues.push({
          rowNumber: rowNumber,
          logId: row.log_id,
          field: 'usage_date',
          value: row.usage_date,
          message: 'วันที่ต้องเป็นรูปแบบ yyyy-MM-dd หรือ dd/MM/yyyy'
        });
      }

      if (!isValidTimeValue(row.start_time)) {
        issues.push({
          rowNumber: rowNumber,
          logId: row.log_id,
          field: 'start_time',
          value: row.start_time,
          message: 'เวลาออกต้องเป็นรูปแบบ HH:mm'
        });
      }

      if (row.end_time && !isValidTimeValue(row.end_time)) {
        issues.push({
          rowNumber: rowNumber,
          logId: row.log_id,
          field: 'end_time',
          value: row.end_time,
          message: 'เวลากลับต้องเป็นรูปแบบ HH:mm'
        });
      }
    });

    return successResponse('ตรวจข้อมูลวันที่/เวลาเรียบร้อยแล้ว', {
      issueCount: issues.length,
      issues: issues.slice(0, 200)
    });
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function getUsageMasterDataIssues(token) {
  try {
    requireAdmin(token);

    var rows = readUsageRows();
    var vehiclesById = indexRowsByKey(readVehicleRows(), 'vehicle_id');
    var driversById = indexRowsByKey(readDriverRows(), 'driver_id');
    var departmentsByName = indexRowsByKey(readDepartmentRows(), 'department_name');
    var missionTypesByName = indexRowsByKey(readMissionTypeRows(), 'mission_type_name');
    var destinationsByName = indexRowsByKey(readDestinationRows(), 'destination_name');
    var issues = [];

    rows.forEach(function (row, index) {
      var rowNumber = index + 2;

      addUsageMasterIssueIfNeeded(issues, row, rowNumber, 'vehicle_id', row.vehicle_id, vehiclesById[row.vehicle_id], 'inactive', 'ไม่พบข้อมูลรถราชการ', 'รถราชการถูกปิดใช้งาน');
      addUsageMasterIssueIfNeeded(issues, row, rowNumber, 'driver_id', row.driver_id, driversById[row.driver_id], 'inactive', 'ไม่พบข้อมูลพนักงานขับรถ', 'พนักงานขับรถถูกปิดใช้งาน');
      addUsageMasterIssueIfNeeded(issues, row, rowNumber, 'requester_department', row.requester_department, departmentsByName[row.requester_department], 'inactive', 'ไม่พบข้อมูลหน่วยงาน', 'หน่วยงานถูกปิดใช้งาน');
      addUsageMasterIssueIfNeeded(issues, row, rowNumber, 'mission_type', row.mission_type, missionTypesByName[row.mission_type], 'inactive', 'ไม่พบข้อมูลประเภทภารกิจ', 'ประเภทภารกิจถูกปิดใช้งาน');
      addUsageMasterIssueIfNeeded(issues, row, rowNumber, 'destination', row.destination, destinationsByName[row.destination], 'inactive', 'ไม่พบข้อมูลสถานที่ไป', 'สถานที่ไปถูกปิดใช้งาน');
    });

    return successResponse('ตรวจข้อมูลหลักที่รายการใช้รถอ้างถึงเรียบร้อยแล้ว', {
      issueCount: issues.length,
      issues: issues.slice(0, 300)
    });
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function indexRowsByKey(rows, key) {
  var map = {};

  (rows || []).forEach(function (row) {
    var value = String(row[key] || '').trim();
    if (value) {
      map[value] = row;
    }
  });

  return map;
}

function addUsageMasterIssueIfNeeded(issues, row, rowNumber, field, value, masterRow, inactiveStatus, missingMessage, inactiveMessage) {
  value = String(value || '').trim();

  if (!value) {
    issues.push({
      rowNumber: rowNumber,
      logId: row.log_id,
      usageDate: row.usage_date,
      field: field,
      value: value,
      status: row.status,
      message: 'ไม่มีข้อมูลอ้างอิง'
    });
    return;
  }

  if (!masterRow) {
    issues.push({
      rowNumber: rowNumber,
      logId: row.log_id,
      usageDate: row.usage_date,
      field: field,
      value: value,
      status: row.status,
      message: missingMessage
    });
    return;
  }

  if (String(masterRow.status || '').trim() === inactiveStatus) {
    issues.push({
      rowNumber: rowNumber,
      logId: row.log_id,
      usageDate: row.usage_date,
      field: field,
      value: value,
      status: row.status,
      message: inactiveMessage
    });
  }
}

function archiveOldUsageLogs(retentionDays, token) {
  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);

    var user = requireAdmin(token);
    retentionDays = Number(retentionDays) || DEFAULT_ARCHIVE_RETENTION_DAYS;
    var archived = archiveOldUsageLogsInternal(retentionDays);
    writeAuditLog('ARCHIVE_USAGE', 'Usage', 'ย้ายรายการใช้รถเข้า Archive เก่ากว่า ' + retentionDays + ' วัน จำนวน ' + archived.archivedRows + ' รายการ', user);

    return successResponse('ย้ายรายการใช้รถเข้า Archive เรียบร้อยแล้ว', {
      archivedRows: archived.archivedRows,
      retentionDays: retentionDays
    });
  } catch (error) {
    return errorResponse(error.message, null);
  } finally {
    try {
      lock.releaseLock();
    } catch (error) {
      // Lock may not have been acquired if waitLock failed.
    }
  }
}

function runScheduledUsageArchive() {
  var retentionDays = Number(PropertiesService.getScriptProperties().getProperty('USAGE_ARCHIVE_RETENTION_DAYS')) || DEFAULT_ARCHIVE_RETENTION_DAYS;
  var systemUser = {
    username: 'system',
    full_name: 'System',
    role: 'admin'
  };
  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);
    var archived = archiveOldUsageLogsInternal(retentionDays);
    writeAuditLog('ARCHIVE_USAGE_SCHEDULED', 'Usage', 'ย้ายรายการใช้รถเข้า Archive ตามรอบ จำนวน ' + archived.archivedRows + ' รายการ', systemUser);
  } catch (error) {
    writeAuditLog('ARCHIVE_USAGE_SCHEDULED_ERROR', 'Usage', error.message, systemUser);
  } finally {
    try {
      lock.releaseLock();
    } catch (error) {
      // Lock may not have been acquired if waitLock failed.
    }
  }
}

function setupUsageArchiveSchedule(retentionDays, token) {
  try {
    var user = requireAdmin(token);
    retentionDays = Number(retentionDays) || 730;

    if (retentionDays < MIN_ARCHIVE_RETENTION_DAYS) {
      return errorResponse('ต้องเก็บรายการใช้รถอย่างน้อย ' + MIN_ARCHIVE_RETENTION_DAYS + ' วัน', null);
    }

    PropertiesService.getScriptProperties().setProperty('USAGE_ARCHIVE_RETENTION_DAYS', String(retentionDays));
    removeUsageArchiveTriggers();
    ScriptApp.newTrigger('runScheduledUsageArchive')
      .timeBased()
      .onMonthDay(1)
      .atHour(2)
      .create();

    writeAuditLog('SETUP_ARCHIVE_SCHEDULE', 'Usage', 'ตั้ง Archive รายการใช้รถรายเดือน เก็บข้อมูล ' + retentionDays + ' วัน', user);

    return successResponse('ตั้ง Archive รายการใช้รถรายเดือนเรียบร้อยแล้ว', {
      retentionDays: retentionDays
    });
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function removeUsageArchiveSchedule(token) {
  try {
    var user = requireAdmin(token);
    var removed = removeUsageArchiveTriggers();

    writeAuditLog('REMOVE_ARCHIVE_SCHEDULE', 'Usage', 'ยกเลิก Archive รายการใช้รถรายเดือน จำนวน trigger ที่ลบ ' + removed, user);

    return successResponse('ยกเลิก Archive รายการใช้รถรายเดือนเรียบร้อยแล้ว', {
      removedTriggers: removed
    });
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function removeUsageArchiveTriggers() {
  var removed = 0;
  var triggers = ScriptApp.getProjectTriggers();

  triggers.forEach(function (trigger) {
    if (trigger.getHandlerFunction && trigger.getHandlerFunction() === 'runScheduledUsageArchive') {
      ScriptApp.deleteTrigger(trigger);
      removed += 1;
    }
  });

  return removed;
}

function archiveOldUsageLogsInternal(retentionDays) {
  retentionDays = Number(retentionDays) || DEFAULT_ARCHIVE_RETENTION_DAYS;

  if (retentionDays < MIN_ARCHIVE_RETENTION_DAYS) {
    throw new Error('ต้องเก็บรายการใช้รถอย่างน้อย ' + MIN_ARCHIVE_RETENTION_DAYS + ' วัน');
  }

  var sourceSheet = getSheetByName(SHEET_NAMES.USAGE_LOGS);

  if (!sourceSheet || sourceSheet.getLastRow() < 2) {
    return {
      archivedRows: 0,
      retentionDays: retentionDays
    };
  }

  var archiveSheet = getOrCreateSheet(SHEET_NAMES.USAGE_LOGS_ARCHIVE);
  setHeadersIfEmpty(archiveSheet, SHEET_HEADERS.vehicle_usage_logs_archive);

  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  var values = sourceSheet.getDataRange().getDisplayValues();
  var headers = values[0].map(function (header) {
    return String(header || '').trim();
  });
  var archiveRows = [];
  var deleteRowNumbers = [];
  var usageDateIndex = headers.indexOf('usage_date');
  var statusIndex = headers.indexOf('status');

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var status = String(row[statusIndex] || '').trim();
    var usageDate = parseUsageDate(row[usageDateIndex]);

    if (usageDate && usageDate < cutoff && (status === 'completed' || status === 'cancelled')) {
      archiveRows.push(SHEET_HEADERS.vehicle_usage_logs_archive.map(function (header) {
        var index = headers.indexOf(header);
        return index > -1 ? row[index] : '';
      }));
      deleteRowNumbers.push(i + 1);
    }
  }

  if (archiveRows.length > 0) {
    archiveSheet.getRange(archiveSheet.getLastRow() + 1, 1, archiveRows.length, SHEET_HEADERS.vehicle_usage_logs_archive.length).setValues(archiveRows);

    for (var deleteIndex = deleteRowNumbers.length - 1; deleteIndex >= 0; deleteIndex--) {
      sourceSheet.deleteRow(deleteRowNumbers[deleteIndex]);
    }
  }

  return {
    archivedRows: archiveRows.length,
    retentionDays: retentionDays
  };
}

function isValidIsoDate(value) {
  var text = normalizeIsoDateValue(value);
  var match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return false;
  }

  var date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]);
}

function isValidTimeValue(value) {
  var text = normalizeTimeValue(value);
  var match = text.match(/^(\d{2}):(\d{2})$/);

  if (!match) {
    return false;
  }

  return Number(match[1]) >= 0 && Number(match[1]) <= 23 && Number(match[2]) >= 0 && Number(match[2]) <= 59;
}

function validateUsagePayload(payload) {
  var data = payload || {};
  var startMileage = Number(data.start_mileage);
  var rawEndMileage = String(data.end_mileage || '').trim();
  var endMileage = rawEndMileage === '' ? null : Number(rawEndMileage);
  var passengerCount = data.passenger_count === '' || data.passenger_count === undefined ? 0 : Number(data.passenger_count);
  var missionType = String(data.mission_type || '').trim();
  var destination = enforceMaxLength(data.destination, 255, 'สถานที่ไป');
  var requesterName = enforceMaxLength(data.requester_name, 120, 'ผู้ขอใช้รถ');
  var requesterDepartment = enforceMaxLength(data.requester_department, 120, 'หน่วยงานผู้ขอใช้รถ');
  var note = enforceMaxLength(data.note, 1000, 'หมายเหตุ');

  if (!String(data.usage_date || '').trim()) {
    throw new Error('กรุณาระบุวันที่ใช้รถ');
  }

  if (!String(data.start_time || '').trim()) {
    throw new Error('กรุณาระบุเวลาออก');
  }

  if (!isValidIsoDate(data.usage_date)) {
    throw new Error('วันที่ใช้รถไม่ถูกต้อง');
  }

  if (!isValidTimeValue(data.start_time)) {
    throw new Error('เวลาออกไม่ถูกต้อง');
  }

  if (!String(data.vehicle_id || '').trim()) {
    throw new Error('กรุณาเลือกรถที่ใช้');
  }

  if (!String(data.driver_id || '').trim()) {
    throw new Error('กรุณาเลือกพนักงานขับรถ');
  }

  if (!missionType) {
    throw new Error('กรุณาเลือกประเภทภารกิจ');
  }

  var activeMissionNames = getCachedActiveMissionTypes().map(function (item) {
    return item.mission_type_name;
  });
  var activeDestinationNames = getCachedActiveDestinations().map(function (item) {
    return item.destination_name;
  });
  var activeDepartmentNames = getCachedActiveDepartments().map(function (item) {
    return item.department_name;
  });

  if (activeMissionNames.indexOf(missionType) === -1) {
    throw new Error('ประเภทภารกิจไม่ถูกต้อง');
  }

  if (!destination) {
    throw new Error('กรุณากรอกสถานที่ไป');
  }

  if (activeDestinationNames.indexOf(destination) === -1) {
    throw new Error('สถานที่ไปไม่อยู่ในสถานะใช้งาน');
  }

  if (!requesterDepartment) {
    throw new Error('กรุณาเลือกหน่วยงานผู้ขอใช้รถ');
  }

  if (activeDepartmentNames.indexOf(requesterDepartment) === -1) {
    throw new Error('หน่วยงานผู้ขอใช้รถไม่อยู่ในสถานะใช้งาน');
  }

  if (isNaN(startMileage)) {
    throw new Error('เลขไมล์ก่อนออกต้องเป็นตัวเลข');
  }

  if (rawEndMileage !== '' && isNaN(endMileage)) {
    throw new Error('เลขไมล์หลังกลับต้องเป็นตัวเลข');
  }

  if (String(data.end_time || '').trim() && !isValidTimeValue(data.end_time)) {
    throw new Error('เวลากลับไม่ถูกต้อง');
  }

  if (endMileage !== null && endMileage < startMileage) {
    throw new Error('เลขไมล์หลังกลับต้องมากกว่าหรือเท่ากับเลขไมล์ก่อนออก');
  }

  if (isNaN(passengerCount) || passengerCount < 0) {
    throw new Error('จำนวนผู้โดยสารต้องเป็นตัวเลขและต้องไม่ติดลบ');
  }

  if (missionType === 'อื่น ๆ' && !note) {
    throw new Error('กรุณากรอกหมายเหตุเมื่อเลือกประเภทภารกิจอื่น ๆ');
  }

  return {
    usage_date: normalizeIsoDateValue(data.usage_date),
    start_time: normalizeTimeValue(data.start_time),
    end_time: normalizeTimeValue(data.end_time),
    vehicle_id: String(data.vehicle_id || '').trim(),
    driver_id: String(data.driver_id || '').trim(),
    mission_type: missionType,
    destination: destination,
    requester_name: requesterName,
    requester_department: requesterDepartment,
    start_mileage: startMileage,
    end_mileage: endMileage,
    passenger_count: passengerCount,
    note: note
  };
}

function parseUsageDate(value) {
  var text = normalizeIsoDateValue(value);
  var isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (isoMatch) {
    return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  }

  return null;
}

function readUsageRows() {
  return readSheetRowsBySchema(SHEET_NAMES.USAGE_LOGS, SHEET_HEADERS.vehicle_usage_logs, normalizeUsageRow)
    .filter(function (usageLog) {
      return String(usageLog.log_id || '').trim() !== '';
    });
}

function normalizeUsageRow(usageLog) {
  return {
    log_id: String(usageLog.log_id || ''),
    usage_date: normalizeIsoDateValue(usageLog.usage_date),
    start_time: normalizeTimeValue(usageLog.start_time),
    end_time: normalizeTimeValue(usageLog.end_time),
    vehicle_id: String(usageLog.vehicle_id || ''),
    plate_no: String(usageLog.plate_no || ''),
    vehicle_name: String(usageLog.vehicle_name || ''),
    driver_id: String(usageLog.driver_id || ''),
    driver_name: String(usageLog.driver_name || ''),
    mission_type: String(usageLog.mission_type || ''),
    destination: String(usageLog.destination || ''),
    requester_name: String(usageLog.requester_name || ''),
    requester_department: String(usageLog.requester_department || ''),
    start_mileage: parseNumber(String(usageLog.start_mileage || '').replace(/,/g, '')),
    end_mileage: String(usageLog.end_mileage || '').trim() === '' ? '' : parseNumber(String(usageLog.end_mileage || '').replace(/,/g, '')),
    total_km: String(usageLog.total_km || '').trim() === '' ? 0 : parseNumber(String(usageLog.total_km || '').replace(/,/g, '')),
    passenger_count: parseNumber(String(usageLog.passenger_count || '').replace(/,/g, '')),
    note: String(usageLog.note || ''),
    status: String(usageLog.status || ''),
    created_by: String(usageLog.created_by || ''),
    created_by_name: String(usageLog.created_by_name || ''),
    created_at: String(usageLog.created_at || ''),
    updated_at: String(usageLog.updated_at || ''),
    cancel_reason: String(usageLog.cancel_reason || '')
  };
}

function filterUsageRows(rows, filters, user) {
  var startDate = String(filters.startDate || '').trim();
  var endDate = String(filters.endDate || '').trim();
  var vehicleId = String(filters.vehicleId || '').trim();
  var driverId = String(filters.driverId || '').trim();
  var missionType = String(filters.missionType || '').trim();
  var status = String(filters.status || '').trim();
  var keyword = String(filters.keyword || '').trim().toLowerCase();
  return rows.filter(function (row) {
    if (user.role !== 'admin') {
      if (user.role === 'driver_head') {
        // driver_head sees all logs, do not filter
      } else if (user.role === 'manager') {
        var managerDept = String(user.department || '').trim().toLowerCase();
        var reqDept = String(row.requester_department || '').trim().toLowerCase();
        if (row.created_by !== user.user_id && (!managerDept || reqDept !== managerDept)) {
          return false;
        }
      } else if (user.role === 'driver') {
        var driverName = String(user.full_name || '').trim().toLowerCase();
        var assignedDriver = String(row.driver_name || '').trim().toLowerCase();
        if (row.created_by !== user.user_id && (!driverName || assignedDriver !== driverName)) {
          return false;
        }
      } else {
        if (row.created_by !== user.user_id) return false;
      }
    }
    if (startDate && row.usage_date < startDate) return false;
    if (endDate && row.usage_date > endDate) return false;
    if (vehicleId && row.vehicle_id !== vehicleId) return false;
    if (driverId && row.driver_id !== driverId) return false;
    if (missionType && row.mission_type !== missionType) return false;
    if (status && row.status !== status) return false;

    if (keyword) {
      var text = [
        row.vehicle_name,
        row.plate_no,
        row.driver_name,
        row.mission_type,
        row.destination,
        row.requester_name,
        row.requester_department,
        row.created_by_name
      ].join(' ').toLowerCase();
      if (text.indexOf(keyword) === -1) return false;
    }

    return true;
  }).sort(function (a, b) {
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
}

function findUsageRowById(logId) {
  var rows = readUsageRows();

  for (var i = 0; i < rows.length; i++) {
    if (rows[i].log_id === logId) {
      return rows[i];
    }
  }

  return null;
}

function updateVehicleMileageFromUsage(vehicleId, fallbackMileage) {
  vehicleId = String(vehicleId || '').trim();

  if (!vehicleId) {
    return null;
  }

  var vehicle = findObjectById(SHEET_NAMES.VEHICLES, 'vehicle_id', vehicleId);
  var baselineMileage = vehicle ? parseNumber(vehicle.current_mileage) : 0;

  if (fallbackMileage !== null && fallbackMileage !== undefined && fallbackMileage !== '') {
    baselineMileage = Math.max(baselineMileage, parseNumber(fallbackMileage));
  }

  var maxMileage = readUsageRows().reduce(function (maxValue, row) {
    if (row.vehicle_id !== vehicleId || row.status !== 'completed') {
      return maxValue;
    }

    return Math.max(maxValue, parseNumber(row.end_mileage));
  }, baselineMileage);

  var nextStatus = hasActiveUsageForVehicle(vehicleId) ? 'in_use' : 'available';

  return updateObjectById(SHEET_NAMES.VEHICLES, 'vehicle_id', vehicleId, {
    current_mileage: maxMileage,
    status: nextStatus,
    updated_at: nowString()
  });
}
