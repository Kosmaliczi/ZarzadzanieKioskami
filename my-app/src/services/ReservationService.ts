/**
 * Reservation Service
 * Handles all reservation-related API calls
 */

import { HttpClient } from '../core/HttpClient'
import type {
  Reservation,
  CheckReservationRequest,
  CheckReservationResponse,
  CreateReservationRequest,
  CreateReservationResponse,
  GetReservationsRequest,
  CancelReservationRequest,
} from '../types/api'

export class ReservationService {
  private httpClient: HttpClient

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient
  }

  /**
   * Check if time slot is available
   */
  async checkAvailability(request: CheckReservationRequest): Promise<CheckReservationResponse> {
    try {
      const response = await this.httpClient.post<CheckReservationResponse>(
        '/api/reservations/check',
        request,
        { timeout: 10000 }
      )

      if (!response) {
        throw new Error('Failed to check availability')
      }

      return response
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Błąd sprawdzania dostępności'
      throw new Error(message)
    }
  }

  /**
   * Create new reservation
   */
  async createReservation(request: CreateReservationRequest): Promise<CreateReservationResponse> {
    try {
      const response = await this.httpClient.post<{
        success: boolean
        reservation_id: number
        message: string
        date: string
        start_time: string
        end_time: string
        name: string
      }>(
        '/api/reservations/create',
        request,
        { timeout: 15000 }
      )

      if (!response || typeof response.reservation_id !== 'number') {
        throw new Error('Failed to create reservation')
      }

      // Invalidate cache
      this.httpClient.clearCache()

      return {
        reservation: {
          id: response.reservation_id,
          date: response.date,
          name: response.name,
          start_time: response.start_time,
          end_time: response.end_time,
          status: 'active',
          created_at: new Date().toISOString(),
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Błąd tworzenia rezerwacji'
      throw new Error(message)
    }
  }

  /**
   * Get user's reservations
   */
  async getReservations(request?: GetReservationsRequest): Promise<Reservation[]> {
    try {
      let endpoint = '/api/reservations'

      // Build query string if filters provided
      if (request) {
        const params = new URLSearchParams()

        if (request.status) {
          params.append('status', request.status)
        }

        if (request.limit) {
          params.append('limit', String(request.limit))
        }

        if (request.offset) {
          params.append('offset', String(request.offset))
        }

        if (params.toString()) {
          endpoint += `?${params.toString()}`
        }
      }

      const response = await this.httpClient.get<{ success: boolean; reservations: Reservation[]; count: number }>(
        endpoint,
        { cache: true, cacheTime: 30000 }
      )

      return response?.reservations || []
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Błąd pobierania rezerwacji'
      throw new Error(message)
    }
  }

  /**
   * Cancel reservation
   */
  async cancelReservation(reservationId: number, request?: CancelReservationRequest): Promise<void> {
    try {
      await this.httpClient.patch(
        `/api/reservations/${reservationId}/cancel`,
        request || {},
        { timeout: 10000 }
      )

      // Invalidate cache
      this.httpClient.clearCache()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Błąd anulowania rezerwacji'
      throw new Error(message)
    }
  }

  /**
   * Format time slot
   */
  formatTimeSlot(startTime: string, endTime: string): string {
    const start = new Date(startTime)
    const end = new Date(endTime)

    const startStr = start.toLocaleString('pl-PL', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })

    const endStr = end.toLocaleString('pl-PL', {
      hour: '2-digit',
      minute: '2-digit',
    })

    return `${startStr} - ${endStr}`
  }

  /**
   * Get duration in minutes
   */
  getDurationMinutes(startTime: string, endTime: string): number {
    const start = new Date(startTime)
    const end = new Date(endTime)

    return Math.floor((end.getTime() - start.getTime()) / (1000 * 60))
  }

  /**
   * Get duration formatted
   */
  getDurationFormatted(startTime: string, endTime: string): string {
    const minutes = this.getDurationMinutes(startTime, endTime)

    if (minutes < 60) {
      return `${minutes} min`
    }

    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60

    if (mins === 0) {
      return `${hours}h`
    }

    return `${hours}h ${mins}min`
  }

  /**
   * Check if reservation is upcoming
   */
  isUpcoming(reservation: Reservation): boolean {
    const now = new Date()
    const startTime = new Date(reservation.start_time)

    return startTime > now && reservation.status === 'active'
  }

  /**
   * Check if reservation is active now
   */
  isActiveNow(reservation: Reservation): boolean {
    const now = new Date()
    const startTime = new Date(reservation.start_time)
    const endTime = new Date(reservation.end_time)

    return now >= startTime && now <= endTime && reservation.status === 'active'
  }

  /**
   * Check if reservation is past
   */
  isPast(reservation: Reservation): boolean {
    const now = new Date()
    const endTime = new Date(reservation.end_time)

    return now > endTime
  }

  /**
   * Get status color
   */
  getStatusColor(reservation: Reservation): 'green' | 'blue' | 'red' | 'gray' {
    if (reservation.status === 'cancelled') {
      return 'gray'
    }

    if (this.isActiveNow(reservation)) {
      return 'green'
    }

    if (this.isUpcoming(reservation)) {
      return 'blue'
    }

    return 'red'
  }

  /**
   * Get status label
   */
  getStatusLabel(reservation: Reservation): string {
    switch (reservation.status) {
      case 'active':
        if (this.isActiveNow(reservation)) {
          return 'W trakcie'
        }
        if (this.isUpcoming(reservation)) {
          return 'Nadchodząca'
        }
        return 'Zakończona'

      case 'cancelled':
        return 'Anulowana'

      case 'completed':
        return 'Ukończona'

      default:
        return 'Nieznany status'
    }
  }
}
