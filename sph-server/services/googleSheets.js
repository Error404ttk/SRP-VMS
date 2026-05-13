import { GoogleSpreadsheet } from 'google-spreadsheet';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { formatThaiDateTime } from '../utils/formatters.js';
import { RELEASE_NOTES } from '../utils/releaseNotes.js';

dotenv.config();

export const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const SHEET_NAMES = {
  VEHICLES: 'vehicles',
  DRIVERS: 'drivers',
  DEPARTMENTS: 'departments',
  MISSION_TYPES: 'mission_types',
  DESTINATIONS: 'destinations',
  USAGE_LOGS: 'vehicle_usage_logs',
  USERS: 'users',
  AUDIT_LOGS: 'audit_logs',
  USAGE_MONTHLY_SUMMARY: 'usage_monthly_summary',
  PROVIDER_LOGIN_PENDING: 'provider_login_pending',
  SETTINGS: 'settings'
};

class CustomGoogleJWT {
  constructor(options) {
    this.email = options.email;
    this.key = options.key;
    this.scopes = options.scopes;
    this.accessToken = null;
    this.expiry = 0;
  }

  async getRequestHeaders() {
    if (this.accessToken && Date.now() < this.expiry - 60000) {
      return { Authorization: `Bearer ${this.accessToken}` };
    }
    
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: this.email,
      scope: this.scopes.join(' '),
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    };
    
    const header = {
      alg: 'RS256',
      typ: 'JWT'
    };
    
    const base64UrlEncode = (obj) => {
      return Buffer.from(JSON.stringify(obj))
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    };
    
    const tokenInput = base64UrlEncode(header) + '.' + base64UrlEncode(payload);
    
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(tokenInput);
    const signature = sign.sign(this.key, 'base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
      
    const assertion = tokenInput + '.' + signature;
    
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: assertion
      })
    });
    
    const data = await response.json();
    if (!response.ok) {
      throw new Error(`Google OAuth Assertion Error: ${JSON.stringify(data)}`);
    }
    
    this.accessToken = data.access_token;
    this.expiry = Date.now() + (data.expires_in * 1000);
    
    return { Authorization: `Bearer ${this.accessToken}` };
  }
}

const serviceAccountAuth = new CustomGoogleJWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

export const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, serviceAccountAuth);

export const sheetCache = {};
export const sheetCacheTime = {};
export let masterDataCache = null;
export let masterDataCacheTime = 0;
export let systemSettingsCache = null;
export let systemSettingsCacheTime = 0;

export function invalidateCache(sheetName) {
  delete sheetCache[sheetName];
  delete sheetCacheTime[sheetName];
  if (Object.values(SHEET_NAMES).includes(sheetName)) {
    masterDataCache = null;
    masterDataCacheTime = 0;
  }
  if (sheetName === SHEET_NAMES.SETTINGS) {
    systemSettingsCache = null;
    systemSettingsCacheTime = 0;
  }
}

export async function getSheetRows(sheetName) {
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle[sheetName];
  if (!sheet) throw new Error(`ไม่พบชีตชื่อ ${sheetName}`);
  return await sheet.getRows();
}

export async function getRowsAsObjects(sheetName) {
  if (sheetCache[sheetName] && (Date.now() - sheetCacheTime[sheetName] < CACHE_TTL)) {
    return sheetCache[sheetName];
  }
  const rows = await getSheetRows(sheetName);
  const objects = rows.map(r => r.toObject());
  sheetCache[sheetName] = objects;
  sheetCacheTime[sheetName] = Date.now();
  return objects;
}

export async function appendRowObject(sheetName, obj) {
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle[sheetName];
  if (!sheet) throw new Error(`ไม่พบชีตชื่อ ${sheetName}`);
  const row = await sheet.addRow(obj);
  invalidateCache(sheetName);
  return row.toObject();
}

export async function findObjectById(sheetName, idKey, idValue) {
  const rows = await getSheetRows(sheetName);
  const row = rows.find(r => String(r.get(idKey) || '').trim() === String(idValue || '').trim());
  return row ? row.toObject() : null;
}

export async function updateObjectById(sheetName, idKey, idValue, updates) {
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle[sheetName];
  if (!sheet) throw new Error(`ไม่พบชีตชื่อ ${sheetName}`);
  const rows = await sheet.getRows();
  const row = rows.find(r => String(r.get(idKey) || '').trim() === String(idValue || '').trim());
  if (!row) throw new Error(`ไม่พบข้อมูลแถวที่มี ID ${idValue} ในชีต ${sheetName}`);
  
  for (const [key, value] of Object.entries(updates)) {
    row.set(key, value);
  }
  await row.save();
  invalidateCache(sheetName);
  return row.toObject();
}

export async function getMasterData() {
  if (masterDataCache && (Date.now() - masterDataCacheTime < CACHE_TTL)) {
    return masterDataCache;
  }
  await doc.loadInfo();
  
  const [vehicles, drivers, departments, missionTypes, destinations] = await Promise.all([
    doc.sheetsByTitle[SHEET_NAMES.VEHICLES].getRows(),
    doc.sheetsByTitle[SHEET_NAMES.DRIVERS].getRows(),
    doc.sheetsByTitle[SHEET_NAMES.DEPARTMENTS].getRows(),
    doc.sheetsByTitle[SHEET_NAMES.MISSION_TYPES].getRows(),
    doc.sheetsByTitle[SHEET_NAMES.DESTINATIONS].getRows()
  ]);

  const serialize = (rows) => rows.map(r => r.toObject());
  const isActive = (v) => String(v.status || '').trim().toLowerCase() === 'active';
  const isAvailable = (v) => String(v.status || '').trim().toLowerCase() === 'available';
  
  const objVehicles = serialize(vehicles);
  
  masterDataCache = {
    vehicles: objVehicles.filter(isAvailable),
    drivers: serialize(drivers).filter(isActive),
    departments: serialize(departments).filter(isActive),
    missionTypes: serialize(missionTypes).filter(isActive),
    destinations: serialize(destinations).filter(isActive)
  };
  
  console.log(`[MasterData] Vehicles: ${vehicles.length} total, ${masterDataCache.vehicles.length} active`);
  
  masterDataCacheTime = Date.now();
  return masterDataCache;
}

export async function writeAuditLog(action, module, detail, user) {
  try {
    const currentUser = user || {};
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle[SHEET_NAMES.AUDIT_LOGS];
    if (!sheet) return;
    
    await sheet.addRow({
      audit_id: crypto.randomUUID(),
      action: action || '',
      module: module || '',
      detail: detail || '',
      username: currentUser.username || '',
      full_name: currentUser.full_name || '',
      role: currentUser.role || '',
      timestamp: formatThaiDateTime(new Date()),
      user_agent: ''
    });
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
}

export async function getSystemSettings() {
  if (systemSettingsCache && (Date.now() - systemSettingsCacheTime < CACHE_TTL)) {
    return systemSettingsCache;
  }
  
  const defaults = {
    appName: 'ระบบบันทึกการใช้รถราชการ โรงพยาบาลสารภี',
    appShortName: 'SRP-VMS',
    hospitalName: 'โรงพยาบาลสารภี',
    fiscalYear: '2569',
    footerText: 'กลุ่มงานสารสนเทศทางการแพทย์ โรงพยาบาลสารภี',
    webAppUrl: '',
    logoUrl: '',
    appVersion: '2.0.0 (Node.js)',
    buildDate: new Date().toISOString().split('T')[0],
    releaseNotes: RELEASE_NOTES,
    providerLoginEnabled: !!process.env.HEALTH_ID_CLIENT_ID
  };

  try {
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle[SHEET_NAMES.SETTINGS];
    if (sheet) {
      const rows = await sheet.getRows();
      const settingsMap = {};
      rows.forEach(r => {
        const key = String(r.get('key') || '').trim();
        const val = String(r.get('value') || '').trim();
        if (key) {
          settingsMap[key] = val;
        }
      });

      if (settingsMap['app_name']) defaults.appName = settingsMap['app_name'];
      if (settingsMap['app_short_name']) defaults.appShortName = settingsMap['app_short_name'];
      if (settingsMap['hospital_name']) defaults.hospitalName = settingsMap['hospital_name'];
      if (settingsMap['fiscal_year']) defaults.fiscalYear = settingsMap['fiscal_year'];
      if (settingsMap['footer_text']) defaults.footerText = settingsMap['footer_text'];
      if (settingsMap['web_app_url']) defaults.webAppUrl = settingsMap['web_app_url'];
      if (settingsMap['logo_url']) defaults.logoUrl = settingsMap['logo_url'];
    }
  } catch (error) {
    console.warn('Failed to load dynamic settings from Google Sheet, using defaults:', error.message);
  }

  systemSettingsCache = defaults;
  systemSettingsCacheTime = Date.now();
  return defaults;
}
