import { type SDKClient, withDedupe } from '@lifi/sdk'
import { Keypair, xdr } from '@stellar/stellar-sdk'
import { callStellarRpcsWithRetry } from '../client/getStellarRpc.js'

/**
 * Base reserve in stroops (0.5 XLM). A network-wide protocol parameter that has
 * been 0.5 XLM since 2015 and can only change through a validator-voted network
 * upgrade. It lives in the ledger header, which Stellar RPC does not expose, so
 * it is pinned here rather than read per call.
 */
export const BASE_RESERVE_STROOPS = 5_000_000n

/**
 * Base reserves every account owes before its subentries are counted: one for
 * the account entry itself plus one the protocol requires on top.
 */
const ACCOUNT_BASE_RESERVES = 2n

/**
 * One base reserve of headroom for the trustline a swap may open on the sender's
 * behalf. `LiFi::internal_swap` calls `try_trust(sender)` on the destination
 * token (CAP-73) before it swaps, so a route into an asset the sender does not
 * yet hold adds a subentry *inside the transaction being checked* — the floor at
 * execution time is one base reserve above the floor read here. The headroom is
 * unconditional: which token a route ends in is not known at this point, and
 * over-reserving 0.5 XLM only costs idle balance, whereas under-reserving fails
 * the transaction in simulation.
 */
const TRUSTLINE_HEADROOM = 1n

type Sponsorships = { numSponsoring: number; numSponsored: number }

const NO_SPONSORSHIPS: Sponsorships = { numSponsoring: 0, numSponsored: 0 }

/**
 * Reads the `AccountEntryExtensionV1` arm of the `AccountEntry.ext()` union, or
 * `undefined` when the account carries no extension (the common case). Guarding
 * on the discriminant is required — `.v1()` throws on a v0 account.
 */
const readExtensionV1 = (
  account: xdr.AccountEntry
): xdr.AccountEntryExtensionV1 | undefined => {
  const ext = account.ext()
  return ext.switch() === 1 ? ext.v1() : undefined
}

/**
 * Sponsorship counts off the v2 extension. A sponsored subentry is paid for by
 * the sponsor, so it raises the sponsor's reserve and lowers the sponsoree's.
 */
const readSponsorships = (account: xdr.AccountEntry): Sponsorships => {
  const v1 = readExtensionV1(account)
  if (!v1) {
    return NO_SPONSORSHIPS
  }
  const v1Ext = v1.ext()
  if (v1Ext.switch() !== 2) {
    return NO_SPONSORSHIPS
  }
  const v2 = v1Ext.v2()
  return {
    numSponsoring: v2.numSponsoring(),
    numSponsored: v2.numSponsored(),
  }
}

/**
 * Native selling liabilities — XLM already committed to open offers on the
 * classic order book, which the protocol locks on top of the reserve.
 */
const readSellingLiabilities = (account: xdr.AccountEntry): bigint => {
  const v1 = readExtensionV1(account)
  return v1 ? BigInt(v1.liabilities().selling().toString()) : 0n
}

/**
 * The XLM an account must keep and therefore cannot send:
 *
 * `(2 + numSubEntries + numSponsoring - numSponsored) x baseReserve + sellingLiabilities`
 *
 * plus {@link TRUSTLINE_HEADROOM}.
 *
 * A transfer that would leave the account below this floor is rejected by the
 * native Stellar Asset Contract with `Error(Contract, #10)` (`BalanceError`),
 * which surfaces as an opaque simulation `HostError` rather than a balance
 * error — hence checking it up front.
 */
const accountReserve = (account: xdr.AccountEntry): bigint => {
  const { numSponsoring, numSponsored } = readSponsorships(account)
  const reserves =
    ACCOUNT_BASE_RESERVES +
    BigInt(account.numSubEntries()) +
    TRUSTLINE_HEADROOM +
    BigInt(numSponsoring) -
    BigInt(numSponsored)
  const reserve =
    reserves * BASE_RESERVE_STROOPS + readSellingLiabilities(account)
  // A fully sponsored account can drive the subentry term negative.
  return reserve > 0n ? reserve : 0n
}

/**
 * Reads the native reserve a Stellar account cannot spend, in stroops, with
 * room for the trustline a swap may open (see {@link TRUSTLINE_HEADROOM}).
 *
 * Returns `0n` for an account with no ledger entry: an unfunded account holds
 * nothing to protect, and every other check (balance, sequence number) fails on
 * its own terms.
 */
export const getStellarAccountReserve = async (
  client: SDKClient,
  walletAddress: string
): Promise<bigint> =>
  withDedupe(
    () =>
      callStellarRpcsWithRetry(client, async (server) => {
        const ledgerKey = xdr.LedgerKey.account(
          new xdr.LedgerKeyAccount({
            accountId: Keypair.fromPublicKey(walletAddress).xdrAccountId(),
          })
        )
        const { entries } = await server.getLedgerEntries(ledgerKey)
        const entry = entries.at(0)
        return entry ? accountReserve(entry.val.account()) : 0n
      }),
    { id: `${getStellarAccountReserve.name}.${walletAddress}` }
  )
