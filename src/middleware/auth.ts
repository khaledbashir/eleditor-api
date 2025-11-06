import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../database/connection';
import { logger } from '../utils/logger';

// Extend Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        first_name?: string;
        last_name?: string;
      };
    }
  }
}

// Generate JWT token
export function generateToken(userId: string, email: string): { token: string; expires_at: Date } {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

  const JWT_SECRET = process.env['JWT_SECRET'];
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is not set');
  }

  const token = jwt.sign(
    { userId, email },
    JWT_SECRET,
    { expiresIn: '30d' }
  );

  return { token, expires_at: expiresAt };
}

// Verify JWT token
export function verifyToken(token: string): any {
  try {
    const JWT_SECRET = process.env['JWT_SECRET'];
    if (!JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable is not set');
    }
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

// Authentication middleware
export async function authenticateToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      res.status(401).json({ 
        success: false, 
        error: 'Access token required' 
      });
      return;
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      res.status(403).json({ 
        success: false, 
        error: 'Invalid or expired token' 
      });
      return;
    }

    // Fetch user from database to ensure they still exist
    const userQuery = await pool.query(
      'SELECT id, email, first_name, last_name FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userQuery.rows.length === 0) {
      res.status(403).json({ 
        success: false, 
        error: 'User not found' 
      });
      return;
    }

    // Set user in request object
    req.user = userQuery.rows[0];

    // Update session last used timestamp
    await pool.query(
      'UPDATE user_sessions SET last_used = NOW() WHERE token_hash = $1',
      [hashToken(token)]
    );

    next();
  } catch (error) {
    logger.error('Authentication error', { error, token: req.headers['authorization'] });
    res.status(500).json({ 
      success: false, 
      error: 'Authentication failed' 
    });
  }
}

// Alias for authenticateToken for consistency
export const requireAuth = authenticateToken;

// Optional authentication (doesn't fail if no token)
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const decoded = verifyToken(token);
      if (decoded) {
        const userQuery = await pool.query(
          'SELECT id, email, first_name, last_name FROM users WHERE id = $1',
          [decoded.userId]
        );
        
        if (userQuery.rows.length > 0) {
          req.user = userQuery.rows[0];
        }
      }
    }

    next();
  } catch (error) {
    // Don't fail for optional auth, just continue without user
    logger.warn('Optional authentication failed', { error });
    next();
  }
}

// Hash token for database storage
function hashToken(token: string): string {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Store session in database
export async function storeSession(userId: string, token: string, userAgent?: string, ipAddress?: string): Promise<void> {
  try {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

    await pool.query(
      `INSERT INTO user_sessions (user_id, token_hash, created_at, expires_at, user_agent, ip_address)
       VALUES ($1, $2, NOW(), $3, $4, $5)`,
      [userId, hashToken(token), expiresAt, userAgent, ipAddress]
    );

    logger.info('Session stored', { userId, expiresAt });
  } catch (error) {
    logger.error('Failed to store session', { error, userId });
    throw error;
  }
}

// Clean up expired sessions
export async function cleanupExpiredSessions(): Promise<void> {
  try {
    const result = await pool.query(
      'DELETE FROM user_sessions WHERE expires_at < NOW() RETURNING id'
    );
    
    logger.info('Cleaned up expired sessions', { 
      deletedCount: result.rows.length 
    });
  } catch (error) {
    logger.error('Failed to cleanup expired sessions', { error });
  }
}