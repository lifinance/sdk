export async function isJitoRpc(rpcUrl: string): Promise<boolean> {
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTipAccounts',
        params: [],
      }),
    })

    const data = await response.json()

    // If we get a result (not a "method not found" error), it supports Jito
    return !!data.result && !data.error
  } catch {
    return false
  }
}
