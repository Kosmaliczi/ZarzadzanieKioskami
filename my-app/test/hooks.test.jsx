import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAsync } from '../src/hooks/useApi'

describe('hooks segment', () => {
  it('useAsync resolves data and clears loading', async () => {
    const asyncFn = vi.fn().mockResolvedValue(['kiosk'])

    const { result } = renderHook(() => useAsync(asyncFn))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.data).toEqual(['kiosk'])
    expect(result.current.error).toBeNull()
  })
})
