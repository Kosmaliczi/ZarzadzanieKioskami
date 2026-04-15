import { useEffect, useRef, useState } from 'react'
import Dashboard from './pages/Dashboard'
import Ftp from './pages/Ftp'
import Kiosk from './pages/Kiosk'
import Playlist from './pages/Playlist'
import Reservation from './pages/Reservation'
import Settings from './pages/Settings'
import TextEditor from './pages/TextEditor'
import User from './pages/User'
import { useAuth } from './hooks'
import * as THREE from 'three'

const WAVE_COLORS = [0x36378, 0x153700, 0x637803]

function App() {
  const auth = useAuth()
  const vantaRef = useRef(null)
  const initialUser = auth.getCurrentUser()
  const [activePage, setActivePage] = useState('dashboard')
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('admin')
  const [authError, setAuthError] = useState('')
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(auth.isAuthenticated())
  const [isPasswordChangeRequired, setIsPasswordChangeRequired] = useState(Boolean(initialUser?.mustChangePassword))
  const [currentPasswordForChange, setCurrentPasswordForChange] = useState('')
  const [newPasswordForChange, setNewPasswordForChange] = useState('')
  const [confirmPasswordForChange, setConfirmPasswordForChange] = useState('')
  const [passwordChangeError, setPasswordChangeError] = useState('')
  const [isChangingPassword, setIsChangingPassword] = useState(false)

  const handleLogin = async (event) => {
    event.preventDefault()
    setAuthError('')
    setIsAuthenticating(true)
    try {
      const loginPassword = password
      const loginResult = await auth.login({ username, password })
      setIsLoggedIn(true)

      if (loginResult?.user?.mustChangePassword) {
        setIsPasswordChangeRequired(true)
        setCurrentPasswordForChange(loginPassword)
      } else {
        setIsPasswordChangeRequired(false)
        setCurrentPasswordForChange('')
      }

      setPassword('')
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Błąd logowania')
    } finally {
      setIsAuthenticating(false)
    }
  }

  const handleLogout = async () => {
    await auth.logout()
    setIsLoggedIn(false)
    setIsPasswordChangeRequired(false)
    setCurrentPasswordForChange('')
    setNewPasswordForChange('')
    setConfirmPasswordForChange('')
    setPasswordChangeError('')
  }

  const handleForcedPasswordChange = async (event) => {
    event.preventDefault()
    setPasswordChangeError('')

    if (!newPasswordForChange || newPasswordForChange.length < 6) {
      setPasswordChangeError('Nowe hasło musi mieć co najmniej 6 znaków')
      return
    }

    if (newPasswordForChange !== confirmPasswordForChange) {
      setPasswordChangeError('Nowe hasła do siebie nie pasują')
      return
    }

    setIsChangingPassword(true)
    try {
      await auth.changePassword(currentPasswordForChange, newPasswordForChange, confirmPasswordForChange)
      setIsPasswordChangeRequired(false)
      setCurrentPasswordForChange('')
      setNewPasswordForChange('')
      setConfirmPasswordForChange('')
    } catch (error) {
      setPasswordChangeError(error instanceof Error ? error.message : 'Błąd zmiany hasła')
    } finally {
      setIsChangingPassword(false)
    }
  }

  useEffect(() => {
    let effect
    let cancelled = false
    let colorIntervalId
    let colorFrameId

    const transitionDurationMs = 2000
    const changeEveryMs = 10000

    const lerpColor = (fromColor, toColor, progress) => {
      const fromR = (fromColor >> 16) & 0xff
      const fromG = (fromColor >> 8) & 0xff
      const fromB = fromColor & 0xff
      const toR = (toColor >> 16) & 0xff
      const toG = (toColor >> 8) & 0xff
      const toB = toColor & 0xff

      const r = Math.round(fromR + (toR - fromR) * progress)
      const g = Math.round(fromG + (toG - fromG) * progress)
      const b = Math.round(fromB + (toB - fromB) * progress)

      return (r << 16) + (g << 8) + b
    }

    const animateColorTransition = (fromColor, toColor) => {
      const startedAt = performance.now()

      const step = (timestamp) => {
        if (cancelled || !effect || typeof effect.setOptions !== 'function') {
          return
        }

        const progress = Math.min((timestamp - startedAt) / transitionDurationMs, 1)
        effect.setOptions({ color: lerpColor(fromColor, toColor, progress) })

        if (progress < 1) {
          colorFrameId = requestAnimationFrame(step)
        }
      }

      if (colorFrameId) {
        cancelAnimationFrame(colorFrameId)
      }

      colorFrameId = requestAnimationFrame(step)
    }

    const initWaves = async () => {
      if (!vantaRef.current) {
        return
      }

      window.THREE = THREE
      const module = await import('vanta/dist/vanta.waves.min.js')
      const createWaves = module?.default?.default || module?.default || module

      if (cancelled || !vantaRef.current) {
        return
      }

      if (typeof createWaves !== 'function') {
        throw new Error('Vanta WAVES initializer not found in module export')
      }

      const lowPowerDevice =
        (typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency <= 4) ||
        (typeof navigator.deviceMemory === 'number' && navigator.deviceMemory <= 4)
      const reducedMotion =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const ultraLow = lowPowerDevice || reducedMotion

      effect = createWaves({
        el: vantaRef.current,
        THREE,
        mouseControls: true,
        touchControls: true,
        gyroControls: false,
        backgroundAlpha: 1,
        color: WAVE_COLORS[0],
        shininess: ultraLow ? 105 : 105,
        waveHeight: ultraLow ? 14 : 18,
        waveSpeed: ultraLow ? 0.55 : 0.8,
        zoom: ultraLow ? 0.92 : 0.85,
        minHeight: 200,
        minWidth: 200,
        scale: ultraLow ? 3.5 : 3.2,
        scaleMobile: ultraLow ? 5 : 3,
      })

      let colorIndex = 0
      colorIntervalId = window.setInterval(() => {
        const fromColor = WAVE_COLORS[colorIndex]
        colorIndex = (colorIndex + 1) % WAVE_COLORS.length
        const toColor = WAVE_COLORS[colorIndex]
        animateColorTransition(fromColor, toColor)
      }, changeEveryMs)
    }

    initWaves().catch((error) => {
      console.error('Vanta WAVES init failed:', error)
    })

    return () => {
      cancelled = true
      if (colorIntervalId) {
        window.clearInterval(colorIntervalId)
      }
      if (colorFrameId) {
        cancelAnimationFrame(colorFrameId)
      }
      if (effect) {
        effect.destroy()
      }
    }
  }, [])
  const navItems = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'kiosk', label: 'Kioski' },
    { key: 'ftp', label: 'FTP' },
    { key: 'playlist', label: 'Playlista' },
    { key: 'reservation', label: 'Rezerwacje' },
    { key: 'textEditor', label: 'Edytor TXT' },
    { key: 'user', label: 'Uzytkownicy' },
    { key: 'settings', label: 'Ustawienia' },
  ]

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard':
        return <Dashboard />
      case 'kiosk':
        return <Kiosk />
      case 'ftp':
        return <Ftp />
      case 'playlist':
        return <Playlist />
      case 'reservation':
        return <Reservation />
      case 'textEditor':
        return <TextEditor />
      case 'user':
        return <User />
      case 'settings':
        return <Settings />
      default:
        return <Dashboard />
    }
  }

  const getNavButtonClass = (isActive) => {
    const baseClass = 'btn-lift rounded-xl border px-4 py-2 text-sm font-semibold tracking-wide transition-all duration-200'
    const activeClass = 'border-slate-600 bg-slate-600 text-white shadow-[0_10px_20px_-12px_rgba(15,23,42,0.75)]'
    const inactiveClass = 'border-slate-400 bg-slate-200/85 text-slate-900 hover:border-slate-500 hover:bg-slate-300'

    return `${baseClass} ${isActive ? activeClass : inactiveClass}`
  }

  const loggedInUser = auth.getCurrentUser()

  return (
    <div className="relative min-h-screen">
      <div ref={vantaRef} className="fixed inset-0 z-0" aria-hidden="true" />
      <div className="app-shell relative z-10 mx-auto w-full max-w-7xl px-4 py-6 md:px-6 md:py-8">
        {!isLoggedIn ? (
          <section className="glass-panel mx-auto max-w-md rounded-2xl border border-slate-300/80 p-7 shadow-[0_16px_45px_-20px_rgba(7,22,56,0.55)]">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-700">Panel kiosku</p>
            <h1 className="mb-5 text-2xl font-semibold text-slate-900">Logowanie</h1>
            <form onSubmit={handleLogin} className="space-y-3">
              <input
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white/85 px-3 py-2 text-slate-900 placeholder:text-slate-500 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-300"
                placeholder="Login"
              />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white/85 px-3 py-2 text-slate-900 placeholder:text-slate-500 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-300"
                placeholder="Hasło"
              />
              {authError ? <p className="text-sm text-red-700">{authError}</p> : null}
              <button
                type="submit"
                disabled={isAuthenticating}
                className="btn-lift w-full rounded-lg border border-slate-700 bg-slate-700 px-3 py-2 font-medium text-white transition-colors hover:bg-slate-600 disabled:opacity-50"
              >
                {isAuthenticating ? 'Logowanie...' : 'Zaloguj'}
              </button>
            </form>
          </section>
        ) : isPasswordChangeRequired ? (
          <section className="glass-panel mx-auto max-w-md rounded-2xl border border-slate-300/80 p-7 shadow-[0_16px_45px_-20px_rgba(7,22,56,0.55)]">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-700">Bezpieczenstwo konta</p>
            <h1 className="mb-2 text-2xl font-semibold text-slate-900">Wymagana zmiana hasla</h1>
            <p className="mb-5 text-sm text-slate-700">
              Uzytkownik <strong>{loggedInUser?.username || username}</strong> musi zmienic haslo przy pierwszym logowaniu.
            </p>

            <form onSubmit={handleForcedPasswordChange} className="space-y-3">
              <input
                type="password"
                value={newPasswordForChange}
                onChange={(event) => setNewPasswordForChange(event.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white/85 px-3 py-2 text-slate-900 placeholder:text-slate-500 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-300"
                placeholder="Nowe haslo"
              />
              <input
                type="password"
                value={confirmPasswordForChange}
                onChange={(event) => setConfirmPasswordForChange(event.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white/85 px-3 py-2 text-slate-900 placeholder:text-slate-500 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-300"
                placeholder="Potwierdz nowe haslo"
              />

              {passwordChangeError ? <p className="text-sm text-red-700">{passwordChangeError}</p> : null}

              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={isChangingPassword}
                  className="btn-lift flex-1 rounded-lg border border-slate-700 bg-slate-700 px-3 py-2 font-medium text-white transition-colors hover:bg-slate-600 disabled:opacity-50"
                >
                  {isChangingPassword ? 'Zapisywanie...' : 'Zmien haslo'}
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="btn-lift rounded-lg border border-slate-400 bg-slate-200/85 px-3 py-2 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-300"
                >
                  Wyloguj
                </button>
              </div>
            </form>
          </section>
        ) : (
          <>
            <header className="glass-panel -mt-3 mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-300/80 p-3 shadow-[0_12px_32px_-24px_rgba(15,23,42,0.8)]">
              <div className="flex flex-wrap gap-2">
                {navItems.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setActivePage(item.key)}
                    className={getNavButtonClass(activePage === item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="ml-auto flex items-center gap-3">
                {loggedInUser && (
                  <span className="text-sm text-slate-700">
                    Zalogowany jako: <strong>{loggedInUser.username}</strong>
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleLogout}
                  className="btn-lift rounded-lg border border-slate-400 bg-slate-200/85 px-3 py-2 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-300"
                >
                  Wyloguj
                </button>
              </div>
            </header>

            <main className="rounded-2xl border border-slate-300/80 bg-slate-100/88 p-3 shadow-[0_20px_40px_-32px_rgba(15,23,42,0.9)] md:p-4">{renderPage()}</main>
          </>
        )}
      </div>
    </div>
  )
}

export default App