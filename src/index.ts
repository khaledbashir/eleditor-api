import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import cron from 'node-cron';
import dotenv from 'dotenv';

import { pool, closeDatabasePool } from './database/connection';
import { cleanupExpiredSessions } from './middleware/auth';
import { logger, logRequest } from './utils/logger';

// Import routes
import authRoutes from './routes/auth';
import syncRoutes from './routes/sync';

// Load environment variables
dotenv.config();

const app = express();

// Trust proxy for Easypanel\napp.set("trust proxy", true);
const PORT = process.env['PORT'] || 3002;

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

app.use(compression());
app.use(limiter);

// CORS configuration
app.use(cors({
  origin: process.env['FRONTEND_URL'] || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging middleware
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (process.env['NODE_ENV'] === 'production') {
      logRequest(req.method, req.url, req.ip || 'unknown');
    }
    next();
  });

// Health check endpoint
  app.get('/health', async (_req: Request, res: Response) => {
  try {
    const dbHealth = await pool.query('SELECT 1').then(() => true).catch(() => false);
    
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: dbHealth ? 'connected' : 'disconnected'
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: 'Health check failed'
    });
  }
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/sync', syncRoutes);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.url} not found`
  });
});

// Global error handler
  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  res.status(err.status || 500).json({
    success: false,
    error: process.env['NODE_ENV'] === 'production' ? 'Internal server error' : err.message
  });
});

// Scheduled tasks
cron.schedule('0 2 * * *', async () => {
  logger.info('Running daily cleanup tasks');
  await cleanupExpiredSessions();
});

// Start server
async function startServer() {
  try {
    // Initialize database
    // Database initialization would go here
    logger.info('Database connection established');

    // Start listening
    app.listen(PORT, () => {
      logger.info(`ElEditor API Server running on port ${PORT}`, {
        port: PORT,
        environment: process.env['NODE_ENV'] || 'development',
        frontendUrl: process.env['FRONTEND_URL'] || 'http://localhost:3000'
      });
    });

  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  // Close database
  await closeDatabasePool();
  
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  
  // Close database
  await closeDatabasePool();
  
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
  process.exit(1);
});

// Start the server
startServer();