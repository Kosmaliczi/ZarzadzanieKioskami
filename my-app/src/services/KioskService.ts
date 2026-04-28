/**
 * Kiosk Service
 * Handles all kiosk-related API calls (CRUD operations, status, service management)
 */

import { HttpClient } from '../core/HttpClient'
import type {
  Kiosk,
  CreateKioskRequest,
  UpdateKioskRequest,
  KioskRestartServiceRequest,
  KioskRotateDisplayResponse,
  GetKioskErrorLogsRequest,
  GetKioskErrorLogsResponse,
} from '../types/api'

export class KioskService {
  private httpClient: HttpClient

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient
  }

  /**
   * Get all kiosks
   */
  async getKiosks(): Promise<Kiosk[]> {
    try {
      const kiosksResponse = await this.httpClient.get<Kiosk[] | { kiosks?: Kiosk[] }>(
        '/api/kiosks',
        { cache: true, cacheTime: 30000 }
      )

      if (Array.isArray(kiosksResponse)) {
        return kiosksResponse
      }

      if (kiosksResponse && Array.isArray(kiosksResponse.kiosks)) {
        return kiosksResponse.kiosks
      }

      return []
    } catch (error) {
      if (error instanceof Error) {
        throw error
      }
      throw new Error('Błąd pobierania listy kiośków')
    }
  }

  /**
   * Get kiosk by ID
   */
  async getKiosk(kioskId: number): Promise<Kiosk> {
    try {
      const kiosks = await this.getKiosks()
      const kiosk = kiosks.find((k) => k.id === kioskId)

      if (!kiosk) {
        throw new Error('Kiosk not found')
      }

      return kiosk
    } catch (error) {
      if (error instanceof Error) {
        throw error
      }
      throw new Error('Błąd pobierania danych kiosku')
    }
  }

  /**
   * Create new kiosk
   */
  async createKiosk(data: CreateKioskRequest): Promise<{ id: number; message: string }> {
    try {
      const response = await this.httpClient.post<{ id: number; message: string }>(
        '/api/kiosks',
        data,
        { timeout: 15000 }
      )

      if (!response || typeof response.id !== 'number') {
        throw new Error('Failed to create kiosk')
      }

      // Invalidate cache
      this.httpClient.clearCache()

      return response
    } catch (error) {
      if (error instanceof Error) {
        throw error
      }
      throw new Error('Błąd tworzenia kiosku')
    }
  }

  /**
   * Update kiosk
   */
  async updateKiosk(kioskId: number, data: UpdateKioskRequest): Promise<{ message: string }> {
    try {
      const updated = await this.httpClient.put<{ message: string }>(
        `/api/kiosks/${kioskId}`,
        data,
        { timeout: 15000 }
      )

      if (!updated || !updated.message) {
        throw new Error('Failed to update kiosk')
      }

      // Invalidate cache
      this.httpClient.clearCache()

      return updated
    } catch (error) {
      if (error instanceof Error) {
        throw error
      }
      throw new Error('Błąd aktualizacji kiosku')
    }
  }

  /**
   * Delete kiosk
   */
  async deleteKiosk(kioskId: number): Promise<void> {
    try {
      await this.httpClient.delete(
        `/api/kiosks/${kioskId}`,
        { timeout: 15000 }
      )

      // Invalidate cache
      this.httpClient.clearCache()
    } catch (error) {
      if (error instanceof Error) {
        throw error
      }
      throw new Error('Błąd usuwania kiosku')
    }
  }

  /**
   * Get FTP credentials for kiosk
   */
  async getFtpCredentials(kioskId: number): Promise<{
    id: number
    name: string
    ip_address: string | null
    ftp_username: string
    ftp_password: string
    media_path?: string | null
    text_file_path?: string | null
    playlist_target_file?: string | null
  }> {
    try {
      const credentials = await this.httpClient.get<{
        id: number
        name: string
        ip_address: string | null
        ftp_username: string
        ftp_password: string
        media_path?: string | null
        text_file_path?: string | null
        playlist_target_file?: string | null
      }>(
        `/api/kiosks/${kioskId}/ftp-credentials`,
        { timeout: 10000 }
      )

      if (!credentials) {
        throw new Error('Failed to get FTP credentials')
      }

      return credentials
    } catch (error) {
      if (error instanceof Error) {
        throw error
      }
      throw new Error('Błąd pobierania danych FTP')
    }
  }

  /**
   * Restart kiosk service
   */
  async restartService(kioskId: number, options?: KioskRestartServiceRequest): Promise<{ success: boolean; message: string }> {
    try {
      const result = await this.httpClient.post<{ success: boolean; message: string }>(
        `/api/kiosks/${kioskId}/restart-service`,
        options || {},
        { timeout: 30000 }
      )

      if (!result || typeof result !== 'object' || !('success' in result)) {
        throw new Error('Invalid response from server')
      }

      return result
    } catch (error) {
      if (error instanceof Error) {
        throw error
      }
      throw new Error('Błąd restartu usługi')
    }
  }

  /**
   * Rotate display
   */
  async rotateDisplay(kioskId: number, orientation: string): Promise<KioskRotateDisplayResponse> {
    try {
      const result = await this.httpClient.post<KioskRotateDisplayResponse>(
        `/api/kiosks/${kioskId}/rotate-display`,
        { orientation },
        { timeout: 20000 }
      )

      if (!result) {
        throw new Error('Invalid response from server')
      }

      return result
    } catch (error) {
      if (error instanceof Error) {
        throw error
      }
      throw new Error('Błąd obracania ekranu')
    }
  }

  async setScrollingTextVisibility(
    kioskId: number,
    hidden: boolean,
    text?: string
  ): Promise<{ success: boolean; message: string; hidden: boolean }> {
    const endpoint = `/api/kiosks/${kioskId}/scrolling-text-visibility`
    const payload: { hidden: boolean; text?: string } = { hidden }
    if (typeof text === 'string') {
      payload.text = text
    }

    try {
      const result = await this.httpClient.post<{ success: boolean; message: string; hidden: boolean }>(
        endpoint,
        payload,
        { timeout: 20000 }
      )

      if (!result) {
        throw new Error('Invalid response from server')
      }

      return result
    } catch (error) {
      if (error instanceof Error && /405|METHOD NOT ALLOWED/i.test(error.message)) {
        try {
          const result = await this.httpClient.put<{ success: boolean; message: string; hidden: boolean }>(
            endpoint,
            payload,
            { timeout: 20000 }
          )

          if (!result) {
            throw new Error('Invalid response from server')
          }

          return result
        } catch (fallbackError) {
          if (fallbackError instanceof Error) {
            throw new Error(
              `${fallbackError.message}. Backend wymaga aktualizacji endpointu scrolling-text-visibility.`
            )
          }
          throw new Error('Backend wymaga aktualizacji endpointu scrolling-text-visibility.')
        }
      }

      if (error instanceof Error) {
        throw error
      }
      throw new Error('Błąd ustawiania widoczności scrolling text')
    }
  }

  async getTickerOrientation(): Promise<string> {
    try {
      const result = await this.httpClient.get<{ orientation?: string }>(
        '/api/ticker-orientation',
        { timeout: 10000 }
      )

      return String(result?.orientation || 'normal').toLowerCase()
    } catch {
      return 'normal'
    }
  }

  async getErrorLogs(filters: GetKioskErrorLogsRequest = {}): Promise<GetKioskErrorLogsResponse> {
    try {
      const params = new URLSearchParams()
      if (typeof filters.kiosk_id === 'number' && Number.isFinite(filters.kiosk_id)) {
        params.set('kiosk_id', String(filters.kiosk_id))
      }
      if (filters.level) {
        params.set('level', String(filters.level))
      }
      if (typeof filters.limit === 'number' && Number.isFinite(filters.limit)) {
        params.set('limit', String(filters.limit))
      }

      const query = params.toString()
      const endpoint = query ? `/api/kiosks/error-logs?${query}` : '/api/kiosks/error-logs'
      const result = await this.httpClient.get<GetKioskErrorLogsResponse>(endpoint, { timeout: 10000 })

      if (!result || !Array.isArray(result.logs)) {
        throw new Error('Nieprawidłowa odpowiedź logów błędów kiosków')
      }

      return result
    } catch (error) {
      if (error instanceof Error) {
        throw error
      }
      throw new Error('Błąd pobierania logów błędów kiosków')
    }
  }

  /**
   * Update device IP (called by device itself)
   */
  async updateDeviceIp(serialNumber: string, ipAddress: string, macAddress?: string): Promise<{ status: string }> {
    try {
      const result = await this.httpClient.post<{ status: string }>(
        `/api/device/${serialNumber}/ip`,
        {
          ip_address: ipAddress,
          ...(macAddress && { mac_address: macAddress }),
        },
        { skipAuth: true, timeout: 10000 }
      )

      if (!result) {
        throw new Error('Failed to update IP')
      }

      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Błąd aktualizacji IP'
      throw new Error(message)
    }
  }

  /**
   * Get kiosk status (online/offline)
   */
  getKioskStatus(kiosk: Kiosk): 'online' | 'offline' {
    return kiosk.status as 'online' | 'offline'
  }

  /**
   * Check if kiosk is online
   */
  isKioskOnline(kiosk: Kiosk): boolean {
    return kiosk.status === 'online'
  }

  /**
   * Get time since last connection
   */
  getTimeSinceLastConnection(kiosk: Kiosk): string {
    const lastConnection = new Date(kiosk.last_connection)
    const now = new Date()
    const diffMs = now.getTime() - lastConnection.getTime()

    const diffMins = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffMins < 60) {
      return `${diffMins} minut temu`
    } else if (diffHours < 24) {
      return `${diffHours} godzin temu`
    } else {
      return `${diffDays} dni temu`
    }
  }

  /**
   * Log SSH access attempt
   */
  async logSshAccess(kioskId: number): Promise<{ success: boolean }> {
    try {
      const result = await this.httpClient.post<{ success: boolean }>(
        `/api/kiosks/${kioskId}/log-ssh-access`,
        { client: 'browser' },
        { timeout: 5000 }
      )

      if (!result || typeof result.success !== 'boolean') {
        throw new Error('Invalid response')
      }

      return result
    } catch (error) {
      // Silently fail - logging shouldn't break the SSH connection
      console.warn('Failed to log SSH access:', error)
      return { success: false }
    }
  }

  /**
   * Log VNC access attempt
   */
  async logVncAccess(kioskId: number): Promise<{ success: boolean }> {
    try {
      const result = await this.httpClient.post<{ success: boolean }>(
        `/api/kiosks/${kioskId}/log-vnc-access`,
        { client: 'browser' },
        { timeout: 5000 }
      )

      if (!result || typeof result.success !== 'boolean') {
        throw new Error('Invalid response')
      }

      return result
    } catch (error) {
      // Silently fail - logging shouldn't break the VNC connection
      console.warn('Failed to log VNC access:', error)
      return { success: false }
    }
  }
}
