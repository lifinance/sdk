export function sleep(ms: number, signal?: AbortSignal): Promise<null> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason)
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal!.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(null)
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
