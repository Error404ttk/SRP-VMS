function getMissionTypes(token) {
  try {
    requireAdmin(token);
    return successResponse('โหลดข้อมูลประเภทภารกิจเรียบร้อยแล้ว', readMissionTypeRows());
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function createMissionType(payload, token) {
  try {
    var user = requireAdmin(token);
    var data = validateMissionTypePayload(payload);
    assertUniqueMissionTypeName(data.mission_type_name, '');
    var now = nowString();
    var missionType = {
      mission_type_id: generateUuid(),
      mission_type_name: data.mission_type_name,
      status: data.status,
      remark: data.remark,
      created_at: now,
      updated_at: now
    };

    appendRowObject(SHEET_NAMES.MISSION_TYPES, missionType);
    clearMissionTypeCache();
    writeAuditLog('CREATE_MISSION_TYPE', 'MissionType', 'เพิ่มประเภทภารกิจ: ' + missionType.mission_type_name, user);

    return successResponse('เพิ่มประเภทภารกิจเรียบร้อยแล้ว', missionType);
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function updateMissionType(missionTypeId, payload, token) {
  try {
    var user = requireAdmin(token);
    missionTypeId = String(missionTypeId || '').trim();

    if (!missionTypeId) {
      return errorResponse('ไม่พบรหัสประเภทภารกิจ', null);
    }

    if (!findObjectById(SHEET_NAMES.MISSION_TYPES, 'mission_type_id', missionTypeId)) {
      return errorResponse('ไม่พบข้อมูลประเภทภารกิจ', null);
    }

    var data = validateMissionTypePayload(payload);
    assertUniqueMissionTypeName(data.mission_type_name, missionTypeId);
    var updatedMissionType = updateObjectById(SHEET_NAMES.MISSION_TYPES, 'mission_type_id', missionTypeId, {
      mission_type_name: data.mission_type_name,
      status: data.status,
      remark: data.remark,
      updated_at: nowString()
    });

    clearMissionTypeCache();
    writeAuditLog('UPDATE_MISSION_TYPE', 'MissionType', 'แก้ไขประเภทภารกิจ: ' + data.mission_type_name, user);

    return successResponse('แก้ไขประเภทภารกิจเรียบร้อยแล้ว', updatedMissionType);
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function assertUniqueMissionTypeName(missionTypeName, currentMissionTypeId) {
  var normalizedName = String(missionTypeName || '').trim().toLowerCase();
  var currentId = String(currentMissionTypeId || '').trim();
  var duplicate = readMissionTypeRows().some(function (missionType) {
    return missionType.mission_type_id !== currentId && String(missionType.mission_type_name || '').trim().toLowerCase() === normalizedName;
  });

  if (duplicate) {
    throw new Error('มีประเภทภารกิจนี้อยู่แล้ว');
  }
}

function getCachedActiveMissionTypes() {
  var cached = getCachedJson('SPH_ACTIVE_MISSION_TYPES');

  if (cached) {
    return cached;
  }

  var missionTypes = readMissionTypeRows().filter(function (missionType) {
    return missionType.status === 'active';
  });

  return putCachedJson('SPH_ACTIVE_MISSION_TYPES', missionTypes, 120);
}

function validateMissionTypePayload(payload) {
  var data = payload || {};
  var missionTypeName = enforceMaxLength(data.mission_type_name, 120, 'ชื่อประเภทภารกิจ');
  var status = String(data.status || '').trim();

  if (!missionTypeName) {
    throw new Error('กรุณากรอกชื่อประเภทภารกิจ');
  }

  if (status !== 'active' && status !== 'inactive') {
    throw new Error('สถานะประเภทภารกิจไม่ถูกต้อง');
  }

  return {
    mission_type_name: missionTypeName,
    status: status,
    remark: enforceMaxLength(data.remark, 500, 'หมายเหตุ')
  };
}

function readMissionTypeRows() {
  return readSheetRowsBySchema(SHEET_NAMES.MISSION_TYPES, SHEET_HEADERS.mission_types)
    .filter(function (missionType) {
      return String(missionType.mission_type_id || missionType.mission_type_name || '').trim() !== '';
    })
    .map(function (missionType) {
      return {
        mission_type_id: String(missionType.mission_type_id || ''),
        mission_type_name: String(missionType.mission_type_name || ''),
        status: String(missionType.status || ''),
        remark: String(missionType.remark || ''),
        created_at: String(missionType.created_at || ''),
        updated_at: String(missionType.updated_at || '')
      };
    });
}
