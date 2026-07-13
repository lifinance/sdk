import { Federation, StrKey } from '@stellar/stellar-sdk'

/**
 * Resolves a Stellar Federation address (SEP-2, `name*domain.com`) to a G-address.
 * Returns the input unchanged when it is already a valid G-address, and
 * `undefined` when it is neither a federation address nor resolvable.
 */
export async function resolveStellarAddress(
  name: string
): Promise<string | undefined> {
  if (StrKey.isValidEd25519PublicKey(name)) {
    return name
  }
  if (!name.includes('*')) {
    return undefined
  }
  try {
    const record = await Federation.Server.resolve(name)
    return record.account_id
  } catch {
    return undefined
  }
}
