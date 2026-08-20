import type { SDKClient } from '@lifi/sdk'
import { Keypair, StrKey, xdr } from '@stellar/stellar-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getLedgerEntries = vi.fn()

vi.mock('../client/getStellarRpc.js', () => ({
  callStellarRpcsWithRetry: (
    _client: SDKClient,
    fn: (server: {
      getLedgerEntries: typeof getLedgerEntries
    }) => Promise<unknown>
  ) => fn({ getLedgerEntries }),
}))

import {
  BASE_RESERVE_STROOPS,
  getStellarAccountReserve,
} from './getStellarAccountReserve.js'

const ACCOUNT = Keypair.random().publicKey()
const client = {} as SDKClient

type EntryOptions = {
  numSubEntries?: number
  sponsorships?: { numSponsoring: number; numSponsored: number }
  sellingLiabilities?: string
}

/**
 * Builds a real `AccountEntry`. Without sponsorships or liabilities the entry
 * carries the v0 (no-ext) discriminant — the common case, which exercises the
 * zero defaults; otherwise the V1 → V2 ext chain is populated.
 */
const accountEntry = (options: EntryOptions = {}): xdr.LedgerEntryData => {
  const needsExt =
    options.sponsorships !== undefined ||
    options.sellingLiabilities !== undefined
  const ext = needsExt
    ? new xdr.AccountEntryExt(
        1,
        new xdr.AccountEntryExtensionV1({
          liabilities: new xdr.Liabilities({
            buying: xdr.Int64.fromString('0'),
            selling: xdr.Int64.fromString(options.sellingLiabilities ?? '0'),
          }),
          ext: new xdr.AccountEntryExtensionV1Ext(
            2,
            new xdr.AccountEntryExtensionV2({
              numSponsored: options.sponsorships?.numSponsored ?? 0,
              numSponsoring: options.sponsorships?.numSponsoring ?? 0,
              signerSponsoringIDs: [],
              ext: new xdr.AccountEntryExtensionV2Ext(0),
            })
          ),
        })
      )
    : new xdr.AccountEntryExt(0)
  return xdr.LedgerEntryData.account(
    new xdr.AccountEntry({
      accountId: Keypair.fromPublicKey(ACCOUNT).xdrAccountId(),
      balance: xdr.Int64.fromString('120121714'),
      seqNum: xdr.Int64.fromString('1'),
      numSubEntries: options.numSubEntries ?? 0,
      inflationDest: null,
      flags: 0,
      homeDomain: '',
      thresholds: Buffer.from([1, 0, 0, 0]),
      signers: [],
      ext,
    })
  )
}

const mockEntry = (options?: EntryOptions): void => {
  getLedgerEntries.mockResolvedValue({
    latestLedger: 100,
    entries: [{ key: 'ACC_KEY', val: accountEntry(options) }],
  })
}

beforeEach(() => {
  getLedgerEntries.mockReset()
})

describe('getStellarAccountReserve', () => {
  it('reads the account entry of the given wallet', async () => {
    mockEntry()
    await getStellarAccountReserve(client, ACCOUNT)
    const key: xdr.LedgerKey = getLedgerEntries.mock.calls[0][0]
    expect(
      StrKey.encodeEd25519PublicKey(key.account().accountId().ed25519())
    ).toBe(ACCOUNT)
  })

  it('charges two base reserves plus trustline headroom for a bare account', async () => {
    // The reported account: no subentries, so it must keep 1 XLM at rest — and
    // 1.5 XLM through a swap, which is the floor its simulation reported.
    mockEntry({ numSubEntries: 0 })
    expect(await getStellarAccountReserve(client, ACCOUNT)).toBe(
      3n * BASE_RESERVE_STROOPS
    )
  })

  it('charges one base reserve per subentry', async () => {
    mockEntry({ numSubEntries: 1 })
    expect(await getStellarAccountReserve(client, ACCOUNT)).toBe(20_000_000n)
  })

  it('adds sponsored-away subentries to the sponsor and removes them from the sponsoree', async () => {
    mockEntry({
      numSubEntries: 1,
      sponsorships: { numSponsoring: 2, numSponsored: 1 },
    })
    // 2 + 1 subentry + 1 headroom + 2 sponsoring - 1 sponsored = 5 base reserves
    expect(await getStellarAccountReserve(client, ACCOUNT)).toBe(25_000_000n)
  })

  it('locks native selling liabilities on top of the reserve', async () => {
    mockEntry({ numSubEntries: 1, sellingLiabilities: '5000000' })
    expect(await getStellarAccountReserve(client, ACCOUNT)).toBe(25_000_000n)
  })

  it('never returns a negative reserve for a fully sponsored account', async () => {
    mockEntry({
      numSubEntries: 0,
      sponsorships: { numSponsoring: 0, numSponsored: 5 },
    })
    expect(await getStellarAccountReserve(client, ACCOUNT)).toBe(0n)
  })

  it('returns zero when the account has no ledger entry', async () => {
    getLedgerEntries.mockResolvedValue({ latestLedger: 100, entries: [] })
    expect(await getStellarAccountReserve(client, ACCOUNT)).toBe(0n)
  })

  it('propagates a failed read so callers can retry it', async () => {
    getLedgerEntries.mockRejectedValue(new Error('rpc down'))
    await expect(getStellarAccountReserve(client, ACCOUNT)).rejects.toThrow(
      'rpc down'
    )
  })
})
