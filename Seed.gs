function setupSheets() {
  Object.keys(SHEET_HEADERS).forEach(function (sheetName) {
    var sheet = getOrCreateSheet(sheetName);
    setHeadersIfEmpty(sheet, SHEET_HEADERS[sheetName]);
  });

  return successResponse('สร้าง Sheets และ Headers เรียบร้อยแล้ว', {
    sheets: Object.keys(SHEET_HEADERS)
  });
}

function seedInitialData() {
  setupSheets();

  seedUsers();
  seedVehicles();
  seedDrivers();
  seedDepartments();
  seedMissionTypes();
  seedDestinations();
  seedSettings();

  return successResponse('Seed ข้อมูลเริ่มต้นเรียบร้อยแล้ว', {});
}

function setupAndSeed() {
  setupSheets();
  seedInitialData();

  return successResponse('ตั้งค่า Sheets และ Seed ข้อมูลเริ่มต้นเรียบร้อยแล้ว', {});
}

function seedUsers() {
  var existingUsers = getRowsAsObjects(SHEET_NAMES.USERS);
  var now = nowString();
  var users = [
    {
      username: 'admin',
      password: 'admin1234',
      full_name: 'ผู้ดูแลระบบ',
      role: 'admin',
      department: 'งานแผนงานและสารสนเทศ',
      status: 'active'
    },
    {
      username: 'driver01',
      password: '123456',
      full_name: 'พนักงานขับรถ ตัวอย่าง',
      role: 'user',
      department: 'งานยานพาหนะ',
      status: 'active'
    }
  ];

  users.forEach(function (user) {
    var exists = existingUsers.some(function (row) {
      return row.username === user.username;
    });

    if (!exists) {
      // Hash password before storing for security.
      appendRowObject(SHEET_NAMES.USERS, {
        user_id: generateUuid(),
        username: user.username,
        password: hashPassword(user.password),
        full_name: user.full_name,
        role: user.role,
        department: user.department,
        status: user.status,
        created_at: now,
        updated_at: now,
        last_login: '',
        provider_id: '',
        hash_cid: '',
        hcode: '',
        provider_name: '',
        provider_last_login: ''
      });
    }
  });
}

function seedVehicles() {
  var existingVehicles = getRowsAsObjects(SHEET_NAMES.VEHICLES);
  var now = nowString();
  var vehicleNames = [
    'รถ Refer 1',
    'รถ Refer 2',
    'รถตู้ราชการ',
    'รถกระบะออกหน่วย',
    'รถเก๋งราชการ'
  ];

  vehicleNames.forEach(function (vehicleName, index) {
    var exists = existingVehicles.some(function (row) {
      return row.vehicle_name === vehicleName;
    });

    if (!exists) {
      appendRowObject(SHEET_NAMES.VEHICLES, {
        vehicle_id: generateUuid(),
        plate_no: '',
        vehicle_name: vehicleName,
        vehicle_type: '',
        brand_model: '',
        fuel_type: '',
        current_mileage: 0,
        status: 'available',
        remark: 'ข้อมูลเริ่มต้นลำดับที่ ' + (index + 1),
        created_at: now,
        updated_at: now
      });
    }
  });
}

function seedDrivers() {
  var existingDrivers = getRowsAsObjects(SHEET_NAMES.DRIVERS);
  var now = nowString();
  var driverNames = [
    'พนักงานขับรถ ตัวอย่าง 1',
    'พนักงานขับรถ ตัวอย่าง 2'
  ];

  driverNames.forEach(function (driverName) {
    var exists = existingDrivers.some(function (row) {
      return row.full_name === driverName;
    });

    if (!exists) {
      appendRowObject(SHEET_NAMES.DRIVERS, {
        driver_id: generateUuid(),
        full_name: driverName,
        phone: '',
        license_no: '',
        status: 'active',
        remark: '',
        created_at: now,
        updated_at: now
      });
    }
  });
}

function seedDepartments() {
  var existingDepartments = getRowsAsObjects(SHEET_NAMES.DEPARTMENTS);
  var now = nowString();
  var departmentNames = [
    'งานยานพาหนะ',
    'งานแผนงานและสารสนเทศ',
    'กลุ่มงานการพยาบาล',
    'งานบริหารทั่วไป',
    'งานเวชระเบียน',
    'งานการเงินและบัญชี'
  ];

  departmentNames.forEach(function (departmentName) {
    var exists = existingDepartments.some(function (row) {
      return row.department_name === departmentName;
    });

    if (!exists) {
      appendRowObject(SHEET_NAMES.DEPARTMENTS, {
        department_id: generateUuid(),
        department_name: departmentName,
        status: 'active',
        remark: '',
        created_at: now,
        updated_at: now
      });
    }
  });
}

function seedMissionTypes() {
  var existingMissionTypes = getRowsAsObjects(SHEET_NAMES.MISSION_TYPES);
  var now = nowString();

  MISSION_TYPES.forEach(function (missionTypeName) {
    var exists = existingMissionTypes.some(function (row) {
      return row.mission_type_name === missionTypeName;
    });

    if (!exists) {
      appendRowObject(SHEET_NAMES.MISSION_TYPES, {
        mission_type_id: generateUuid(),
        mission_type_name: missionTypeName,
        status: 'active',
        remark: '',
        created_at: now,
        updated_at: now
      });
    }
  });
}

function seedDestinations() {
  var existingDestinations = getRowsAsObjects(SHEET_NAMES.DESTINATIONS);
  var now = nowString();
  var destinationNames = [
    'โรงพยาบาลนครพิงค์',
    'โรงพยาบาลมหาราชนครเชียงใหม่',
    'สำนักงานสาธารณสุขจังหวัดเชียงใหม่',
    'โรงพยาบาลสารภี',
    'ศูนย์ราชการจังหวัดเชียงใหม่'
  ];

  destinationNames.forEach(function (destinationName) {
    var exists = existingDestinations.some(function (row) {
      return row.destination_name === destinationName;
    });

    if (!exists) {
      appendRowObject(SHEET_NAMES.DESTINATIONS, {
        destination_id: generateUuid(),
        destination_name: destinationName,
        status: 'active',
        remark: '',
        created_at: now,
        updated_at: now
      });
    }
  });
}

function seedSettings() {
  var existingSettings = getRowsAsObjects(SHEET_NAMES.SETTINGS);
  var settings = [
    {
      key: 'app_name',
      value: 'ระบบบันทึกการใช้รถราชการ โรงพยาบาลสารภี',
      description: 'ชื่อระบบ'
    },
    {
      key: 'app_short_name',
      value: 'SRP-VMS',
      description: 'ชื่อย่อระบบ'
    },
    {
      key: 'hospital_name',
      value: 'โรงพยาบาลสารภี',
      description: 'ชื่อหน่วยงาน'
    },
    {
      key: 'fiscal_year',
      value: '2569',
      description: 'ปีงบประมาณเริ่มต้น'
    },
    {
      key: 'footer_text',
      value: 'พัฒนาโดย งานยุทธศาสตร์ และสารสนเทศทางการแพทย์',
      description: 'ข้อความ Footer'
    },
    {
      key: 'web_app_url',
      value: '',
      description: 'URL Web App หลัง Deploy'
    },
    {
      key: 'logo_url',
      value: '',
      description: 'URL Logo ระบบ'
    }
  ];

  settings.forEach(function (setting) {
    var exists = existingSettings.some(function (row) {
      return row.key === setting.key;
    });

    if (!exists) {
      appendRowObject(SHEET_NAMES.SETTINGS, setting);
    }
  });
}
