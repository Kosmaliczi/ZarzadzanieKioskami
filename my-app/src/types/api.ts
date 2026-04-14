/**
 * API Response Types
 * Enterprise-grade type definitions for all API responses
 */

// ============================================================================
// Generic Response Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
  timestamp: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

export interface ApiError extends Error {
  code: string
  status: number
  details?: Record<string, unknown>
}

// ============================================================================
// Authentication Types
// ============================================================================

export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  token: string
  user: {
    id: number | null
    username: string
    role: 'user' | 'admin'
  }
  expiresIn: number
}

export interface AuthToken {
  value: string
  expiresAt: number
  refreshToken?: string
}

// ============================================================================
// Kiosk Types
// ============================================================================

export interface Kiosk {
  id: number
  name: string
  mac_address: string
  serial_number: string
  ip_address: string | null
  ftp_username: string
  ftp_password: string
  status: 'online' | 'offline'
  last_connection: string
  created_at: string
  updated_at: string
}

export interface CreateKioskRequest {
  name: string
  mac_address: string
  serial_number: string
  ftp_username: string
  ftp_password: string
}

export interface UpdateKioskRequest {
  name?: string
  mac_address?: string
  serial_number?: string
  ftp_username?: string
  ftp_password?: string
}

// ============================================================================
// FTP Types
// ============================================================================

export interface FtpConnectionRequest {
  hostname: string
  username: string
  password: string
  port?: number
}

export interface FtpConnectionResponse {
  success: boolean
  protocol: 'ftp' | 'sftp'
  message: string
}

export interface FtpFile {
  name: string
  path: string
  type: 'file' | 'directory'
  size: number
  modified: string
  permissions?: string
}

export interface FtpListRequest extends FtpConnectionRequest {
  path: string
}

export interface FtpListResponse {
  files: FtpFile[]
  currentPath: string
  parent?: string
}

export interface FtpUploadRequest extends FtpConnectionRequest {
  path: string
  files: File[]
}

export interface FtpUploadResponse {
  successful: string[]
  failed: Array<{
    filename: string
    error: string
  }>
}

export interface FtpDeleteRequest extends FtpConnectionRequest {
  path: string
  isDirectory?: boolean
}

export interface FtpDeleteMultipleRequest extends FtpConnectionRequest {
  files: Array<{
    path: string
    isDirectory?: boolean
  }>
}

export interface FtpGetFileContentRequest extends FtpConnectionRequest {
  path: string
}

export interface FtpPutFileContentRequest extends FtpConnectionRequest {
  path: string
  content: string
}

export interface FtpMkdirRequest extends FtpConnectionRequest {
  path: string
  folder_name: string
}

export interface FtpDownloadRequest extends FtpConnectionRequest {
  path: string
}

// ============================================================================
// Settings Types
// ============================================================================

export interface Settings {
  [key: string]: string | number | boolean
}

export interface UpdateSettingsRequest {
  [key: string]: string | number | boolean
}

// ============================================================================
// Reservation Types
// ============================================================================

export interface Reservation {
  id: number
  date: string
  name: string
  start_time: string
  end_time: string
  status: 'active' | 'cancelled' | 'completed'
  created_at: string
  created_by?: string
  notes?: string
}

export interface CheckReservationRequest {
  date: string
  start_time: string
  end_time: string
  name: string
}

export interface CheckReservationResponse {
  available: boolean
  conflicts?: Array<{
    reservation_id: number
    start_time: string
    end_time: string
  }>
}

export interface CreateReservationRequest {
  date: string
  start_time: string
  end_time: string
  name: string
  notes?: string
}

export interface CreateReservationResponse {
  reservation: Reservation
}

export interface GetReservationsRequest {
  status?: 'active' | 'cancelled' | 'completed'
  limit?: number
  offset?: number
}

export interface CancelReservationRequest {
  reason?: string
}

// ============================================================================
// User Types
// ============================================================================

export interface User {
  id: number
  username: string
  role: 'user' | 'admin'
  created_at: string
  updated_at: string
}

export interface CreateUserRequest {
  username: string
  password: string
  role?: 'user' | 'admin'
}

export interface UpdateUserRoleRequest {
  role: 'user' | 'admin'
}

export interface ChangePasswordRequest {
  currentPassword?: string
  newPassword?: string
  current_password?: string
  new_password?: string
  confirm_password?: string
}

// ============================================================================
// Kiosk Device Types
// ============================================================================

export interface UpdateDeviceIpRequest {
  ip_address?: string
  mac_address?: string
}

export interface KioskRestartServiceRequest {
  username?: string
  port?: number
}

export interface KioskRotateDisplayRequest {
  orientation: 'normal' | 'right' | 'left' | 'inverted' | '0' | '90' | '270' | '180'
}

export interface KioskRotateDisplayResponse {
  success: boolean
  message: string
  orientation: string
}

// ============================================================================
// Request/Response Metadata
// ============================================================================

export interface RequestConfig {
  timeout?: number
  retries?: number
  retryDelay?: number
  skipAuth?: boolean
  skipErrorHandling?: boolean
  cache?: boolean
  cacheTime?: number
  headers?: Record<string, string>
  interceptors?: {
    request?: (config: RequestConfigInternal) => RequestConfigInternal
    response?: <T>(response: ApiResponse<T>) => ApiResponse<T>
    error?: (error: ApiError) => ApiError
  }
}

export interface RequestConfigInternal extends RequestConfig {
  url: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
}

// ============================================================================
// HTTP Client Types
// ============================================================================

export interface HttpClientConfig {
  baseUrl: string
  timeout: number
  retries: number
  retryDelay: number
  interceptors?: {
    request?: Array<(config: RequestConfigInternal) => RequestConfigInternal>
    response?: Array<<T>(response: ApiResponse<T>) => ApiResponse<T>>
    error?: Array<(error: ApiError) => ApiError>
  }
}

// ============================================================================
// Service Types
// ============================================================================

export interface ServiceResponse<T> {
  success: boolean
  data?: T
  error?: string
  details?: Record<string, unknown>
}
