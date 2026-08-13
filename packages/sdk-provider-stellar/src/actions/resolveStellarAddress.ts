import { Federation, StrKey } from '@stellar/stellar-sdk'

/**
 * Resolves a Stellar Federation address (SEP-2, `name*domain.com`) to a G-address.
 * Returns the input unchanged when it is already a valid G-address, and
 * `undefined` when it is neither a federation address nor safely resolvable.
 *
 * `Federation` is imported statically on purpose. Loading it through
 * `await import('@stellar/stellar-sdk')` was measured at +110 KB in the initial
 * chunk: a dynamic import of the root asks for the whole namespace, which
 * cannot be tree-shaken, so Horizon, WebAuth, Friendbot and StellarToml all
 * materialise — and the entry's own static import of the root keeps that chunk
 * eager anyway.
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
    // A memo is part of the destination for a custodial account, and neither
    // the SDK nor the route request can carry one. Resolving to the bare pooled
    // address would deliver funds nobody can attribute, so refuse instead.
    if (record.memo || record.memo_type) {
      return undefined
    }
    // The record comes from an arbitrary remote federation server. Re-apply the
    // G-address-only rule `isStellarAddress` exists to enforce.
    return StrKey.isValidEd25519PublicKey(record.account_id)
      ? record.account_id
      : undefined
  } catch {
    return undefined
  }
}
