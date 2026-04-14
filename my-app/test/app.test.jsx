import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../src/pages/Dashboard', () => ({ default: () => <div>DashboardPage</div> }))
vi.mock('../src/pages/Ftp', () => ({ default: () => <div>FtpPage</div> }))
vi.mock('../src/pages/Kiosk', () => ({ default: () => <div>KioskPage</div> }))
vi.mock('../src/pages/Playlist', () => ({ default: () => <div>PlaylistPage</div> }))
vi.mock('../src/pages/Reservation', () => ({ default: () => <div>ReservationPage</div> }))
vi.mock('../src/pages/Settings', () => ({ default: () => <div>SettingsPage</div> }))
vi.mock('../src/pages/TextEditor', () => ({ default: () => <div>TextEditorPage</div> }))
vi.mock('../src/pages/User', () => ({ default: () => <div>UserPage</div> }))

vi.mock('../src/hooks', () => ({
  useAuth: () => ({
    isAuthenticated: () => false,
    login: vi.fn().mockResolvedValue({}),
    logout: vi.fn().mockResolvedValue({}),
  }),
}))

import App from '../src/App'

describe('App segment', () => {
  it('renders login form when user is not authenticated', () => {
    render(<App />)

    expect(screen.getByText('Logowanie')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Login')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Hasło')).toBeInTheDocument()
  })
})
