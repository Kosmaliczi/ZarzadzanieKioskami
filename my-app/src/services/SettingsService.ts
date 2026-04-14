/**
 * Settings Service
 * Handles application settings (admin only)
 */

import { HttpClient } from '../core/HttpClient'
import type { Settings, UpdateSettingsRequest } from '../types/api'

export class SettingsService {
  private httpClient: HttpClient
  private cachedSettings: Settings | null = null

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient
  }

  /**
   * Get all settings
   */
  async getSettings(): Promise<Settings> {
    try {
      // Return cached settings if available
      if (this.cachedSettings) {
        return this.cachedSettings
      }

      const settings = await this.httpClient.get<Settings>(
        '/api/settings',
        { cache: true, cacheTime: 300000 }
      )

      if (!settings) {
        return {}
      }

      this.cachedSettings = settings

      return settings
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Błąd pobierania ustawień'
      throw new Error(message)
    }
  }

  /**
   * Update settings
   */
  async updateSettings(updates: UpdateSettingsRequest): Promise<Settings> {
    try {
      await this.httpClient.post(
        '/api/settings',
        updates,
        { timeout: 15000 }
      )

      // Invalidate cache and fetch fresh settings
      this.cachedSettings = null
      this.httpClient.clearCache()

      return this.getSettings()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Błąd aktualizacji ustawień'
      throw new Error(message)
    }
  }

  /**
   * Get setting by key
   */
  async getSetting(key: string): Promise<string | number | boolean | null> {
    try {
      const settings = await this.getSettings()
      return settings[key] ?? null
    } catch (error) {
      const message = error instanceof Error ? error.message : `Błąd pobierania ustawienia: ${key}`
      throw new Error(message)
    }
  }

  /**
   * Update single setting
   */
  async updateSetting(key: string, value: string | number | boolean): Promise<void> {
    try {
      await this.updateSettings({ [key]: value })
    } catch (error) {
      const message = error instanceof Error ? error.message : `Błąd aktualizacji ustawienia: ${key}`
      throw new Error(message)
    }
  }

  /**
   * Invalidate cache
   */
  invalidateCache(): void {
    this.cachedSettings = null
    this.httpClient.clearCache()
  }

  /**
   * Common settings getters
   */

  async getDefaultSshUsername(): Promise<string> {
    const value = await this.getSetting('defaultSshUsername')
    return (value as string) || 'root'
  }

  async getDefaultSshPort(): Promise<number> {
    const value = await this.getSetting('defaultSshPort')
    return (value as number) || 22
  }

  async getDefaultSshService(): Promise<string> {
    const value = await this.getSetting('defaultSshService')
    return (value as string) || 'kiosk'
  }

  /**
   * Common settings setters
   */

  async setDefaultSshUsername(username: string): Promise<void> {
    await this.updateSetting('defaultSshUsername', username)
  }

  async setDefaultSshPort(port: number): Promise<void> {
    await this.updateSetting('defaultSshPort', port)
  }

  async setDefaultSshService(service: string): Promise<void> {
    await this.updateSetting('defaultSshService', service)
  }
}
