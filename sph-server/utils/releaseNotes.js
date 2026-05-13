export const RELEASE_NOTES = [
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
    version: '1.0.0',
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
    version: '1.0.0',
    date: '12/05/2569',
    title: 'Provider ID signed state validation',
    items: [
      'ปรับ OAuth state ใหม่เป็น signed state พร้อม timestamp ลดการพึ่ง CacheService ระหว่าง redirect',
      'คงการตรวจ state แบบ hard validation เพื่อป้องกัน callback ที่ไม่ได้เริ่มจากปุ่ม Provider ID',
      'ยังรองรับ legacy state เดิมระหว่างช่วงเปลี่ยนผ่านและล้าง state หลังใช้งาน'
    ]
  },
  {
    version: '1.0.0',
    date: '12/05/2569',
    title: 'Provider ID state fallback',
    items: [
      'เพิ่ม ScriptProperties fallback สำหรับ Provider OAuth state นอกเหนือจาก CacheService',
      'ปรับข้อความ state error ให้บอกสาเหตุและวิธีเริ่ม login ใหม่ชัดเจนขึ้น',
      'คงอายุ state 10 นาทีและล้าง state หลัง callback ผ่านการตรวจสอบ'
    ]
  },
  {
    version: '1.0.0',
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
    version: '1.0.0',
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
    version: '1.0.0',
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
    version: '1.0.0',
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
    version: '1.0.0',
    date: '11/05/2569',
    title: 'Provider ID callback redirect',
    items: [
      'ปรับ callback หลัง Provider ID login สำเร็จให้ hydrate session แล้วพาไปหน้า dashboard หรือ usage-form จริง',
      'ลดโอกาส callback ถูก refresh แล้วใช้ OAuth code ซ้ำ',
      'ปรับข้อความ error จาก Health ID/Provider ID ให้แสดง HTTP status และ message ชัดขึ้น'
    ]
  },
  {
    version: '1.0.0',
    date: '11/05/2569',
    title: 'Provider ID Login UAT foundation',
    items: [
      'เพิ่ม service สำหรับ OAuth Health ID และ Provider ID',
      'เพิ่ม callback route สำหรับรับ code จาก Health ID',
      'เพิ่มปุ่มเข้าสู่ระบบด้วย Provider ID ที่หน้า Login',
      'เพิ่มหน้า admin สำหรับตั้งค่า UAT/PRD client, secret, hcode และ redirect URI ใน ScriptProperties',
      'เพิ่ม whitelist matching ด้วย hash_cid และ provider_id ก่อนสร้าง session'
    ]
  }
];
