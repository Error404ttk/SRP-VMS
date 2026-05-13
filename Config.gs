var APP_CONFIG = {
  APP_NAME: 'ระบบบันทึกการใช้รถราชการ โรงพยาบาลสารภี',
  APP_SHORT_NAME: 'SRP-VMS',
  HOSPITAL_NAME: 'โรงพยาบาลสารภี',
  FOOTER_TEXT: 'พัฒนาโดย งานยุทธศาสตร์ และสารสนเทศทางการแพทย์',
  APP_VERSION: '1',
  BUILD_DATE: '11/05/2569',
  TIMEZONE: 'Asia/Bangkok'
};

/** Shared constants — ลดการกระจาย magic numbers ทั่ว codebase */
var SESSION_TTL_SECONDS = 21600;
var LOGIN_MAX_FAILED_ATTEMPTS = 5;
var LOGIN_LOCKOUT_SECONDS = 900;
var PASSWORD_HASH_ITERATIONS = 12000;
var PROVIDER_CALLBACK_RATE_LIMIT = 30;
var PROVIDER_CALLBACK_RATE_WINDOW_SECONDS = 90;
var PROVIDER_AUTH_STATE_TTL_SECONDS = 600;
var MIN_ARCHIVE_RETENTION_DAYS = 90;
var MIN_AUDIT_RETENTION_DAYS = 30;
var SUMMARY_THRESHOLD_ROWS = 5000;
var REPORT_CSV_DIRECT_EXPORT_LIMIT = 5000;
var DEFAULT_ARCHIVE_RETENTION_DAYS = 730;

var PAGE_MAP = {
  'dashboard': 'Dashboard',
  'usage-form': 'UsageForm',
  'usage-list': 'UsageList',
  'master-data': 'MasterData',
  'vehicles': 'VehicleManage',
  'drivers': 'DriverManage',
  'departments': 'DepartmentManage',
  'mission-types': 'MissionTypeManage',
  'destinations': 'DestinationManage',
  'users': 'UserManage',
  'reports': 'Report',
  'audit-logs': 'AuditLog'
};

var RELEASE_NOTES = [
  {
    version: '2.0.0',
    date: '13/05/2569',
    title: 'Dynamic Page Permissions, Secure Row-Level Guards & UI Enhancements',
    items: [
      'เพิ่มระบบจัดการสิทธิ์รายบุคคลแบบ Dynamic Page-Level Permissions ติ๊กถูกรายหน้าจอผ่านหน้าจัดการผู้ใช้เฉพาะ Admin',
      'ยกระดับความปลอดภัยข้อมูลความมั่นคงสูง โดยปิดบังและสกัดกั้นไม่ให้ระดับสิทธิ์ manager หรือผู้ใช้ทั่วไปมองเห็น Provider ID, Account ID และ HCODE ทั้งฝั่งหน้าบ้านและหลังบ้าน API',
      'ปลดล็อกระบบกรองข้อมูลแถว (Row-Level Security) เพื่อให้สิทธิ์ Driver Head สามารถดูประวัติบันทึกการขอใช้รถของพนักงานทุกคนในองค์กรได้สมบูรณ์',
      'แก้ปัญหากล่องฟอร์ม Modal จัดการผู้ใช้งานล้นนอกจอในอุปกรณ์โทรศัพท์หรือจอขนาดเล็ก โดยพัฒนาเป็นระบบ Vertical Scroll และควบคุม margin บนทุกอุปกรณ์',
      'ปรับสิทธิ์การนำทางของแถบเมนูด้านซ้าย (Sidebar Menu) และระบบกรองความปลอดภัยระดับเส้นทาง (Route Guards) ให้คำนวณสิทธิ์แบบผสมผสาน',
      'แก้ไขสัญลักษณ์ยศตำแหน่งผู้ใช้ (Topbar & Layout Footer Roles) ขวาบนของบราวเซอร์และส่วนล่างของระบบหน้าบ้านทั้งหมด ให้ปรับเปลี่ยนแบบ Dynamic ตรงตามบทบาทจริง 5 บทบาท'
    ]
  },
  {
    version: '1',
    date: '12/05/2569',
    title: 'Provider ID account_id matching and root callback',
    items: [
      'ปรับ redirect URI หลักของ Provider ID เป็น Web App /exec ตามคู่มือและรองรับ callback ที่ไม่มี page parameter',
      'ปรับขั้นสุดท้ายให้ match profile.account_id กับ users.account_id ตามที่กำหนด',
      'เพิ่ม account_id ใน users และหน้าจัดการผู้ใช้งาน',
      'รองรับ callback ที่ไม่มี state โดยบันทึก audit warning เนื่องจากคู่มือระบุ state เป็น optional'
    ]
  },
  {
    version: '1',
    date: '12/05/2569',
    title: 'Provider ID signed state validation',
    items: [
      'ปรับ OAuth state ใหม่เป็น signed state พร้อม timestamp ลดการพึ่ง CacheService ระหว่าง redirect',
      'คงการตรวจ state แบบ hard validation เพื่อป้องกัน callback ที่ไม่ได้เริ่มจากปุ่ม Provider ID',
      'ยังรองรับ legacy state เดิมระหว่างช่วงเปลี่ยนผ่านและล้าง state หลังใช้งาน'
    ]
  },
  {
    version: '1',
    date: '12/05/2569',
    title: 'Provider ID state fallback',
    items: [
      'เพิ่ม ScriptProperties fallback สำหรับ Provider OAuth state นอกเหนือจาก CacheService',
      'ปรับข้อความ state error ให้บอกสาเหตุและวิธีเริ่ม login ใหม่ชัดเจนขึ้น',
      'คงอายุ state 10 นาทีและล้าง state หลัง callback ผ่านการตรวจสอบ'
    ]
  },
  {
    version: '1',
    date: '12/05/2569',
    title: 'Provider ID OAuth step test and account_id matching',
    items: [
      'ปรับ Provider ID login ให้ match ผู้ใช้ด้วย account_id จาก Provider profile กับ users.account_id ตามขั้นตอนที่กำหนด',
      'เพิ่มคอลัมน์ account_id ในฐานผู้ใช้งานสำหรับใช้เป็น key หลักของ Provider ID Login',
      'เพิ่มหน้าทดสอบ OAuth code เพื่อแสดงผลแต่ละ step ตามคู่มือแบบ masked ไม่แสดง token เต็ม',
      'ปรับข้อความหน้าทดสอบให้แยก authorization code, Health access_token และ Provider access_token ชัดเจน',
      'เพิ่ม validation ราย step เมื่อ access_token หรือ account_id หาย เพื่อ debug ได้ตรงจุด',
      'เพิ่ม audit log สำหรับการทดสอบ OAuth code ว่าพบหรือไม่พบ account_id ในฐานข้อมูล'
    ]
  },
  {
    version: '1',
    date: '12/05/2569',
    title: 'Security and export hardening',
    items: [
      'ปรับ session user payload ให้ mask Provider ID และ Hash CID ในหน้าทั่วไป',
      'เพิ่ม password hash รุ่นใหม่แบบ iterative SHA-256 และ migrate hash เดิมอัตโนมัติเมื่อ login',
      'คงข้อมูล Provider ID แบบเต็มเฉพาะ endpoint ผู้ดูแลระบบสำหรับจัดการผู้ใช้งาน',
      'จำกัด direct CSV export เมื่อข้อมูลเกิน 5,000 รายการเพื่อลด timeout และ memory pressure'
    ]
  },
  {
    version: '1',
    date: '11/05/2569',
    title: 'Provider ID callback validation',
    items: [
      'เพิ่มตัวตรวจ Health ID Client ID จาก callback เทียบกับ config ปัจจุบัน',
      'คง Provider ID login สำเร็จให้ redirect ตาม role: admin ไป Dashboard และ user ไป Usage Form',
      'ปรับคำอธิบายในหน้าจัดการผู้ใช้งานให้ชัดเจนเรื่องการผูก Provider ID จากรายการรอผูก',
      'เพิ่ม audit log สำหรับ error ระหว่าง Provider callback เพื่อไล่ปัญหาได้ง่ายขึ้น'
    ]
  },
  {
    version: '1',
    date: '11/05/2569',
    title: 'Provider ID pending and diagnostics',
    items: [
      'เพิ่มรายการ Provider ID ที่รอผูกผู้ใช้เมื่อ hcode ถูกต้องแต่ยังไม่พบ whitelist',
      'เพิ่มหน้าอนุมัติและผูก Provider ID กับผู้ใช้จากหน้า admin',
      'เพิ่ม masked diagnostic สำหรับ Provider config โดยไม่แสดง secret',
      'เพิ่มปุ่มทดสอบ Provider public-key endpoint',
      'เพิ่ม rate limit สำหรับ Provider callback'
    ]
  },
  {
    version: '1',
    date: '11/05/2569',
    title: 'Provider ID callback redirect',
    items: [
      'ปรับ callback หลัง Provider ID login สำเร็จให้ hydrate session แล้วพาไปหน้า dashboard หรือ usage-form จริง',
      'ลดโอกาส callback ถูก refresh แล้วใช้ OAuth code ซ้ำ',
      'ปรับข้อความ error จาก Health ID/Provider ID ให้แสดง HTTP status และ message ชัดขึ้น'
    ]
  },
  {
    version: '1',
    date: '11/05/2569',
    title: 'Provider ID Login UAT foundation',
    items: [
      'เพิ่ม service สำหรับ OAuth Health ID และ Provider ID',
      'เพิ่ม callback route สำหรับรับ code จาก Health ID',
      'เพิ่มปุ่มเข้าสู่ระบบด้วย Provider ID ที่หน้า Login',
      'เพิ่มหน้า admin สำหรับตั้งค่า UAT/PRD client, secret, hcode และ redirect URI ใน ScriptProperties',
      'เพิ่ม whitelist matching ด้วย hash_cid และ provider_id ก่อนสร้าง session'
    ]
  },
  {
    version: '1',
    date: '11/05/2569',
    title: 'Provider ID Login preparation - Step 2',
    items: [
      'เพิ่ม field ผู้ใช้งานสำหรับผูก Provider ID',
      'เพิ่ม Provider ID, Hash CID, HCODE, ชื่อจาก Provider และ Provider login ล่าสุดในฐานข้อมูล users',
      'ปรับหน้า User Manage ให้ผู้ดูแลระบบบันทึกข้อมูลสำหรับ whitelist Provider ID Login ได้',
      'เพิ่มการ sync header ที่ขาดในชีตเดิมแบบ backward-compatible'
    ]
  },
  {
    version: '1',
    date: '11/05/2569',
    deploymentVersion: '83+',
    title: 'Summary mode, Release Notes history และ admin tool hardening',
    items: [
      'เพิ่ม Release Notes เป็นประวัติการอัปเดตแบบหลายรายการ',
      'แยก Release Notes เป็นไฟล์กลาง ใช้ร่วมกันทั้งหน้า Login และหน้าหลังเข้าสู่ระบบ',
      'เพิ่ม wrapper กลางสำหรับ google.script.run พร้อม failure handler',
      'เพิ่ม Dashboard/Report summary mode เมื่อข้อมูลรายการใช้รถมีจำนวนมาก',
      'เพิ่มปุ่มอัปเดตวันที่ build และประวัติเครื่องมือผู้ดูแลระบบล่าสุด'
    ]
  },
  {
    version: '1',
    date: '11/05/2569',
    deploymentVersion: '83',
    title: 'Master data tabs and admin tools',
    items: [
      'รวมหน้าจัดการข้อมูลหลักเป็นหน้าเดียวแบบ tabs',
      'เพิ่ม search/filter สำหรับข้อมูลหลัก',
      'เพิ่มเครื่องมือตรวจรายการใช้รถที่อ้างถึงข้อมูลหลักที่หายหรือปิดใช้งาน',
      'เพิ่มเครื่องมือ Archive schedule และสร้างสรุปรายเดือน',
      'เพิ่มชีต usage_monthly_summary สำหรับข้อมูลสรุปรายเดือน'
    ]
  },
  {
    version: '1',
    date: '11/05/2569',
    deploymentVersion: '82',
    title: 'Master data validation and menu grouping',
    items: [
      'เพิ่ม duplicate validation สำหรับหน่วยงาน ประเภทภารกิจ และสถานที่ไป',
      'เพิ่ม server-side validation ให้แบบฟอร์มใช้รถตรวจว่า master data ยัง active',
      'แยก cache invalidation รายชนิด',
      'จัดกลุ่มเมนูข้อมูลหลักสำหรับผู้ดูแลระบบ'
    ]
  },
  {
    version: '1',
    date: '11/05/2569',
    title: 'Departments, destinations and mission types',
    items: [
      'เพิ่มการจัดการหน่วยงานผู้ขอใช้รถ',
      'เพิ่มการจัดการสถานที่ไป',
      'เพิ่มการจัดการประเภทภารกิจ',
      'เชื่อมตัวเลือก master data เข้ากับ Usage Form, Usage List, Dashboard และ Report'
    ]
  },
  {
    version: '1',
    date: '11/05/2569',
    title: 'Dashboard date/time and trend fixes',
    items: [
      'ปรับรูปแบบวันที่เป็น วัน/เดือน/ปี พ.ศ.',
      'แก้แนวโน้มจำนวนครั้งการใช้รถรายวันให้คำนวณจากข้อมูลจริง',
      'ตรวจและปรับเวลาออก-กลับให้แสดงรูปแบบเดียวกัน',
      'ปรับ Dashboard filter ให้เลือกช่วงวันที่ เดือน และปีงบประมาณได้ชัดเจน'
    ]
  },
  {
    version: '1',
    date: '11/05/2569',
    title: 'Usage close workflow',
    items: [
      'ปรับแบบฟอร์มบันทึกการใช้รถให้เริ่มงานโดยยังไม่ต้องกรอกเลขไมล์หลังกลับ',
      'เพิ่มขั้นตอนปิดงานใช้รถพร้อมเวลากลับและเลขไมล์หลังกลับ',
      'แก้การดึงเวลาออกในหน้าปิดงานใช้รถ',
      'ปรับสถานะรถเป็นกำลังใช้งานระหว่างรายการยังไม่ปิดงาน'
    ]
  },
  {
    version: '1',
    date: '11/05/2569',
    title: 'Security and performance hardening',
    items: [
      'เพิ่ม password hashing/migration',
      'เพิ่ม login lockout และ session re-check',
      'เพิ่ม pagination/load more ใน Usage List, Report และ Audit Log',
      'เพิ่ม server-side input length validation'
    ]
  },
  {
    version: '1',
    date: '11/05/2569',
    title: 'User management and audit logs',
    items: [
      'เพิ่มหน้าและบริการจัดการผู้ใช้งาน',
      'เพิ่มหน้า Audit Log สำหรับประวัติการใช้งานระบบ',
      'เพิ่มการบันทึก audit สำหรับการกระทำสำคัญของผู้ดูแลระบบ'
    ]
  },
  {
    version: '1',
    date: '11/05/2569',
    title: 'Report and CSV export',
    items: [
      'เพิ่มรายงานการใช้รถพร้อม filter',
      'เพิ่ม Export CSV แบบ UTF-8 BOM',
      'จำกัดสิทธิ์รายงานและ export ให้เฉพาะผู้ดูแลระบบ',
      'เพิ่ม audit log สำหรับ EXPORT_REPORT'
    ]
  },
  {
    version: '1',
    date: '11/05/2569',
    title: 'Core vehicle usage workflow',
    items: [
      'เพิ่ม CRUD รถราชการ',
      'เพิ่ม CRUD พนักงานขับรถ',
      'เพิ่มแบบฟอร์มบันทึกการใช้รถ',
      'เพิ่มรายการใช้รถพร้อม filter, edit และ cancel',
      'เพิ่ม Dashboard API และ Dashboard UI พร้อม Chart.js'
    ]
  }
];

var SHEET_NAMES = {
  USERS: 'users',
  VEHICLES: 'vehicles',
  DRIVERS: 'drivers',
  DEPARTMENTS: 'departments',
  MISSION_TYPES: 'mission_types',
  DESTINATIONS: 'destinations',
  USAGE_LOGS: 'vehicle_usage_logs',
  USAGE_LOGS_ARCHIVE: 'vehicle_usage_logs_archive',
  USAGE_MONTHLY_SUMMARY: 'usage_monthly_summary',
  SETTINGS: 'settings',
  PROVIDER_LOGIN_PENDING: 'provider_login_pending',
  AUDIT_LOGS: 'audit_logs'
};

var SHEET_HEADERS = {
  users: [
    'user_id',
    'username',
    'password',
    'full_name',
    'role',
    'department',
    'status',
    'created_at',
    'updated_at',
    'last_login',
    'account_id',
    'provider_id',
    'hash_cid',
    'hcode',
    'provider_name',
    'provider_last_login',
    'allowed_pages'
  ],
  vehicles: [
    'vehicle_id',
    'plate_no',
    'vehicle_name',
    'vehicle_type',
    'brand_model',
    'fuel_type',
    'current_mileage',
    'status',
    'remark',
    'created_at',
    'updated_at'
  ],
  drivers: [
    'driver_id',
    'full_name',
    'phone',
    'license_no',
    'status',
    'remark',
    'created_at',
    'updated_at'
  ],
  departments: [
    'department_id',
    'department_name',
    'status',
    'remark',
    'created_at',
    'updated_at'
  ],
  mission_types: [
    'mission_type_id',
    'mission_type_name',
    'status',
    'remark',
    'created_at',
    'updated_at'
  ],
  destinations: [
    'destination_id',
    'destination_name',
    'status',
    'remark',
    'created_at',
    'updated_at'
  ],
  vehicle_usage_logs: [
    'log_id',
    'usage_date',
    'start_time',
    'end_time',
    'vehicle_id',
    'plate_no',
    'vehicle_name',
    'driver_id',
    'driver_name',
    'mission_type',
    'destination',
    'requester_name',
    'requester_department',
    'start_mileage',
    'end_mileage',
    'total_km',
    'passenger_count',
    'note',
    'status',
    'created_by',
    'created_by_name',
    'created_at',
    'updated_at',
    'cancel_reason'
  ],
  vehicle_usage_logs_archive: [
    'log_id',
    'usage_date',
    'start_time',
    'end_time',
    'vehicle_id',
    'plate_no',
    'vehicle_name',
    'driver_id',
    'driver_name',
    'mission_type',
    'destination',
    'requester_name',
    'requester_department',
    'start_mileage',
    'end_mileage',
    'total_km',
    'passenger_count',
    'note',
    'status',
    'created_by',
    'created_by_name',
    'created_at',
    'updated_at',
    'cancel_reason'
  ],
  usage_monthly_summary: [
    'summary_month',
    'vehicle_id',
    'vehicle_name',
    'driver_id',
    'driver_name',
    'mission_type',
    'trip_count',
    'completed_trip_count',
    'total_km',
    'updated_at'
  ],
  settings: [
    'key',
    'value',
    'description'
  ],
  provider_login_pending: [
    'pending_id',
    'account_id',
    'provider_id',
    'hash_cid',
    'provider_name',
    'hcode',
    'hname_th',
    'position',
    'status',
    'matched_user_id',
    'note',
    'created_at',
    'updated_at',
    'last_seen_at'
  ],
  audit_logs: [
    'audit_id',
    'action',
    'module',
    'detail',
    'username',
    'full_name',
    'role',
    'timestamp',
    'user_agent'
  ]
};

var MISSION_TYPES = [
  'Refer ผู้ป่วย',
  'รับผู้ป่วยกลับ',
  'ออกหน่วยบริการ',
  'ออกชันสูตร',
  'ประชุม/อบรม/สัมมนา',
  'ส่งเอกสารราชการ',
  'รับ-ส่งเจ้าหน้าที่',
  'ซ่อมบำรุง/ตรวจสภาพรถ',
  'ราชการทั่วไป',
  'อื่น ๆ'
];

function getAppConfig() {
  var settings = [];
  var webAppUrl = '';
  var spreadsheetId = '';

  try {
    spreadsheetId = getSpreadsheet().getId();
    settings = getRowsAsObjects(SHEET_NAMES.SETTINGS);
  } catch (error) {
    settings = [];
  }

  try {
    webAppUrl = ScriptApp.getService().getUrl();
  } catch (error) {
    webAppUrl = '';
  }

  var config = {
    appName: APP_CONFIG.APP_NAME,
    appShortName: APP_CONFIG.APP_SHORT_NAME,
    hospitalName: APP_CONFIG.HOSPITAL_NAME,
    footerText: APP_CONFIG.FOOTER_TEXT,
    appVersion: APP_CONFIG.APP_VERSION,
    buildDate: PropertiesService.getScriptProperties().getProperty('APP_BUILD_DATE') || APP_CONFIG.BUILD_DATE,
    releaseNotes: RELEASE_NOTES,
    providerLoginEnabled: isProviderAuthConfigured(),
    timezone: APP_CONFIG.TIMEZONE,
    missionTypes: MISSION_TYPES,
    webAppUrl: webAppUrl,
    spreadsheetId: spreadsheetId
  };

  return config;
}

function updateBuildDate(token) {
  try {
    var user = requireAdmin(token);
    var buildDate = formatThaiBuddhistDate(formatIsoDate(new Date()));

    PropertiesService.getScriptProperties().setProperty('APP_BUILD_DATE', buildDate);
    writeAuditLog('UPDATE_BUILD_DATE', 'System', 'อัปเดตวันที่ build เป็น ' + buildDate, user);

    return successResponse('อัปเดตวันที่ build เรียบร้อยแล้ว', {
      buildDate: buildDate
    });
  } catch (error) {
    return errorResponse(error.message, null);
  }
}
