/**
 * React Hooks for API Calls
 * Enterprise-grade hooks for handling async operations with loading, error, and data states
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import type { ApiError } from '../types/api'
import { handleApiError } from '../utils/apiHelpers'

export interface UseAsyncState<T> {
  data: T | null
  loading: boolean
  error: {
    message: string
    code?: string
    details?: Record<string, unknown>
  } | null
}

export interface UseAsyncOptions {
  onSuccess?: (data: unknown) => void
  onError?: (error: ApiError | Error) => void
  skipInitialLoad?: boolean
  deps?: unknown[]
}

/**
 * Hook for handling async API calls
 */
export function useAsync<T>(
  asyncFunction: () => Promise<T>,
  options: UseAsyncOptions = {}
): UseAsyncState<T> & { refetch: () => Promise<void>; retry: () => Promise<void> } {
  const { onSuccess, onError, skipInitialLoad = false, deps = [] } = options

  const [state, setState] = useState<UseAsyncState<T>>({
    data: null,
    loading: !skipInitialLoad,
    error: null,
  })

  const isMountedRef = useRef(true)
  const retryCountRef = useRef(0)
  const asyncFunctionRef = useRef(asyncFunction)
  const onSuccessRef = useRef(onSuccess)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    asyncFunctionRef.current = asyncFunction
  }, [asyncFunction])

  useEffect(() => {
    onSuccessRef.current = onSuccess
  }, [onSuccess])

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  const execute = useCallback(async () => {
    setState((previous) => ({
      ...previous,
      loading: true,
      error: null,
    }))
    retryCountRef.current += 1

    try {
      const response = await asyncFunctionRef.current()

      if (isMountedRef.current) {
        setState({ data: response, loading: false, error: null })

        if (onSuccessRef.current) {
          onSuccessRef.current(response)
        }
      }
    } catch (error) {
      const errorData = handleApiError(error)

      if (isMountedRef.current) {
        setState((previous) => ({
          ...previous,
          loading: false,
          error: {
            message: errorData.message,
            code: errorData.code,
            details: errorData.details,
          },
        }))

        if (onErrorRef.current) {
          onErrorRef.current(error instanceof Error ? error : new Error(errorData.message))
        }
      }
    }
  }, [])

  useEffect(() => {
    isMountedRef.current = true

    if (skipInitialLoad) {
      return () => {
        isMountedRef.current = false
      }
    }

    execute()

    return () => {
      isMountedRef.current = false
    }
  }, [execute, skipInitialLoad, ...deps])

  return {
    ...state,
    refetch: execute,
    retry: execute,
  }
}

/**
 * Hook for handling mutation (POST, PUT, DELETE operations)
 */
export function useMutation<TData, TError = ApiError>(
  mutationFn: (data?: unknown) => Promise<TData>,
  options: UseAsyncOptions = {}
): {
  execute: (data?: unknown) => Promise<TData>
  loading: boolean
  error: TError | null
  data: TData | null
  reset: () => void
} {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<TError | null>(null)
  const [data, setData] = useState<TData | null>(null)
  const isMountedRef = useRef(true)
  const mutationFnRef = useRef(mutationFn)
  const optionsRef = useRef(options)

  useEffect(() => {
    mutationFnRef.current = mutationFn
  }, [mutationFn])

  useEffect(() => {
    optionsRef.current = options
  }, [options])

  const execute = useCallback(
    async (mutationData?: unknown): Promise<TData> => {
      setLoading(true)
      setError(null)

      try {
        const response = await mutationFnRef.current(mutationData)

        if (isMountedRef.current) {
          setData(response)
          setLoading(false)

          if (optionsRef.current.onSuccess) {
            optionsRef.current.onSuccess(response)
          }
        }

        return response
      } catch (err) {
        const errorData = handleApiError(err)
        const apiError: TError = {
          message: errorData.message,
          code: errorData.code,
          details: errorData.details,
        } as TError

        if (isMountedRef.current) {
          setError(apiError)
          setLoading(false)

          if (optionsRef.current.onError) {
            optionsRef.current.onError(err instanceof Error ? err : new Error(errorData.message))
          }
        }

        throw apiError
      }
    },
    []
  )

  const reset = useCallback(() => {
    setData(null)
    setError(null)
    setLoading(false)
  }, [])

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
    }
  }, [])

  return { execute, loading, error, data, reset }
}

/**
 * Hook for handling pagination
 */
export function usePagination<T>(
  fetchFn: (page: number, pageSize: number) => Promise<T[]>,
  initialPageSize: number = 10
): {
  items: T[]
  currentPage: number
  pageSize: number
  loading: boolean
  error: ApiError | null
  goToPage: (page: number) => Promise<void>
  nextPage: () => Promise<void>
  previousPage: () => Promise<void>
  setPageSize: (size: number) => Promise<void>
} {
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSizeState] = useState(initialPageSize)
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const isMountedRef = useRef(true)

  const fetch = useCallback(
    async (page: number, size: number) => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetchFn(page, size)

        if (isMountedRef.current) {
          setItems(response)
          setCurrentPage(page)
        }
      } catch (err) {
        const errorData = handleApiError(err)

        if (isMountedRef.current) {
          setError({
            message: errorData.message,
            code: errorData.code,
            details: errorData.details,
            status: 0,
            name: 'ApiError',
          } as unknown as ApiError)
        }
      } finally {
        setLoading(false)
      }
    },
    [fetchFn]
  )

  const goToPage = useCallback(
    async (page: number) => {
      await fetch(page, pageSize)
    },
    [fetch, pageSize]
  )

  const nextPage = useCallback(async () => {
    await goToPage(currentPage + 1)
  }, [goToPage, currentPage])

  const previousPage = useCallback(async () => {
    if (currentPage > 1) {
      await goToPage(currentPage - 1)
    }
  }, [goToPage, currentPage])

  const setPageSize = useCallback(
    async (size: number) => {
      setPageSizeState(size)
      await fetch(1, size)
    },
    [fetch]
  )

  useEffect(() => {
    isMountedRef.current = true
    fetch(1, pageSize)

    return () => {
      isMountedRef.current = false
    }
  }, [])

  return {
    items,
    currentPage,
    pageSize,
    loading,
    error,
    goToPage,
    nextPage,
    previousPage,
    setPageSize,
  }
}

/**
 * Hook for handling debounced search
 */
export function useDebounceSearch<T>(
  searchFn: (query: string) => Promise<T[]>,
  debounceMs: number = 300,
  minChars: number = 2
): {
  query: string
  results: T[]
  loading: boolean
  error: ApiError | null
  search: (q: string) => void
  reset: () => void
} {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<T[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback(
    (q: string) => {
      setQuery(q)

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }

      if (q.length < minChars) {
        setResults([])
        return
      }

      setLoading(true)

      debounceTimerRef.current = setTimeout(async () => {
        try {
          const response = await searchFn(q)
          setResults(response)
          setError(null)
        } catch (err) {
          const errorData = handleApiError(err)
          setError({
            message: errorData.message,
            code: errorData.code,
            details: errorData.details,
            status: 0,
            name: 'ApiError',
          } as unknown as ApiError)
        } finally {
          setLoading(false)
        }
      }, debounceMs)
    },
    [searchFn, debounceMs, minChars]
  )

  const reset = useCallback(() => {
    setQuery('')
    setResults([])
    setError(null)

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
  }, [])

  return { query, results, loading, error, search, reset }
}

/**
 * Hook for polling data
 */
export function usePolling<T>(
  fetchFn: () => Promise<T>,
  intervalMs: number = 5000,
  enabled: boolean = true
): UseAsyncState<T> & { refetch: () => Promise<void> } {
  const [state, setState] = useState<UseAsyncState<T>>({
    data: null,
    loading: true,
    error: null,
  })

  const isMountedRef = useRef(true)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fetchFnRef = useRef(fetchFn)

  useEffect(() => {
    fetchFnRef.current = fetchFn
  }, [fetchFn])

  const refetch = useCallback(async () => {
    try {
      const response = await fetchFnRef.current()

      if (isMountedRef.current) {
        setState({ data: response, loading: false, error: null })
      }
    } catch (error) {
      const errorData = handleApiError(error)

      if (isMountedRef.current) {
        setState({
          data: null,
          loading: false,
          error: {
            message: errorData.message,
            code: errorData.code,
            details: errorData.details,
          },
        })
      }
    }
  }, [fetchFn])

  useEffect(() => {
    if (!enabled) {
      return
    }

    // Initial fetch
    refetch()

    // Set up polling
    pollIntervalRef.current = setInterval(() => {
      refetch()
    }, intervalMs)

    return () => {
      isMountedRef.current = false

      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
  }, [enabled, intervalMs, refetch])

  return { ...state, refetch }
}
