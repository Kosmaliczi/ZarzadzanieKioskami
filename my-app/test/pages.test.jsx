import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../src/hooks', () => ({
  useKiosks: () => ({ getKiosks: vi.fn() }),
  useAsync: () => ({
    data: [
      { id: 1, name: 'Kiosk A', status: 'online', last_connection: '2026-04-13 10:00:00' },
      { id: 2, name: 'Kiosk B', status: 'offline', last_connection: '2026-04-13 09:00:00' },
    ],
    loading: false,
    error: null,
  }),
}))

import Dashboard from '../src/pages/Dashboard'

describe('pages segment', () => {
  it('renders dashboard stats from kiosk data', () => {
    render(<Dashboard />)

    expect(screen.getByText('Wszystkie kioski')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('Online')).toBeInTheDocument()
    expect(screen.getByText('Offline')).toBeInTheDocument()
  })
})
