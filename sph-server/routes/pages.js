import express from 'express';
import jwt from 'jsonwebtoken';
import { verifyToken, verifyPassword, getJwtSecret } from '../utils/auth.js';
import { formatThaiDateTime } from '../utils/formatters.js';
import { doc, SHEET_NAMES, writeAuditLog, getSystemSettings } from '../services/googleSheets.js';
import { UI_PAGES } from '../utils/config.js';

const router = express.Router();

// Render layout with subpages
Object.keys(UI_PAGES).forEach(route => {
  router.get('/' + route, async (req, res, next) => {
    try {
      const token = req.cookies.auth_token;
      if (!token) return res.redirect('/login');
      
      const user = verifyToken(token);
      if (!user) {
        res.clearCookie('auth_token');
        return res.redirect('/login');
      }

      // Backend Route Guard mapping roles to allowed pages
      const allowedPagesMap = {
        admin: ['dashboard', 'usage-form', 'usage-list', 'master-data', 'users', 'reports', 'audit-logs'],
        manager: ['dashboard', 'usage-form', 'usage-list', 'users', 'reports'],
        driver_head: ['dashboard', 'usage-form', 'usage-list', 'reports'],
        driver: ['usage-form', 'usage-list'],
        user: ['usage-form', 'usage-list']
      };

      const userRole = (user.role || 'user').toLowerCase();
      const userAllowed = allowedPagesMap[userRole] || ['usage-form', 'usage-list'];
      
      if (!userAllowed.includes(route)) {
        return res.redirect('/usage-form');
      }
      
      const dynamicConfig = await getSystemSettings();
      
      res.render('layout', {
        appConfig: dynamicConfig,
        currentPage: route,
        contentPage: UI_PAGES[route],
        initialAuth: { token: token, user: user }
      });
    } catch (err) {
      next(err);
    }
  });
});

router.get('/', (req, res) => {
  res.redirect('/dashboard');
});

router.get('/login', async (req, res, next) => {
  try {
    const dynamicConfig = await getSystemSettings();
    // If we receive code and state from Health ID redirect (registered redirect_uri is http://localhost:9998/login)
    if (req.query.code) {
      return res.render('provider-callback', {
        appConfig: dynamicConfig,
        callbackCode: req.query.code || '',
        callbackState: req.query.state || ''
      });
    }

    res.render('login', { 
      appConfig: dynamicConfig,
      loginError: req.query.error || null 
    });
  } catch (err) {
    next(err);
  }
});

router.get('/provider-callback', async (req, res, next) => {
  try {
    const dynamicConfig = await getSystemSettings();
    res.render('provider-callback', {
      appConfig: dynamicConfig,
      callbackCode: req.query.code || '',
      callbackState: req.query.state || ''
    });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle[SHEET_NAMES.USERS];
    const rows = await sheet.getRows();
    
    const userRow = rows.find(r => r.get('username') === username && verifyPassword(password, r.get('password')) && r.get('status') === 'active');
    
    if (userRow) {
      const userPayload = {
        user_id: userRow.get('user_id'),
        username: userRow.get('username'),
        full_name: userRow.get('full_name'),
        role: userRow.get('role'),
        department: userRow.get('department'),
        status: userRow.get('status'),
        allowed_pages: userRow.get('allowed_pages') || ''
      };
      
      const token = jwt.sign(userPayload, getJwtSecret(), { expiresIn: '6h' });
      res.cookie('auth_token', token, { 
        httpOnly: true, 
        secure: process.env.NODE_ENV === 'production', 
        sameSite: 'strict' 
      });
      
      // Update last login
      userRow.set('last_login', formatThaiDateTime(new Date()));
      await userRow.save();
      
      await writeAuditLog('LOGIN', 'Auth', 'เข้าสู่ระบบสำเร็จ', userPayload);
      res.redirect('/dashboard');
    } else {
      res.redirect('/login?error=' + encodeURIComponent('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'));
    }
  } catch (error) {
    console.error('Login error:', error);
    res.redirect('/login?error=' + encodeURIComponent('เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล'));
  }
});

router.get('/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.redirect('/login');
});

export default router;
