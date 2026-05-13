function getDestinations(token) {
  try {
    requireAdmin(token);
    return successResponse('โหลดข้อมูลสถานที่ไปเรียบร้อยแล้ว', readDestinationRows());
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function createDestination(payload, token) {
  try {
    var user = requireAdmin(token);
    var data = validateDestinationPayload(payload);
    assertUniqueDestinationName(data.destination_name, '');
    var now = nowString();
    var destination = {
      destination_id: generateUuid(),
      destination_name: data.destination_name,
      status: data.status,
      remark: data.remark,
      created_at: now,
      updated_at: now
    };

    appendRowObject(SHEET_NAMES.DESTINATIONS, destination);
    clearDestinationCache();
    writeAuditLog('CREATE_DESTINATION', 'Destination', 'เพิ่มสถานที่ไป: ' + destination.destination_name, user);

    return successResponse('เพิ่มสถานที่ไปเรียบร้อยแล้ว', destination);
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function updateDestination(destinationId, payload, token) {
  try {
    var user = requireAdmin(token);
    destinationId = String(destinationId || '').trim();

    if (!destinationId) {
      return errorResponse('ไม่พบรหัสสถานที่ไป', null);
    }

    if (!findObjectById(SHEET_NAMES.DESTINATIONS, 'destination_id', destinationId)) {
      return errorResponse('ไม่พบข้อมูลสถานที่ไป', null);
    }

    var data = validateDestinationPayload(payload);
    assertUniqueDestinationName(data.destination_name, destinationId);
    var updatedDestination = updateObjectById(SHEET_NAMES.DESTINATIONS, 'destination_id', destinationId, {
      destination_name: data.destination_name,
      status: data.status,
      remark: data.remark,
      updated_at: nowString()
    });

    clearDestinationCache();
    writeAuditLog('UPDATE_DESTINATION', 'Destination', 'แก้ไขสถานที่ไป: ' + data.destination_name, user);

    return successResponse('แก้ไขสถานที่ไปเรียบร้อยแล้ว', updatedDestination);
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function assertUniqueDestinationName(destinationName, currentDestinationId) {
  var normalizedName = String(destinationName || '').trim().toLowerCase();
  var currentId = String(currentDestinationId || '').trim();
  var duplicate = readDestinationRows().some(function (destination) {
    return destination.destination_id !== currentId && String(destination.destination_name || '').trim().toLowerCase() === normalizedName;
  });

  if (duplicate) {
    throw new Error('มีสถานที่ไปนี้อยู่แล้ว');
  }
}

function getCachedActiveDestinations() {
  var cached = getCachedJson('SPH_ACTIVE_DESTINATIONS');

  if (cached) {
    return cached;
  }

  var destinations = readDestinationRows().filter(function (destination) {
    return destination.status === 'active';
  });

  return putCachedJson('SPH_ACTIVE_DESTINATIONS', destinations, 120);
}

function validateDestinationPayload(payload) {
  var data = payload || {};
  var destinationName = enforceMaxLength(data.destination_name, 255, 'ชื่อสถานที่ไป');
  var status = String(data.status || '').trim();

  if (!destinationName) {
    throw new Error('กรุณากรอกชื่อสถานที่ไป');
  }

  if (status !== 'active' && status !== 'inactive') {
    throw new Error('สถานะสถานที่ไปไม่ถูกต้อง');
  }

  return {
    destination_name: destinationName,
    status: status,
    remark: enforceMaxLength(data.remark, 500, 'หมายเหตุ')
  };
}

function readDestinationRows() {
  return readSheetRowsBySchema(SHEET_NAMES.DESTINATIONS, SHEET_HEADERS.destinations)
    .filter(function (destination) {
      return String(destination.destination_id || destination.destination_name || '').trim() !== '';
    })
    .map(function (destination) {
      return {
        destination_id: String(destination.destination_id || ''),
        destination_name: String(destination.destination_name || ''),
        status: String(destination.status || ''),
        remark: String(destination.remark || ''),
        created_at: String(destination.created_at || ''),
        updated_at: String(destination.updated_at || '')
      };
    });
}
