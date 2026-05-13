function getDepartments(token) {
  try {
    requireAdmin(token);
    return successResponse('โหลดข้อมูลหน่วยงานเรียบร้อยแล้ว', readDepartmentRows());
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function getActiveDepartments(token) {
  try {
    requireAuth(token);
    return successResponse('โหลดข้อมูลหน่วยงานที่ใช้งานเรียบร้อยแล้ว', getCachedActiveDepartments());
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function createDepartment(payload, token) {
  try {
    var user = requireAdmin(token);
    var data = validateDepartmentPayload(payload);
    assertUniqueDepartmentName(data.department_name, '');
    var now = nowString();
    var department = {
      department_id: generateUuid(),
      department_name: data.department_name,
      status: data.status,
      remark: data.remark,
      created_at: now,
      updated_at: now
    };

    appendRowObject(SHEET_NAMES.DEPARTMENTS, department);
    clearDepartmentCache();
    writeAuditLog('CREATE_DEPARTMENT', 'Department', 'เพิ่มหน่วยงาน: ' + department.department_name, user);

    return successResponse('เพิ่มหน่วยงานเรียบร้อยแล้ว', department);
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function updateDepartment(departmentId, payload, token) {
  try {
    var user = requireAdmin(token);
    departmentId = String(departmentId || '').trim();

    if (!departmentId) {
      return errorResponse('ไม่พบรหัสหน่วยงาน', null);
    }

    var existingDepartment = findObjectById(SHEET_NAMES.DEPARTMENTS, 'department_id', departmentId);

    if (!existingDepartment) {
      return errorResponse('ไม่พบข้อมูลหน่วยงาน', null);
    }

    var data = validateDepartmentPayload(payload);
    assertUniqueDepartmentName(data.department_name, departmentId);
    var updatedDepartment = updateObjectById(SHEET_NAMES.DEPARTMENTS, 'department_id', departmentId, {
      department_name: data.department_name,
      status: data.status,
      remark: data.remark,
      updated_at: nowString()
    });

    clearDepartmentCache();
    writeAuditLog('UPDATE_DEPARTMENT', 'Department', 'แก้ไขหน่วยงาน: ' + data.department_name, user);

    return successResponse('แก้ไขหน่วยงานเรียบร้อยแล้ว', updatedDepartment);
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function assertUniqueDepartmentName(departmentName, currentDepartmentId) {
  var normalizedName = String(departmentName || '').trim().toLowerCase();
  var currentId = String(currentDepartmentId || '').trim();
  var duplicate = readDepartmentRows().some(function (department) {
    return department.department_id !== currentId && String(department.department_name || '').trim().toLowerCase() === normalizedName;
  });

  if (duplicate) {
    throw new Error('มีหน่วยงานนี้อยู่แล้ว');
  }
}

function getCachedActiveDepartments() {
  var cached = getCachedJson('SPH_ACTIVE_DEPARTMENTS');

  if (cached) {
    return cached;
  }

  var departments = readDepartmentRows().filter(function (department) {
    return department.status === 'active';
  });

  return putCachedJson('SPH_ACTIVE_DEPARTMENTS', departments, 120);
}

function validateDepartmentPayload(payload) {
  var data = payload || {};
  var departmentName = enforceMaxLength(data.department_name, 120, 'ชื่อหน่วยงาน');
  var status = String(data.status || '').trim();

  if (!departmentName) {
    throw new Error('กรุณากรอกชื่อหน่วยงาน');
  }

  if (status !== 'active' && status !== 'inactive') {
    throw new Error('สถานะหน่วยงานไม่ถูกต้อง');
  }

  return {
    department_name: departmentName,
    status: status,
    remark: enforceMaxLength(data.remark, 500, 'หมายเหตุ')
  };
}

function readDepartmentRows() {
  return readSheetRowsBySchema(SHEET_NAMES.DEPARTMENTS, SHEET_HEADERS.departments)
    .filter(function (department) {
      return String(department.department_id || department.department_name || '').trim() !== '';
    })
    .map(function (department) {
      return {
        department_id: String(department.department_id || ''),
        department_name: String(department.department_name || ''),
        status: String(department.status || ''),
        remark: String(department.remark || ''),
        created_at: String(department.created_at || ''),
        updated_at: String(department.updated_at || '')
      };
    });
}
