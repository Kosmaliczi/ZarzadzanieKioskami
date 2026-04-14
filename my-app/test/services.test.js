import { describe, it, expect, vi } from 'vitest'
import {
  ApiManager,
  AuthService,
  KioskService,
  FtpService,
  ReservationService,
  UserService,
  SettingsService,
} from '../src/services'

describe('services segment', () => {
  it('exports all main service classes', () => {
    expect(ApiManager).toBeTypeOf('function')
    expect(AuthService).toBeTypeOf('function')
    expect(KioskService).toBeTypeOf('function')
    expect(FtpService).toBeTypeOf('function')
    expect(ReservationService).toBeTypeOf('function')
    expect(UserService).toBeTypeOf('function')
    expect(SettingsService).toBeTypeOf('function')
  })

  it('maps reservation create response to reservation object', async () => {
    const mockHttpClient = {
      post: vi.fn().mockResolvedValue({
        success: true,
        reservation_id: 42,
        message: 'ok',
        date: '2026-04-13',
        start_time: '10:00',
        end_time: '11:00',
        name: 'Test',
      }),
      clearCache: vi.fn(),
    }

    const service = new ReservationService(mockHttpClient)
    const result = await service.createReservation({
      date: '2026-04-13',
      start_time: '10:00',
      end_time: '11:00',
      name: 'Test',
    })

    expect(result.reservation.id).toBe(42)
    expect(mockHttpClient.clearCache).toHaveBeenCalledTimes(1)
  })
})
