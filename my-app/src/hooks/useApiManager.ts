/**
 * useApiv Hook and Context
 * Provides easy access to API Manager throughout React app
 */

import { createElement, createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { API_BASE_URL } from '../config/env'
import { ApiManager, getApiManager } from '../services/ApiManager'

// Create context
const ApiContext = createContext<ApiManager | null>(null)

/**
 * Provider component for API Context
 */
export function ApiProvider({ children, baseUrl }: { children: ReactNode; baseUrl?: string }) {
  const api = getApiManager(baseUrl || API_BASE_URL)

  return createElement(ApiContext.Provider, { value: api }, children)
}

/**
 * Hook to access API Manager
 */
export function useApi(): ApiManager {
  const context = useContext(ApiContext)

  if (!context) {
    throw new Error('useApi must be used within ApiProvider')
  }

  return context
}

/**
 * Hook to access Auth Service
 */
export function useAuth() {
  return useApi().auth
}

/**
 * Hook to access Kiosk Service
 */
export function useKiosks() {
  return useApi().kiosks
}

/**
 * Hook to access FTP Service
 */
export function useFtp() {
  return useApi().ftp
}

/**
 * Hook to access Reservation Service
 */
export function useReservations() {
  return useApi().reservations
}

/**
 * Hook to access User Service
 */
export function useUsers() {
  return useApi().users
}

/**
 * Hook to access Settings Service
 */
export function useSettings() {
  return useApi().settings
}

/**
 * Hook to access HTTP Client directly (advanced usage)
 */
export function useHttpClient() {
  return useApi().getHttpClient()
}
