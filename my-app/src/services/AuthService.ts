/**
 * Authentication Service
 * Handles all authentication and user-related API calls
 */

import { HttpClient } from '../core/HttpClient'
import type { LoginRequest, LoginResponse, AuthToken } from '../types/api'

export class AuthService {
  private httpClient: HttpClient

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient
  }

  /**
   * Login with credentials
   */
  async login(credentials: LoginRequest): Promise<LoginResponse> {
    try {
      const response = await this.httpClient.post<{
        success: boolean
        username: string
        role: 'user' | 'admin'
        must_change_password?: boolean
        token: string
        message?: string
      }>(
        '/api/auth/login',
        credentials,
        {
          skipAuth: true,
          timeout: 10000,
        }
      )

      if (!response?.success || !response?.token) {
        throw new Error(response?.message || 'Niepoprawne dane logowania')
      }

      // Store token
      const expiresIn = 24 * 60 * 60
      this.setToken(response.token, expiresIn)

      const normalized: LoginResponse = {
        token: response.token,
        user: {
          id: null,
          username: response.username,
          role: response.role || 'user',
          mustChangePassword: Boolean(response.must_change_password),
        },
        expiresIn,
      }

      localStorage.setItem('user', JSON.stringify(normalized.user))

      return normalized
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Błąd logowania'
      throw new Error(message)
    }
  }

  /**
   * Logout
   */
  async logout(): Promise<void> {
    // Clear stored token and user data
    this.clearToken()
    localStorage.removeItem('user')
  }

  /**
   * Get current auth token
   */
  getToken(): AuthToken | null {
    try {
      const stored = localStorage.getItem('authToken')
      if (!stored) return null

      const token: AuthToken = JSON.parse(stored)

      // Check expiration
      if (token.expiresAt && Date.now() > token.expiresAt) {
        this.clearToken()
        return null
      }

      return token
    } catch {
      return null
    }
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    const token = this.getToken()
    return token !== null && token.value !== undefined
  }

  /**
   * Set auth token
   */
  setToken(token: string, expiresIn: number): void {
    const authToken: AuthToken = {
      value: token,
      expiresAt: Date.now() + expiresIn * 1000,
    }

    localStorage.setItem('authToken', JSON.stringify(authToken))
  }

  /**
   * Clear auth token
   */
  clearToken(): void {
    localStorage.removeItem('authToken')
  }

  /**
   * Change password
   */
  async changePassword(currentPassword: string, newPassword: string, confirmPassword?: string): Promise<void> {
    try {
      await this.httpClient.post(
        '/api/account/change-password',
        {
          current_password: currentPassword,
          new_password: newPassword,
          confirm_password: confirmPassword || newPassword,
        },
        { timeout: 10000 }
      )

      // Po udanej zmianie hasła przy pierwszym logowaniu zdejmij lokalną flagę wymuszenia.
      try {
        const stored = localStorage.getItem('user')
        if (stored) {
          const user = JSON.parse(stored)
          localStorage.setItem(
            'user',
            JSON.stringify({
              ...user,
              mustChangePassword: false,
            })
          )
        }
      } catch {
        // Ignoruj błąd parse localStorage; nie blokuje to zmiany hasła.
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Błąd zmiany hasła'
      throw new Error(message)
    }
  }

  /**
   * Check token validity
   */
  isTokenExpired(): boolean {
    const token = this.getToken()
    if (!token || !token.expiresAt) {
      return true
    }

    return Date.now() > token.expiresAt
  }

  /**
   * Get time until token expiration (in milliseconds)
   */
  getTokenTimeRemaining(): number {
    const token = this.getToken()
    if (!token || !token.expiresAt) {
      return 0
    }

    const remaining = token.expiresAt - Date.now()
    return remaining > 0 ? remaining : 0
  }

  /**
   * Get current logged-in user
   */
  getCurrentUser(): { username: string; role: 'user' | 'admin'; mustChangePassword: boolean } | null {
    try {
      const stored = localStorage.getItem('user')
      if (!stored) return null
      const user = JSON.parse(stored)
      if (!user) return null

      return {
        username: user.username,
        role: user.role || 'user',
        mustChangePassword: Boolean(user.mustChangePassword),
      }
    } catch {
      return null
    }
  }
}
