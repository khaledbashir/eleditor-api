/**
 * Database type definitions for ElEditor
 * Matches the PostgreSQL schema
 */

export interface User {
  id: string;
  email: string;
  password_hash: string;
  first_name?: string;
  last_name?: string;
  created_at: Date;
  updated_at: Date;
  last_login?: Date;
}

export interface UserData {
  id: string;
  user_id: string;
  thread_id: string;
  data_type: 'spreadsheet' | 'document' | 'both';
  content: any; // JSON content
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface DataBackup {
  id: string;
  user_id: string;
  thread_id: string;
  data_type: string;
  backup_data: any;
  backup_reason: 'auto_daily' | 'auto_weekly' | 'manual' | 'before_migration';
  backup_date: Date;
}

export interface UserSession {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
  last_used: Date;
  user_agent?: string;
  ip_address?: string;
}

export interface StorageStats {
  id: string;
  user_id: string;
  stat_date: Date;
  data_size_bytes: number;
  document_count: number;
  spreadsheet_count: number;
  created_at: Date;
}

// API Request/Response types
export interface SyncRequest {
  threadId: string;
  dataType: 'spreadsheet' | 'document' | 'both';
  content: any;
  version?: number;
}

export interface SyncResponse {
  success: boolean;
  data?: UserData;
  error?: string;
  conflict?: boolean; // If version conflict detected
  message?: string;
  version?: number;
  updated_at?: string;
  data_type?: string;
  restored_at?: string;
}

export interface LoadRequest {
  threadId: string;
  dataType?: 'spreadsheet' | 'document' | 'both';
}

export interface LoadResponse {
  success: boolean;
  data?: UserData[];
  error?: string;
}

export interface AuthRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  success: boolean;
  user?: Omit<User, 'password_hash'>;
  token?: string;
  expires_at?: Date;
  error?: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  first_name?: string;
  last_name?: string;
}

export interface RegisterResponse {
  success: boolean;
  user?: Omit<User, 'password_hash'>;
  token?: string;
  expires_at?: Date;
  error?: string;
}

export interface ConflictResponse {
  success: false;
  error: string;
  conflict: true;
  existingData?: UserData;
  proposedData?: any;
}

export interface ErrorResponse {
  success: false;
  error: string;
  details?: any;
}