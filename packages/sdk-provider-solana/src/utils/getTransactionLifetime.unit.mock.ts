import {
  address,
  getCompiledTransactionMessageEncoder,
  type ReadonlyUint8Array,
} from '@solana/kit'

/**
 * A real LI.FI Solana swap transaction (tool `titan`, captured 2026-08-18):
 * `version: 0`, 5 instructions, 5 address-table lookups, blockhash lifetime.
 * Kept verbatim so the decoder is exercised against production wire bytes and
 * not a hand-built approximation.
 */
export const SWAP_TRANSACTION_BASE64 =
  'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAQAJEk1XnKzkst0wmdWC9qgvkMGWu+3Y0DMimCKcrE04knGsHoxPq4mUSUyPHlwSh0RbKRfWDEPHmqlZFi9dYABZjTLqoiU+zuhH2r+O2QkGmLRb2zg/iRCeP2BchQ5mzDLeCEgF6OQgCkZDTi3Hshwq4lzAl/KXwhhn/QO9x8iGw/+CUPt74KkDEc+tTyCGjqCrCMDOe9e96HWjbs6jIqN3pPtfOhJkEs43Tl35Xf/+dGDtS+XGnURWtyBqdTHQNuR9llG4OH4L/YfT0m/4sRJvJ4j7T2i7QVMQbU/9nV2/WpLLhzjQmdWwWDZVYCMumLGSNXEwN4kqU3K8vPWRJUk50aIBehmlJ8vais1C/Bj3/FStXr3Vgwc6HkJgodT0+Z08dwMGRm/lIRcy/+ytunLDm+e8jOW7xfcSayxDmzpAAAAAKD0N0oI1T+8K47DiJ9N82JyiZvsX3fj3y3zO++Tr3FUGp9UXGMd0yShWY5hpHV62i164o5tLbVxzVVshAAAAABxefqB0dXdjwofzE6osi3mx5e7ffJ0T2oAerEtPgtzkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGqZxuEucOuzUYXBRMS5BuGP+wCkd0LypeBBELaYjJ1GAxRwQ0De3fNx/UJHIUjySOnRptGl6yrDrNi3/V1rJD4fj07qzCpvFX5A0jVkbSOtvUwDaKxE/+Gpap3FyYzPYK8cNDIYjKOmNR9DKdDZW7hv46w78UyZZJCs50eRAAAMSO14erYTQWuc7TTk0DeIl4KdjB0IylwTl14i/DiAnvBQkABQIQ6wkACQAJAzdgAQAAAAAACgILDAkABaZZaS4TxAANAgABDAIAAACQ0AMAAAAAAA5SAAAgAgMkJQ0mDg4OIQQiIycuKCkgMhohBBscHSQlKicuHh8FDxAzACAVDQQiFhckLiQoGBkxIC8SBCITFBMUFCQrMCAGKCkiIwcIJCQqKywtEUAqAHAQ8gUAAAAAG5tzAAAAAAAyAAQAAAAEAAAAFgAAAQDKmjsTEQEBAkM6aiQPHwEBAgDKmjsNOgECAwDKmjsOBdPjMZZG7DPzlmvai+fOLDXfjBNFxT1t1nt4ZYZ4kP2uAAoMDyMLYGdiZl9kdkl3sI4eaQq+PrnuWRbZA4LuqV5BCts19quCwWfNDOoDBwUDAwQAAdr21KbRJ76o3A9kc9DNUZTMuNxczBRvaAUMB9nSGmFzBWNgYlxeAWGRtYpMwkDVgZtMi+yXyHFxPdPJDqGi9zc0aTKAgCmchAYJDgEGAgwCBADeYfRk13yKc6hgSQ+yoqLJ50eZLqBcU68w8Qmn6mUdrwQDCAoJAA=='

export const SWAP_TRANSACTION_BLOCKHASH =
  'EEHEraBRtRjL62AaGnup3J8XWuo8LivAM5aMBio3fEgv'

const SYSTEM_PROGRAM_ADDRESS = address('11111111111111111111111111111111')
const NONCE_ACCOUNT_ADDRESS = address(
  'SysvarRecentB1ockHashes11111111111111111111'
)
const NONCE_AUTHORITY_ADDRESS = address(
  'SysvarRent111111111111111111111111111111111'
)

export const NONCE_VALUE = '7BpFqxP4VEXCVnT8HXMQ2KGeVxfmPz4dMwYSnFBHNzqL'

/**
 * Wire bytes for a compiled message whose first instruction is
 * `AdvanceNonceAccount` (System program, 4-byte little-endian discriminant 4,
 * exactly 3 account indices). That is the only signal that distinguishes a
 * durable-nonce lifetime from a blockhash lifetime in wire format.
 */
export function createNonceMessageBytes(): ReadonlyUint8Array {
  return getCompiledTransactionMessageEncoder().encode({
    version: 'legacy',
    header: {
      numSignerAccounts: 1,
      numReadonlySignerAccounts: 0,
      numReadonlyNonSignerAccounts: 3,
    },
    staticAccounts: [
      NONCE_AUTHORITY_ADDRESS,
      NONCE_ACCOUNT_ADDRESS,
      SYSTEM_PROGRAM_ADDRESS,
      address('SysvarRecentB1ockHashes11111111111111111111'),
    ],
    lifetimeToken: NONCE_VALUE,
    instructions: [
      {
        programAddressIndex: 2,
        accountIndices: [1, 3, 0],
        data: new Uint8Array([4, 0, 0, 0]),
      },
    ],
  })
}
