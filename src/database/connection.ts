import { Pool, PoolConfig } from 'pg';
import { logger } from '../utils/logger';

// Lazy pool initialization
let _pool: Pool | null = null;

function createPool(): Pool {
  const poolConfig: PoolConfig = {
    host: process.env['DB_HOST'] || 'localhost',
    port: parseInt(process.env['DB_PORT'] || '5432'),
    database: process.env['DB_NAME'] || 'eleditor',
    user: process.env['DB_USER'] || 'eleditor_user',
    password: process.env['DB_PASSWORD'],
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  };

  return new Pool(poolConfig);
}

// Export pool with lazy initialization
export const pool = new Proxy({} as Pool, {
  get: (_target, prop) => {
    if (!_pool) {
      _pool = createPool();
    }
    return (_pool as any)[prop];
  }
});

// Export database query helper
export const db = {
  query: (text: string, params?: any[]) => pool.query(text, params)
};

// Database connection health check
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    
    logger.info('Database connection healthy', {
      timestamp: result.rows[0].now,
      poolTotalCount: pool.totalCount,
      poolIdleCount: pool.idleCount,
      poolWaitingCount: pool.waitingCount
    });
    
    return true;
  } catch (error) {
    logger.error('Database connection failed', { error });
    return false;
  }
}

// Initialize database connection
export async function initializeDatabase(): Promise<void> {
  try {
    const isHealthy = await checkDatabaseHealth();
    if (!isHealthy) {
      throw new Error('Database connection failed');
    }
    
    // Test basic query
    const result = await pool.query('SELECT version()');
    logger.info('Database initialized successfully', {
      version: result.rows[0].version
    });
  } catch (error) {
    logger.error('Failed to initialize database', { error });
    throw error;
  }
}

// Graceful shutdown
export async function closeDatabasePool(): Promise<void> {
  try {
    await pool.end();
    logger.info('Database pool closed');
  } catch (error) {
    logger.error('Error closing database pool', { error });
    throw error;
  }
}



// Handle process termination
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing database pool');
  await closeDatabasePool();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, closing database pool');
  await closeDatabasePool();
  process.exit(0);
});