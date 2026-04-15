/**
 * User Service
 * Handles user management and account-related API calls (admin and user operations)
 */

import { HttpClient } from '../core/HttpClient'
import type {
  User,
  CreateUserRequest,
  UpdateUserRoleRequest,
  ChangePasswordRequest,
  PermissionsCatalogResponse,
  UserPermissionsResponse,
  UpdateUserPermissionsRequest,
  UpdateUserPermissionsResponse,
} from '../types/api'

export class UserService {
  private httpClient: HttpClient

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient
  }

  /**
   * Get all users (admin only)
   */
  async getUsers(): Promise<User[]> {
    try {
      const response = await this.httpClient.get<{ success: boolean; users: User[]; count: number }>(
        '/api/users',
        { cache: true, cacheTime: 30000 }
      )

      return response?.users || []
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Błąd pobierania listy użytkowników'
      throw new Error(message)
    }
  }

  /**
   * Create new user (admin only)
   */
  async createUser(data: CreateUserRequest): Promise<User> {
    try {
      const response = await this.httpClient.post<{ success: boolean; user_id: number; username: string; message: string }>(
        '/api/users',
        data,
        { timeout: 15000 }
      )

      if (!response || typeof response.user_id !== 'number') {
        throw new Error('Failed to create user')
      }

      // Invalidate cache
      this.httpClient.clearCache()

      return {
        id: response.user_id,
        username: response.username,
        role: data.role || 'user',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Błąd tworzenia użytkownika'
      throw new Error(message)
    }
  }

  /**
   * Delete user (admin only)
   */
  async deleteUser(userId: number): Promise<void> {
    try {
      await this.httpClient.delete(
        `/api/users/${userId}`,
        { timeout: 15000 }
      )

      // Invalidate cache
      this.httpClient.clearCache()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Błąd usuwania użytkownika'
      throw new Error(message)
    }
  }

  /**
   * Update user role (admin only)
   */
  async updateUserRole(userId: number, role: 'admin' | 'user'): Promise<User> {
    try {
      const response = await this.httpClient.put<{ success: boolean; user_id: number; new_role: 'admin' | 'user'; message: string }>(
        `/api/users/${userId}/role`,
        { role } as UpdateUserRoleRequest,
        { timeout: 15000 }
      )

      if (!response || typeof response.user_id !== 'number') {
        throw new Error('Failed to update user role')
      }

      // Invalidate cache
      this.httpClient.clearCache()

      return {
        id: response.user_id,
        username: '',
        role: response.new_role,
        created_at: '',
        updated_at: new Date().toISOString(),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Błąd aktualizacji roli użytkownika'
      throw new Error(message)
    }
  }

  /**
   * Change own password
   */
  async changePassword(currentPassword: string, newPassword: string, confirmPassword?: string): Promise<void> {
    try {
      await this.httpClient.post(
        '/api/account/change-password',
        {
          current_password: currentPassword,
          new_password: newPassword,
          confirm_password: confirmPassword || newPassword,
        } as ChangePasswordRequest,
        { timeout: 15000 }
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Błąd zmiany hasła'
      throw new Error(message)
    }
  }

  /**
   * Change other user's password (admin only)
   */
  async changeUserPassword(userId: number, newPassword: string): Promise<void> {
    try {
      await this.httpClient.post(
        `/api/users/${userId}/change-password`,
        {
          new_password: newPassword,
          confirm_password: newPassword,
        },
        { timeout: 15000 }
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Błąd zmiany hasła użytkownika'
      throw new Error(message)
    }
  }

  /**
   * Get available action permissions catalog (admin or users.manage)
   */
  async getPermissionsCatalog(): Promise<Array<{ key: string; label: string }>> {
    try {
      const response = await this.httpClient.get<PermissionsCatalogResponse>(
        '/api/permissions/catalog',
        { cache: true, cacheTime: 60000 }
      )
      return response?.actions || []
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Błąd pobierania katalogu uprawnień'
      throw new Error(message)
    }
  }

  /**
   * Get action permissions for specific user
   */
  async getUserPermissions(userId: number): Promise<Record<string, boolean>> {
    try {
      const response = await this.httpClient.get<UserPermissionsResponse>(
        `/api/users/${userId}/permissions`,
        { timeout: 10000 }
      )
      return response?.permissions || {}
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Błąd pobierania uprawnień użytkownika'
      throw new Error(message)
    }
  }

  /**
   * Update action permissions for specific user
   */
  async updateUserPermissions(userId: number, permissions: Record<string, boolean>): Promise<Record<string, boolean>> {
    try {
      const response = await this.httpClient.put<UpdateUserPermissionsResponse>(
        `/api/users/${userId}/permissions`,
        { permissions } as UpdateUserPermissionsRequest,
        { timeout: 15000 }
      )

      if (!response?.success) {
        throw new Error('Nie udało się zapisać uprawnień użytkownika')
      }

      this.httpClient.clearCache()
      return response.permissions || {}
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Błąd aktualizacji uprawnień użytkownika'
      throw new Error(message)
    }
  }

  /**
   * Validate username
   */
  validateUsername(username: string): { valid: boolean; error?: string } {
    if (!username || username.length < 3) {
      return { valid: false, error: 'Nazwa użytkownika musi mieć co najmniej 3 znaki' }
    }

    if (username.length > 30) {
      return { valid: false, error: 'Nazwa użytkownika może mieć maksymalnie 30 znaków' }
    }

    const validPattern = /^[a-zA-Z0-9._-]+$/
    if (!validPattern.test(username)) {
      return { valid: false, error: 'Nazwa użytkownika może zawierać tylko litery, cyfry, . _ i -' }
    }

    return { valid: true }
  }

  /**
   * Validate password
   */
  validatePassword(password: string): { valid: boolean; error?: string; strength: 'weak' | 'medium' | 'strong' } {
    if (!password || password.length < 8) {
      return { valid: false, error: 'Hasło musi mieć co najmniej 8 znaków', strength: 'weak' }
    }

    if (password.length > 128) {
      return { valid: false, error: 'Hasło może mieć maksymalnie 128 znaków', strength: 'weak' }
    }

    // Determine strength
    let strength: 'weak' | 'medium' | 'strong' = 'weak'
    let strengthScore = 0

    if (/[a-z]/.test(password)) strengthScore++
    if (/[A-Z]/.test(password)) strengthScore++
    if (/[0-9]/.test(password)) strengthScore++
    if (/[!@#$%^&*]/.test(password)) strengthScore++

    if (strengthScore <= 1) {
      strength = 'weak'
    } else if (strengthScore === 2) {
      strength = 'medium'
    } else {
      strength = 'strong'
    }

    return { valid: true, strength }
  }

  /**
   * Get role label (Polish)
   */
  getRoleLabel(role: 'admin' | 'user'): string {
    switch (role) {
      case 'admin':
        return 'Administrator'
      case 'user':
        return 'Użytkownik'
      default:
        return 'Nieznana rola'
    }
  }

  /**
   * Get role description (Polish)
   */
  getRoleDescription(role: 'admin' | 'user'): string {
    switch (role) {
      case 'admin':
        return 'Pełny dostęp do systemu, zarządzanie kiośkami, użytkownikami i ustawieniami'
      case 'user':
        return 'Dostęp do podstawowych funkcji, zarządzanie własnymi rezerwacjami'
      default:
        return 'Nieznana rola'
    }
  }

  /**
   * Check if user is admin
   */
  isAdmin(user: User): boolean {
    return user.role === 'admin'
  }
}
