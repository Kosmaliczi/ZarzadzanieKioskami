import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHttpClient } from '../src/core/HttpClient'
import axios from 'axios'

vi.mock('axios', () => ({
  default: {
    request: vi.fn(),
  },
}))

describe('core/HttpClient segment', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('adds authorization header when token exists', async () => {
    localStorage.setItem('authToken', JSON.stringify({ value: 'abc123', expiresAt: Date.now() + 60000 }))

    axios.request.mockResolvedValue({ status: 200, data: { ok: true } })

    const client = createHttpClient('http://localhost:5000')
    await client.get('/api/kiosks')

    const options = axios.request.mock.calls[0][0]
    expect(options.headers.Authorization).toBe('Bearer abc123')
  })

  it('uses cache for GET requests when enabled', async () => {
    axios.request.mockResolvedValue({ status: 200, data: [{ id: 1 }] })

    const client = createHttpClient('http://localhost:5000')
    await client.get('/api/kiosks', { cache: true, cacheTime: 60000 })
    await client.get('/api/kiosks', { cache: true, cacheTime: 60000 })

    expect(axios.request).toHaveBeenCalledTimes(1)
  })
})
