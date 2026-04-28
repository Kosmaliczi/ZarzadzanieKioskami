/**
 * Enterprise-grade HTTP Client
 * Features: retry logic, request/response interceptors, error handling, caching, timeout management
 */

import type {
  ApiError,
  RequestConfig,
  RequestConfigInternal,
  HttpClientConfig,
} from '../types/api'
import { API_BASE_URL } from '../config/env'
import axios from 'axios'

export class HttpClientError extends Error implements ApiError {
  code: string
  status: number
  details?: Record<string, unknown>

  constructor(message: string, code: string, status: number, details?: Record<string, unknown>) {
    super(message)
    this.code = code
    this.status = status
    this.details = details
    this.name = 'HttpClientError'
  }
}

export class HttpClient {
  private baseUrl: string
  private timeout: number
  private retries: number
  private retryDelay: number
  private cache: Map<string, { data: unknown; timestamp: number }>
  private requestInterceptors: Array<(config: RequestConfigInternal) => RequestConfigInternal>
  private responseInterceptors: Array<(response: unknown) => unknown>
  private errorInterceptors: Array<(error: ApiError) => ApiError>

  constructor(config: HttpClientConfig) {
    this.baseUrl = config.baseUrl
    this.timeout = config.timeout || 30000
    this.retries = config.retries || 3
    this.retryDelay = config.retryDelay || 1000
    this.cache = new Map()
    this.requestInterceptors = config.interceptors?.request || []
    this.responseInterceptors = (config.interceptors?.response as Array<(response: unknown) => unknown>) || []
    this.errorInterceptors = config.interceptors?.error || []
  }

  /**
   * Add request interceptor
   */
  addRequestInterceptor(interceptor: (config: RequestConfigInternal) => RequestConfigInternal): void {
    this.requestInterceptors.push(interceptor)
  }

  /**
   * Add response interceptor
   */
  addResponseInterceptor(interceptor: (response: unknown) => unknown): void {
    this.responseInterceptors.push(interceptor)
  }

  /**
   * Add error interceptor
   */
  addErrorInterceptor(interceptor: (error: ApiError) => ApiError): void {
    this.errorInterceptors.push(interceptor)
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Main HTTP request method
   */
  async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    endpoint: string,
    data?: unknown,
    config?: RequestConfig
  ): Promise<T> {
    const cacheKey = `${method}:${endpoint}`

    // Check cache for GET requests
    if (method === 'GET' && config?.cache) {
      const cached = this.cache.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < (config.cacheTime || 300000)) {
        return cached.data as T
      }
    }

    let requestConfig: RequestConfigInternal = {
      url: endpoint,
      method,
      body: data,
      ...config,
    }

    // Run request interceptors
    for (const interceptor of this.requestInterceptors) {
      requestConfig = interceptor(requestConfig)
    }

    // Add headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...requestConfig.headers,
    }

    // Add auth token if available
    const token = this.getAuthToken()
    if (token && !requestConfig.skipAuth) {
      headers['Authorization'] = `Bearer ${token}`
    }

    // Make request with retry logic
    let lastError: ApiError | null = null

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const response = await axios.request({
          url: `${this.baseUrl}${endpoint}`,
          method,
          headers,
          data,
          timeout: requestConfig.timeout ?? this.timeout,
          validateStatus: () => true,
        })

        const responseData: unknown = response.status === 204 ? null : response.data

        // Run response interceptors
        let finalResponse: unknown = responseData
        for (const interceptor of this.responseInterceptors) {
          finalResponse = interceptor(finalResponse)
        }

        // Handle errors in response
        if (response.status < 200 || response.status >= 300) {
          const errorPayload = responseData as
            | { error?: { message?: string; code?: string; details?: Record<string, unknown> } | string; message?: string }
            | null

          throw new HttpClientError(
            (typeof errorPayload?.error === 'string'
              ? errorPayload.error
              : errorPayload?.error?.message) ||
              errorPayload?.message ||
              'Request failed',
            (typeof errorPayload?.error === 'object' && errorPayload?.error?.code) || `HTTP_${response.status}`,
            response.status,
            typeof errorPayload?.error === 'object' ? errorPayload.error?.details : undefined
          )
        }

        // Cache successful GET response
        if (method === 'GET' && config?.cache) {
          this.cache.set(cacheKey, { data: finalResponse, timestamp: Date.now() })
        }

        return finalResponse as T
      } catch (error) {
        lastError = this.normalizeError(error)

        // Run error interceptors
        for (const interceptor of this.errorInterceptors) {
          lastError = interceptor(lastError)
        }

        // Don't retry on client errors (4xx).
        if (lastError.status >= 400 && lastError.status < 500) {
          throw lastError
        }

        // Retry with exponential backoff only for safe/idempotent requests.
        if (!this.shouldRetryRequest(method, lastError) || attempt >= this.retries) {
          throw lastError
        }

        const delay = this.retryDelay * Math.pow(2, attempt)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    throw lastError || new HttpClientError('Request failed', 'UNKNOWN_ERROR', 0)
  }

  /**
   * GET request
   */
  get<T = unknown>(endpoint: string, config?: RequestConfig): Promise<T> {
    return this.request<T>('GET', endpoint, undefined, config)
  }

  /**
   * POST request
   */
  post<T = unknown>(endpoint: string, data?: unknown, config?: RequestConfig): Promise<T> {
    return this.request<T>('POST', endpoint, data, config)
  }

  /**
   * PUT request
   */
  put<T = unknown>(endpoint: string, data?: unknown, config?: RequestConfig): Promise<T> {
    return this.request<T>('PUT', endpoint, data, config)
  }

  /**
   * PATCH request
   */
  patch<T = unknown>(endpoint: string, data?: unknown, config?: RequestConfig): Promise<T> {
    return this.request<T>('PATCH', endpoint, data, config)
  }

  /**
   * DELETE request
   */
  delete<T = unknown>(endpoint: string, config?: RequestConfig): Promise<T> {
    return this.request<T>('DELETE', endpoint, undefined, config)
  }

  /**
   * Normalize error to HttpClientError
   */
  private normalizeError(error: unknown): HttpClientError {
    if (error instanceof HttpClientError) {
      return error
    }

    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') {
        return new HttpClientError('Request timeout', 'TIMEOUT', 408)
      }

      const status = error.response?.status || 0
      return new HttpClientError(error.message, status ? `HTTP_${status}` : 'NETWORK_ERROR', status)
    }

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return new HttpClientError('Request timeout', 'TIMEOUT', 408)
      }
      return new HttpClientError(error.message, 'NETWORK_ERROR', 0)
    }

    return new HttpClientError('Unknown error occurred', 'UNKNOWN_ERROR', 0)
  }

  /**
   * Retry only idempotent requests and transient failures.
   */
  private shouldRetryRequest(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', error: ApiError): boolean {
    if (method !== 'GET') {
      return false
    }

    if (!error.status || error.code === 'TIMEOUT' || error.code === 'NETWORK_ERROR') {
      return true
    }

    return error.status >= 500
  }

  /**
   * Get auth token from storage
   */
  private getAuthToken(): string | null {
    try {
      const stored = localStorage.getItem('authToken')
      if (!stored) return null

      const { value, expiresAt } = JSON.parse(stored)

      // Check if token is expired
      if (expiresAt && Date.now() > expiresAt) {
        localStorage.removeItem('authToken')
        return null
      }

      return typeof value === 'string' && value ? value : null
    } catch {
      return null
    }
  }

  /**
   * Base URL getter for endpoints that require custom fetch handling.
   */
  getBaseUrl(): string {
    return this.baseUrl
  }
}

/**
 * Create HTTP client instance with default configuration
 */
export function createHttpClient(baseUrl: string = API_BASE_URL): HttpClient {
  const client = new HttpClient({
    baseUrl,
    timeout: 30000,
    retries: 3,
    retryDelay: 1000,
  })

  // Add error handling interceptor
  client.addErrorInterceptor((error) => {
    // Handle 401 Unauthorized
    if (error.status === 401) {
      localStorage.removeItem('authToken')
      localStorage.removeItem('user')
      // Redirect to login - implement in your app root
      window.dispatchEvent(new CustomEvent('auth:logout'))
    }

    return error
  })

  return client
}

export default HttpClient
