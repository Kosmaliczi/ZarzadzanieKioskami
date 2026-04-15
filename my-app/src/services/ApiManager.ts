/**
 * API Manager
 * Central entry point for all API services
 * Provides unified access to all service classes
 */

import { HttpClient, createHttpClient } from '../core/HttpClient'
import { API_BASE_URL } from '../config/env'
import { AuthService } from './AuthService'
import { KioskService } from './KioskService'
import { FtpService } from './FtpService'
import { ReservationService } from './ReservationService'
import { UserService } from './UserService'
import { SettingsService } from './SettingsService'
import { PlaylistService } from './PlaylistService'

export class ApiManager {
  private httpClient: HttpClient
  public auth: AuthService
  public kiosks: KioskService
  public ftp: FtpService
  public reservations: ReservationService
  public users: UserService
  public settings: SettingsService
  public playlists: PlaylistService

  constructor(baseUrl: string = API_BASE_URL) {
    // Create HTTP client with default configuration
    this.httpClient = createHttpClient(baseUrl)

    // Initialize all services
    this.auth = new AuthService(this.httpClient)
    this.kiosks = new KioskService(this.httpClient)
    this.ftp = new FtpService(this.httpClient)
    this.reservations = new ReservationService(this.httpClient)
    this.users = new UserService(this.httpClient)
    this.settings = new SettingsService(this.httpClient)
    this.playlists = new PlaylistService(this.httpClient)
  }

  /**
   * Get the underlying HTTP client (advanced usage)
   */
  getHttpClient(): HttpClient {
    return this.httpClient
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.httpClient.clearCache()
    this.settings.invalidateCache()
  }

  /**
   * Reset API manager (logout and cleanup)
   */
  reset(): void {
    this.clearCache()
    this.auth.clearToken()
  }
}

// Create singleton instance
let apiManagerInstance: ApiManager | null = null

/**
 * Get API Manager instance (singleton)
 */
export function getApiManager(baseUrl?: string): ApiManager {
  if (!apiManagerInstance) {
    apiManagerInstance = new ApiManager(baseUrl || API_BASE_URL)
  }

  return apiManagerInstance
}

/**
 * Create new API Manager instance
 */
export function createApiManager(baseUrl: string = API_BASE_URL): ApiManager {
  return new ApiManager(baseUrl)
}

export default ApiManager
