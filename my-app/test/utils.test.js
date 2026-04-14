import { describe, it, expect } from 'vitest'
import {
  handleApiError,
  formatFileSize,
  buildQueryString,
  validateEmail,
  validateUrl,
} from '../src/utils/apiHelpers'

describe('utils segment', () => {
  it('formats file sizes', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(1024)).toBe('1 KB')
  })

  it('builds query string from params', () => {
    expect(buildQueryString({ status: 'active', limit: 10, empty: '' })).toBe('?status=active&limit=10')
  })

  it('validates email and url', () => {
    expect(validateEmail('test@example.com')).toBe(true)
    expect(validateEmail('wrong')).toBe(false)
    expect(validateUrl('https://example.com')).toBe(true)
    expect(validateUrl('not-url')).toBe(false)
  })

  it('maps known API errors to user-friendly structure', () => {
    const mapped = handleApiError(new Error('404 not found'))
    expect(mapped.code).toBe('NOT_FOUND')
    expect(mapped.message).toContain('Zasób')
  })
})
