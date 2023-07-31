export const AddressZero = '0x0000000000000000000000000000000000000000'
export const AlternativeAddressZero =
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
export const MaxUint256: bigint = BigInt(
  '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
)
/**
 * Cronos require bigger multicall chunks than default 1024 (1 KB)
 */
export const MulticallBatchSize = 8192 // 8 Kilobytes (KB)
