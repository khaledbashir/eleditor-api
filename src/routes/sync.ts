/**
 * Sync API Routes
 * 
 * Handles data synchronization between clients and server
 * with conflict resolution and automatic backups
 */

import express, { Request, Response } from 'express';
import { pool } from '../database/connection';

// Alias pool as db for consistency
const db = pool;
import { logger } from '../utils/logger';
import { requireAuth } from '../middleware/auth';
import { 
  SyncResponse, 
  ConflictResponse,
  ErrorResponse 
} from '../types/database';

const router = express.Router();

// POST /api/sync - Save data to server
router.post('/', requireAuth, async (req: Request, res: Response<SyncResponse | ErrorResponse>) => {
  const userId = req.user!.id;
  const { threadId, dataType, content, version = 1, force = false } = req.body;

  try {
    // Validate request
    if (!threadId || !dataType || !content) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: threadId, dataType, content'
      });
    }

    if (!['spreadsheet', 'document', 'both'].includes(dataType)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid dataType. Must be: spreadsheet, document, or both'
      });
    }

    // Check for existing data and conflicts
    const existingData = await db.query(
      'SELECT * FROM user_data WHERE user_id = $1 AND thread_id = $2',
      [userId, threadId]
    );

    if (existingData.rows.length > 0) {
      const existing = existingData.rows[0];
      
      // Check for version conflict
      if (!force && existing.version > version) {
        // Conflict detected
        return res.status(409).json({
          success: false,
          conflict: true,
          error: 'Version conflict',
          serverVersion: existing.version,
          serverData: existing.content,
          serverUpdatedAt: existing.updated_at
        } as ConflictResponse);
      }
    }

    // Start transaction for atomic update
    await db.query('BEGIN');

    try {
      // Create backup before update
      if (existingData.rows.length > 0) {
        await db.query(
          `INSERT INTO data_backups (user_id, thread_id, data_type, content, version, created_at)
           SELECT user_id, thread_id, data_type, content, version, updated_at
           FROM user_data 
           WHERE user_id = $1 AND thread_id = $2`,
          [userId, threadId]
        );
      }

      // Upsert data
      await db.query(
        `INSERT INTO user_data (user_id, thread_id, data_type, content, version, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id, thread_id) 
         DO UPDATE SET 
           data_type = EXCLUDED.data_type,
           content = EXCLUDED.content,
           version = EXCLUDED.version,
           updated_at = EXCLUDED.updated_at`,
        [userId, threadId, dataType, JSON.stringify(content), version]
      );

      // Update storage stats
      await updateStorageStats(userId);

      await db.query('COMMIT');

      logger.info('Data synced successfully', {
        userId,
        threadId,
        dataType,
        version,
        force,
        isNewRecord: existingData.rows.length === 0
      });

      return res.json({
        success: true,
        message: 'Data synced successfully',
        version,
        updated_at: new Date().toISOString()
      });

    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    logger.error('Sync failed', { 
      error, 
      userId, 
      threadId, 
      dataType 
    });

    return res.status(500).json({
      success: false,
      error: 'Internal server error during sync'
    });
  }
});

// GET /api/sync/:threadId - Get data from server
router.get('/:threadId', requireAuth, async (req: Request, res: Response<SyncResponse | ErrorResponse>) => {
  const userId = req.user!.id;
  const { threadId } = req.params;
  const { dataType = 'both' } = req.query;

  try {
    // Validate dataType
    if (!['spreadsheet', 'document', 'both'].includes(dataType as string)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid dataType. Must be: spreadsheet, document, or both'
      });
    }

    // Get data from database
    const result = await db.query(
      'SELECT * FROM user_data WHERE user_id = $1 AND thread_id = $2',
      [userId, threadId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Data not found'
      });
    }

    const data = result.rows[0];

    logger.info('Data retrieved successfully', {
      userId,
      threadId,
      dataType,
      version: data.version
    });

    return res.json({
      success: true,
      data: data.content,
      version: data.version,
      updated_at: data.updated_at,
      data_type: data.data_type
    });

  } catch (error) {
    logger.error('Failed to retrieve data', { 
      error, 
      userId, 
      threadId, 
      dataType 
    });

    return res.status(500).json({
      success: false,
      error: 'Internal server error while retrieving data'
    });
  }
});

// GET /api/sync/:threadId/history - Get version history
router.get('/:threadId/history', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { threadId } = req.params;
  const { limit = 10 } = req.query;

  try {
    // Get main data
    const mainData = await db.query(
      'SELECT * FROM user_data WHERE user_id = $1 AND thread_id = $2',
      [userId, threadId]
    );

    // Get backup history
    const history = await db.query(
      `SELECT * FROM data_backups 
       WHERE user_id = $1 AND thread_id = $2 
       ORDER BY created_at DESC 
       LIMIT $3`,
      [userId, threadId, parseInt(limit as string)]
    );

    const result = {
      current: mainData.rows[0] || null,
      history: history.rows
    };

    logger.info('Version history retrieved', {
      userId,
      threadId,
      historyCount: history.rows.length
    });

    return res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Failed to retrieve version history', { 
      error, 
      userId, 
      threadId 
    });

    return res.status(500).json({
      success: false,
      error: 'Internal server error while retrieving history'
    });
  }
});

// POST /api/sync/:threadId/restore - Restore from backup
router.post('/:threadId/restore', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { threadId } = req.params;
  const { backupId } = req.body;

  try {
    if (!backupId) {
      return res.status(400).json({
        success: false,
        error: 'backupId is required'
      });
    }

    // Get backup data
    const backup = await db.query(
      'SELECT * FROM data_backups WHERE id = $1 AND user_id = $2',
      [backupId, userId]
    );

    if (backup.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Backup not found'
      });
    }

    const backupData = backup.rows[0];

    // Start transaction for restore
    await db.query('BEGIN');

    try {
      // Create backup of current data before restore
      const currentData = await db.query(
        'SELECT * FROM user_data WHERE user_id = $1 AND thread_id = $2',
        [userId, threadId]
      );

      if (currentData.rows.length > 0) {
        await db.query(
          `INSERT INTO data_backups (user_id, thread_id, data_type, content, version, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [
            userId,
            threadId,
            currentData.rows[0].data_type,
            currentData.rows[0].content,
            currentData.rows[0].version
          ]
        );
      }

      // Restore from backup
      await db.query(
        `INSERT INTO user_data (user_id, thread_id, data_type, content, version, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id, thread_id) 
         DO UPDATE SET 
           data_type = EXCLUDED.data_type,
           content = EXCLUDED.content,
           version = EXCLUDED.version + 1,
           updated_at = EXCLUDED.updated_at`,
        [
          userId,
          threadId,
          backupData.data_type,
          backupData.content,
          backupData.version
        ]
      );

      // Update storage stats
      await updateStorageStats(userId);

      await db.query('COMMIT');

      logger.info('Data restored from backup', {
        userId,
        threadId,
        backupId,
        restoredVersion: backupData.version
      });

      return res.json({
        success: true,
        message: 'Data restored successfully',
        version: backupData.version,
        restored_at: new Date().toISOString()
      });

    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    logger.error('Failed to restore from backup', { 
      error, 
      userId, 
      threadId, 
      backupId 
    });

    return res.status(500).json({
      success: false,
      error: 'Internal server error during restore'
    });
  }
});

// DELETE /api/sync/:threadId - Delete data
router.delete('/:threadId', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { threadId } = req.params;

  try {
    // Start transaction for safe deletion
    await db.query('BEGIN');

    try {
      // Create backup before deletion
      const currentData = await db.query(
        'SELECT * FROM user_data WHERE user_id = $1 AND thread_id = $2',
        [userId, threadId]
      );

      if (currentData.rows.length > 0) {
        await db.query(
          `INSERT INTO data_backups (user_id, thread_id, data_type, content, version, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [
            userId,
            threadId,
            currentData.rows[0].data_type,
            currentData.rows[0].content,
            currentData.rows[0].version
          ]
        );
      }

      // Delete main data
      const deleteResult = await db.query(
        'DELETE FROM user_data WHERE user_id = $1 AND thread_id = $2',
        [userId, threadId]
      );

      // Update storage stats
      await updateStorageStats(userId);

      await db.query('COMMIT');

      logger.info('Data deleted successfully', {
        userId,
        threadId,
        wasDeleted: (deleteResult.rowCount ?? 0) > 0
      });

      return res.json({
        success: true,
        message: 'Data deleted successfully'
      });

    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    logger.error('Failed to delete data', { 
      error, 
      userId, 
      threadId 
    });

    return res.status(500).json({
      success: false,
      error: 'Internal server error during deletion'
    });
  }
});

// GET /api/sync/stats - Get storage statistics
router.get('/stats', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;

  try {
    // Get storage stats
    const stats = await db.query(
      'SELECT * FROM storage_stats WHERE user_id = $1',
      [userId]
    );

    // Get thread count
    const threadCount = await db.query(
      'SELECT COUNT(*) as count FROM user_data WHERE user_id = $1',
      [userId]
    );

    // Get backup count
    const backupCount = await db.query(
      'SELECT COUNT(*) as count FROM data_backups WHERE user_id = $1',
      [userId]
    );

    const result = {
      storageStats: stats.rows[0] || null,
      threadCount: parseInt(threadCount.rows[0].count),
      backupCount: parseInt(backupCount.rows[0].count)
    };

    logger.info('Storage stats retrieved', {
      userId,
      threadCount: result.threadCount,
      backupCount: result.backupCount
    });

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Failed to retrieve storage stats', { 
      error, 
      userId 
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error while retrieving stats'
    });
  }
});

// Helper function to update storage statistics
async function updateStorageStats(userId: string): Promise<void> {
  try {
    // Calculate total storage used
    const sizeResult = await db.query(
      `SELECT 
        SUM(LENGTH(content::text)) as total_size,
        COUNT(*) as thread_count
       FROM user_data 
       WHERE user_id = $1`,
      [userId]
    );

    const stats = sizeResult.rows[0];
    const totalSize = parseInt(stats.total_size) || 0;
    const threadCount = parseInt(stats.thread_count) || 0;

    // Update or insert storage stats
    await db.query(
      `INSERT INTO storage_stats (user_id, total_size_bytes, thread_count, last_updated)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) 
       DO UPDATE SET 
         total_size_bytes = EXCLUDED.total_size_bytes,
         thread_count = EXCLUDED.thread_count,
         last_updated = EXCLUDED.last_updated`,
      [userId, totalSize, threadCount]
    );

  } catch (error) {
    logger.error('Failed to update storage stats', { error, userId });
  }
}

export default router;