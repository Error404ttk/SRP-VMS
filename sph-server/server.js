import dotenv from 'dotenv';
dotenv.config(); // Must run before importing modules that use process.env

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { verifyToken, requireAuth, requireAdmin, hashPassword, verifyPassword, getJwtSecret } from './utils/auth.js';
import { formatThaiDate, formatThaiDateTime, isValidIsoDate, isValidTimeValue } from './utils/formatters.js';
import { 
  doc, SHEET_NAMES, CACHE_TTL, sheetCache, sheetCacheTime, masterDataCache, masterDataCacheTime, 
  invalidateCache, getSheetRows, getRowsAsObjects, appendRowObject, findObjectById, 
  updateObjectById, getMasterData, writeAuditLog, updateVehicleMileageFromUsage
} from './services/googleSheets.js';
import { appConfig, UI_PAGES, providerSettingsStore } from './utils/config.js';
import pagesRouter from './routes/pages.js';
import rpcRouter from './routes/rpc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', true);
const port = process.env.PORT || 9998;

// Apply Helmet for overall HTTP header security
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "cdn.tailwindcss.com", "cdn.jsdelivr.net"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      fontSrc: ["'self'", "fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      connectSrc: ["'self'", "https://cdn.jsdelivr.net", "https://*.google.com", "https://*.googleapis.com"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"]
    }
  }
}));

// Apply Rate limiting to prevent brute force attacks on login and callback routes
const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // Limit each IP to 20 requests per minute
  message: { success: false, message: 'มีการยิงคำร้องขอเข้าสู่ระบบถี่เกินไป กรุณาลองใหม่ในภายหลัง' },
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/login', loginLimiter);
app.use('/api/rpc/getProviderLoginUrl', loginLimiter);
app.use('/api/rpc/handleProviderCallback', loginLimiter);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:' + port,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static('public')); // Serve frontend files

// Google Sheets logic has been extracted to services/googleSheets.js



// Auth functions have been extracted to utils/auth.js

// Database utils extracted to services/googleSheets.js

// getMasterData extracted to services/googleSheets.js

// Formatter functions extracted to utils/formatters.js

// Config extracted to utils/config.js

// Pages routes extracted to routes/pages.js
app.use('/', pagesRouter);

// RPC logic extracted to routes/rpc.js
app.use('/', rpcRouter);

// GET users json endpoint — requires admin authentication
app.get('/api/users', async (req, res) => {
  try {
    const token = req.cookies.auth_token;
    if (!token) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    const user = verifyToken(token);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    const rows = await getRowsAsObjects(SHEET_NAMES.USERS);
    const users = rows.map(r => {
      const u = { ...r };
      delete u.password;
      return u;
    });
    res.json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
  console.log(`📊 Connected to Spreadsheet ID: ${process.env.SPREADSHEET_ID}`);
});
