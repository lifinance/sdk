/** Older runtimes and polyfills can abort a signal without a `reason`. */
export const getAbortError = (signal: AbortSignal): unknown =>
  signal.reason ??
  Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })

export const isAbortError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  error.name === 'AbortError'
