import { getSuiNSAddress } from './getSuiNSAddress.js'

export async function resolveSuiAddress(
  name: string
): Promise<string | undefined> {
  return await getSuiNSAddress(name)
}
