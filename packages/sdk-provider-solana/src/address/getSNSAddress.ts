import { isSolanaAddress } from './isSolanaAddress.js'

interface SNSResult {
  s: 'ok' | 'error'
  result: string
}

// Subject to change
// https://github.com/Bonfida/sns-sdk?tab=readme-ov-file#sdk-proxy
export const getSNSAddress = async (name: string) => {
  try {
    if (!name.endsWith('.sol')) {
      return
    }
    const snsWorkerUrl = `https://sns-sdk-proxy.bonfida.workers.dev/resolve/${name}`
    const response: Response = await fetch(snsWorkerUrl)
    if (!response.ok) {
      return
    }

    const data: SNSResult = await response.json()

    if (!isSolanaAddress(data.result)) {
      return
    }

    return data.result
  } catch (_) {
    // ignore
    return
  }
}
