import dotenv from 'dotenv';
dotenv.config();

export const appConfig = {
  appShortName: 'SRP-VMS',
  appName: 'ระบบบันทึกการใช้รถราชการ โรงพยาบาลสารภี',
  hospitalName: 'โรงพยาบาลสารภี',
  footerText: 'กลุ่มงานสารสนเทศทางการแพทย์ โรงพยาบาลสารภี',
  appVersion: '2.0.0 (Node.js)',
  buildDate: new Date().toISOString().split('T')[0],
  providerLoginEnabled: !!process.env.HEALTH_ID_CLIENT_ID
};

export const UI_PAGES = {
  'dashboard': 'dashboard',
  'usage-form': 'usage-form', 
  'usage-list': 'usage-list', 
  'master-data': 'master-data', 
  'users': 'user-manage', 
  'reports': 'report', 
  'audit-logs': 'audit-log',
  'vehicles': 'vehicle-manage',
  'drivers': 'driver-manage',
  'departments': 'department-manage',
  'mission-types': 'mission-type-manage',
  'destinations': 'destination-manage'
};

export const providerSettingsStore = {
  env: process.env.PROVIDER_AUTH_ENV || 'UAT',
  healthClientId: process.env.HEALTH_ID_CLIENT_ID || '',
  healthClientSecret: process.env.HEALTH_ID_CLIENT_SECRET || '',
  healthClientSecretSet: !!process.env.HEALTH_ID_CLIENT_SECRET,
  providerClientId: process.env.PROVIDER_ID_CLIENT_ID || '',
  providerSecretKey: process.env.PROVIDER_ID_SECRET_KEY || '',
  providerSecretKeySet: !!process.env.PROVIDER_ID_SECRET_KEY,
  allowedHcode: process.env.PROVIDER_ALLOWED_HCODE || '',
  redirectUri: process.env.PROVIDER_REDIRECT_URI || 'http://localhost:9998/provider-callback',
  proxyUrl: process.env.PROVIDER_API_PROXY_URL || '',
  configured: !!(process.env.HEALTH_ID_CLIENT_ID && process.env.HEALTH_ID_CLIENT_SECRET)
};
