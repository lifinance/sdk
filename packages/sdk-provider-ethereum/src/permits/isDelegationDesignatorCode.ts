/**
 * EIP-7702 introduces delegation designators that allow EOAs to delegate execution to other contracts.
 * A delegation designator starts with 0xef0100 followed by the target contract address.
 *
 * When an EOA has this code, it means:
 * - The EOA can still send transactions (unlike other contract accounts)
 * - All contract calls are delegated to the target address
 * - The code itself remains as the delegation designator (0xef0100 || address)
 *
 * Delegation Designator Structure:
 *
 * ─────┬───┬──┬───────────────────────────────────────┐
 *      │   │  │                                       │
 *  0x ef 0100 a94f5374fce5edbc8e2a8697c15331677e6ebf0b
 *      │   │  └───────────────────────────────────────┘
 *      │   │                         Target Address
 *      │   └── 7702
 *      └── 3541
 *
 * @see https://eips.ethereum.org/EIPS/eip-7702
 */
export const isDelegationDesignatorCode = (code?: string) =>
  code?.startsWith('0xef0100')
