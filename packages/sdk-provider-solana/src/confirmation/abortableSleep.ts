/**
 * Sleeps for `ms`, or until `signal` aborts - whichever comes first.
 *
 * Not `@lifi/sdk`'s `sleep`: that one is publicly exported, so making its
 * timer abortable or unref'd would change behaviour for every caller in the
 * repo. The confirmation branches need the abort, because both detached loops
 * here sleep between iterations and a plain timer stays alive for the whole
 * interval after the branch has already returned - one live timer per RPC,
 * holding the Node event loop open past the end of a race.
 *
 * Never rejects on abort. The callers re-check `signal.aborted` and exit
 * through their own loop condition, so a rejection here would only add a
 * catch to every call site.
 */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve) => {
    const settle = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', settle)
      resolve()
    }

    const timer = setTimeout(settle, ms)
    signal.addEventListener('abort', settle, { once: true })
  })
}
