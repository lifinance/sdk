import { TronWeb } from 'tronweb'

/**
 * Get the balance of a Tron address
 * @param address - The Tron address to get balance for
 * @returns The balance in sun (smallest unit)
 */
export async function getTronBalance(address: string): Promise<number> {
  try {
    const tronWeb = new TronWeb({
      fullNode: 'https://api.trongrid.io',
    })

    // https://tronweb.network/docu/docs/API%20List/trx/getBalance/
    return await tronWeb.trx.getBalance(address)
  } catch (error) {
    console.error('Error getting Tron balance:', error)
    return 0
  }
}
