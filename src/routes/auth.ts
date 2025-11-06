import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../database/connection';
import { generateToken, storeSession } from '../middleware/auth';
import { logger } from '../utils/logger';
import Joi from 'joi';

const router = Router();

// Validation schemas
const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  first_name: Joi.string().max(100).optional(),
  last_name: Joi.string().max(100).optional()
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

// Register new user
router.post('/register', async (req: Request, res: Response) => {
  try {
    // Validate input
    const { error, value } = registerSchema.validate(req.body);
    if (error && error.details && error.details[0]) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }

    const { email, password, first_name, last_name } = value;

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'User with this email already exists'
      });
    }

    // Hash password
    const saltRounds = 12;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // Create user
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING id, email, first_name, last_name, created_at, updated_at`,
      [email.toLowerCase(), password_hash, first_name, last_name]
    );

    const user = result.rows[0];

    // Generate token
    const { token, expires_at } = generateToken(user.id, user.email);

    // Store session
    await storeSession(
      user.id, 
      token, 
      req.get('User-Agent'), 
      req.ip
    );

    logger.info('User registered successfully', { 
      userId: user.id, 
      email: user.email 
    });

    return res.status(201).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        created_at: user.created_at,
        updated_at: user.updated_at
      },
      token,
      expires_at
    });

  } catch (error) {
    logger.error('Registration error', { error, email: req.body.email });
    return res.status(500).json({
      success: false,
      error: 'Registration failed'
    });
  }
});

// Login user
router.post('/login', async (req: Request, res: Response) => {
  try {
    // Validate input
    const { error, value } = loginSchema.validate(req.body);
    if (error && error.details && error.details[0]) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }

    const { email, password } = value;

    // Find user
    const result = await pool.query(
      `SELECT id, email, password_hash, first_name, last_name, created_at, updated_at
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    const user = result.rows[0];

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Update last login
    await pool.query(
      'UPDATE users SET last_login = NOW() WHERE id = $1',
      [user.id]
    );

    // Generate token
    const { token, expires_at } = generateToken(user.id, user.email);

    // Store session
    await storeSession(
      user.id, 
      token, 
      req.get('User-Agent'), 
      req.ip
    );

    logger.info('User logged in successfully', { 
      userId: user.id, 
      email: user.email 
    });

    return res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        created_at: user.created_at,
        updated_at: user.updated_at,
        last_login: new Date()
      },
      token,
      expires_at
    });

  } catch (error) {
    logger.error('Login error', { error, email: req.body.email });
    return res.status(500).json({
      success: false,
      error: 'Login failed'
    });
  }
});

// Verify token and get user info
router.get('/verify', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Token required'
      });
    }

    // This will be handled by authenticateToken middleware
    // If we reach here, token is valid and user is attached to request
    if (req.user) {
      return res.json({
        success: true,
        user: req.user
      });
    } else {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }

  } catch (error) {
    logger.error('Token verification error', { error });
    return res.status(500).json({
      success: false,
      error: 'Token verification failed'
    });
  }
});

// Logout (remove session)
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      // Remove session from database
      const crypto = require('crypto');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      
      await pool.query(
        'DELETE FROM user_sessions WHERE token_hash = $1',
        [tokenHash]
      );

      logger.info('User logged out', { userId: req.user?.id });
    }

    return res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    logger.error('Logout error', { error });
    return res.status(500).json({
      success: false,
      error: 'Logout failed'
    });
  }
});

export default router;