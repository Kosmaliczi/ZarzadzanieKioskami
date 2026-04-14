/**
 * API Service Utilities
 * Helper functions for error handling, validation, and common operations
 */

import type { ApiError } from '../types/api'

/**
 * Handle API error and return user-friendly message
 */
export function handleApiError(error: unknown): { message: string; code: string; details?: Record<string, unknown> } {
  if (error instanceof Error) {
    if ('code' in error && 'status' in error) {
      const apiError = error as ApiError
      return {
        message: apiError.message,
        code: apiError.code,
        details: apiError.details,
      }
    }

    // Network error
    if (error.message.includes('timeout') || error.message.includes('timeout')) {
      return {
        message: 'Żądanie upłynęło - spróbuj ponownie',
        code: 'TIMEOUT',
      }
    }

    // Not found
    if (error.message.includes('404')) {
      return {
        message: 'Zasób nie znaleziony',
        code: 'NOT_FOUND',
      }
    }

    // Unauthorized
    if (error.message.includes('401')) {
      return {
        message: 'Sesja wygasła - zaloguj się ponownie',
        code: 'UNAUTHORIZED',
      }
    }

    // Forbidden
    if (error.message.includes('403')) {
      return {
        message: 'Brak uprawnień do tej operacji',
        code: 'FORBIDDEN',
      }
    }

    // Server error
    if (error.message.includes('500')) {
      return {
        message: 'Błąd serwera - skontaktuj się z administratorem',
        code: 'SERVER_ERROR',
      }
    }

    return {
      message: error.message || 'Nieznany błąd',
      code: 'UNKNOWN_ERROR',
    }
  }

  return {
    message: 'Nieznany błąd',
    code: 'UNKNOWN_ERROR',
  }
}

/**
 * Debounce function for API calls
 */
export function debounce<T extends (...args: unknown[]) => Promise<unknown>>(
  func: T,
  wait: number
): (...args: Parameters<T>) => Promise<unknown> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  let pendingReject: ((reason?: unknown) => void) | null = null

  return function debouncedFunc(...args: Parameters<T>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const later = async () => {
        timeout = null
        pendingReject = null
        try {
          const result = await func(...args)
          resolve(result)
        } catch (error) {
          reject(error)
        }
      }

      if (timeout) {
        clearTimeout(timeout)
        if (pendingReject) {
          pendingReject(new Error('Function call debounced'))
        }
      }

      pendingReject = reject
      timeout = setTimeout(later, wait)
    })
  }
}

/**
 * Throttle function for API calls
 */
export function throttle<T extends (...args: unknown[]) => Promise<unknown>>(
  func: T,
  limit: number
): (...args: Parameters<T>) => Promise<unknown> {
  let inThrottle: boolean

  return function throttledFunc(...args: Parameters<T>): Promise<unknown> {
    if (!inThrottle) {
      inThrottle = true

      const result = func(...args)

      setTimeout(() => {
        inThrottle = false
      }, limit)

      return result
    }

    return Promise.reject(new Error('Function call throttled'))
  }
}

/**
 * Retry function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number
    initialDelay?: number
    maxDelay?: number
    backoffMultiplier?: number
    onRetry?: (attempt: number, error: Error) => void
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffMultiplier = 2,
    onRetry,
  } = options

  let lastError: Error | null = null

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      lastError = err

      if (onRetry) {
        onRetry(attempt + 1, err)
      }

      if (attempt < maxAttempts - 1) {
        const delay = Math.min(initialDelay * Math.pow(backoffMultiplier, attempt), maxDelay)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError || new Error('Max retries exceeded')
}

/**
 * Format file size to human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
}

/**
 * Build query string from object
 */
export function buildQueryString(params: Record<string, unknown>): string {
  const query = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') {
      query.append(key, String(value))
    }
  }

  const qs = query.toString()
  return qs ? `?${qs}` : ''
}

/**
 * Parse error response
 */
export function parseErrorResponse(error: unknown): {
  message: string
  code: string
  details?: Record<string, unknown>
} {
  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>

    if ('message' in err && 'code' in err) {
      return {
        message: String(err.message),
        code: String(err.code),
        details: 'details' in err ? (err.details as Record<string, unknown>) : undefined,
      }
    }

    if ('error' in err && typeof err.error === 'object') {
      const errorObj = err.error as Record<string, unknown>
      if ('message' in errorObj && 'code' in errorObj) {
        return {
          message: String(errorObj.message),
          code: String(errorObj.code),
          details: 'details' in errorObj ? (errorObj.details as Record<string, unknown>) : undefined,
        }
      }
    }

    if ('message' in err) {
      return {
        message: String(err.message),
        code: 'UNKNOWN_ERROR',
      }
    }
  }

  return {
    message: 'Nieznany błąd',
    code: 'UNKNOWN_ERROR',
  }
}

/**
 * Validate email format
 */
export function validateEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return re.test(email)
}

/**
 * Validate URL
 */
export function validateUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

/**
 * Deep clone object
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as T
  }

  if (obj instanceof Array) {
    return obj.map((item) => deepClone(item)) as T
  }

  if (obj instanceof Object) {
    const clonedObj = {} as T
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        clonedObj[key] = deepClone(obj[key])
      }
    }
    return clonedObj
  }

  return obj
}

/**
 * Wait for specified time
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Generate unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Get error message in Polish
 */
export function getPolishErrorMessage(code: string, message?: string): string {
  const messages: Record<string, string> = {
    TIMEOUT: 'Żądanie upłynęło - spróbuj ponownie',
    NETWORK_ERROR: 'Błąd połączenia - sprawdź połączenie internetowe',
    UNAUTHORIZED: 'Sesja wygasła - zaloguj się ponownie',
    FORBIDDEN: 'Brak uprawnień do tej operacji',
    NOT_FOUND: 'Zasób nie znaleziony',
    SERVER_ERROR: 'Błąd serwera - skontaktuj się z administratorem',
    VALIDATION_ERROR: 'Błąd walidacji - sprawdź wprowadzone dane',
    CONFLICT: 'Konflikt danych - spróbuj ponownie',
    TOO_MANY_REQUESTS: 'Zbyt wiele żądań - czekaj przed ponowną próbą',
    UNKNOWN_ERROR: 'Nieznany błąd - spróbuj ponownie',
  }

  return messages[code] || message || 'Błąd aplikacji'
}

/**
 * Format date to Polish format
 */
export function formatDate(date: string | Date, withTime = false): string {
  const d = typeof date === 'string' ? new Date(date) : date

  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()

  let result = `${day}.${month}.${year}`

  if (withTime) {
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    result += ` ${hours}:${minutes}`
  }

  return result
}
