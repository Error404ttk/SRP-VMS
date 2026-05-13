import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// SECURITY: JWT_SECRET resolved lazily to support ES module import ordering with dotenv
let _jwtSecret = null;
export function getJwtSecret() {
  if (!_jwtSecret) {
    _jwtSecret = process.env.JWT_SECRET || process.env.SESSION_SECRET || '';
    if (!_jwtSecret || _jwtSecret.length < 16) {
      console.error('⚠️  WARNING: JWT_SECRET is not set or too short. Set a strong JWT_SECRET in .env (min 32 chars).');
    }
  }
  return _jwtSecret;
}
// Backward compatibility — callers that use JWT_SECRET directly should use getJwtSecret()
export { getJwtSecret as JWT_SECRET };

export function verifyToken(token) {
  try {
    if (!token) return null;
    return jwt.verify(token, getJwtSecret());
  } catch (error) {
    return null;
  }
}

export function requireAuth(token) {
  const user = verifyToken(token);
  if (!user) {
    throw new Error('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่');
  }
  return user;
}

export function requireAdmin(token) {
  const user = requireAuth(token);
  if (user.role !== 'admin') {
    throw new Error('คุณไม่มีสิทธิ์เข้าถึงเมนูนี้');
  }
  return user;
}

export function hashPassword(password, salt = crypto.randomUUID(), iterations = 12000) {
  let hash = String(password || '');
  for (let i = 0; i < iterations; i++) {
    hash = crypto.createHash('sha256').update(salt + ':' + i + ':' + hash).digest('hex');
  }
  return 'sha256i$' + iterations + '$' + salt + '$' + hash;
}

export function verifyPassword(pwd, stored) {
  if (!stored || !pwd) return false;
  
  if (stored.startsWith('sha256i$')) {
    const parts = stored.split('$');
    const iterations = parseInt(parts[1], 10);
    const salt = parts[2];
    const storedHash = parts[3];
    
    let hash = String(pwd || '');
    for (let i = 0; i < iterations; i++) {
      hash = crypto.createHash('sha256').update(salt + ':' + i + ':' + hash).digest('hex');
    }
    // SECURITY: Use timing-safe comparison to prevent timing attacks
    try {
      return crypto.timingSafeEqual(Buffer.from(hash, 'utf8'), Buffer.from(storedHash, 'utf8'));
    } catch {
      return false;
    }
  }
  
  if (stored.startsWith('sha256$')) {
    const parts = stored.split('$');
    const salt = parts[1];
    const storedHash = parts[2];
    const derivedHash = crypto.createHash('sha256').update(salt + ':' + pwd).digest('hex');
    // SECURITY: Use timing-safe comparison
    try {
      return crypto.timingSafeEqual(Buffer.from(derivedHash, 'utf8'), Buffer.from(storedHash, 'utf8'));
    } catch {
      return false;
    }
  }
  
  // SECURITY: Reject plain-text passwords — force rehash on next login
  console.warn('WARNING: Plain-text password detected. User must reset password.');
  return false;
}
