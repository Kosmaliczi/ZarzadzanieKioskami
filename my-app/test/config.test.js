import { describe, it, expect, vi } from 'vitest'

describe('config/env segment', () => {
  it('uses VITE_API_BASE_URL when provided', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:5000')
    const mod = await import('../src/config/env.js')
    expect(mod.API_BASE_URL).toBe('http://localhost:5000')
    vi.unstubAllEnvs()
  })

  it('falls back to same-origin base URL', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_API_BASE_URL', '')
    const mod = await import('../src/config/env.js')
    expect(mod.API_BASE_URL).toBe('')
    vi.unstubAllEnvs()
  })
})
