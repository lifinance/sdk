import { sha256 } from '@noble/hashes/sha256'
import { bech32, bech32m } from 'bech32'
import bs58 from 'bs58'

export enum UTXONetwork {
  Mainnet = 'mainnet',
  Testnet = 'testnet',
  Regtest = 'regtest',
}

export enum UTXOAddressType {
  p2pkh = 'p2pkh',
  p2sh = 'p2sh',
  p2wpkh = 'p2wpkh',
  p2wsh = 'p2wsh',
  p2tr = 'p2tr',
}

export type UTXOAddress = {
  bech32: boolean
  network: UTXONetwork
  address: string
  type: UTXOAddressType
}

const addressTypes: {
  [key: number]: { type: UTXOAddressType; network: UTXONetwork }
} = {
  0x00: {
    type: UTXOAddressType.p2pkh,
    network: UTXONetwork.Mainnet,
  },
  0x6f: {
    type: UTXOAddressType.p2pkh,
    network: UTXONetwork.Testnet,
  },
  0x05: {
    type: UTXOAddressType.p2sh,
    network: UTXONetwork.Mainnet,
  },
  0xc4: {
    type: UTXOAddressType.p2sh,
    network: UTXONetwork.Testnet,
  },
}

const parseBech32 = (address: string): UTXOAddress => {
  let decoded

  try {
    if (
      address.startsWith('bc1p') ||
      address.startsWith('tb1p') ||
      address.startsWith('bcrt1p')
    ) {
      decoded = bech32m.decode(address)
    } else {
      decoded = bech32.decode(address)
    }
  } catch (error) {
    throw new Error('Invalid address')
  }

  const mapPrefixToNetwork: { [key: string]: UTXONetwork } = {
    bc: UTXONetwork.Mainnet,
    tb: UTXONetwork.Testnet,
    bcrt: UTXONetwork.Regtest,
  }

  const network: UTXONetwork = mapPrefixToNetwork[decoded.prefix]

  if (network === undefined) {
    throw new Error('Invalid address')
  }

  const witnessVersion = decoded.words[0]

  if (witnessVersion < 0 || witnessVersion > 16) {
    throw new Error('Invalid address')
  }
  const data = bech32.fromWords(decoded.words.slice(1))

  let type

  if (data.length === 20) {
    type = UTXOAddressType.p2wpkh
  } else if (witnessVersion === 1) {
    type = UTXOAddressType.p2tr
  } else {
    type = UTXOAddressType.p2wsh
  }

  return {
    bech32: true,
    network,
    address,
    type,
  }
}

export const getUTXOAddress = (address: string): UTXOAddress => {
  let decoded: Uint8Array
  const prefix = address.substring(0, 2).toLowerCase()

  if (prefix === 'bc' || prefix === 'tb') {
    return parseBech32(address)
  }

  try {
    decoded = bs58.decode(address)
  } catch (error) {
    throw new Error('Invalid address')
  }

  const { length } = decoded

  if (length !== 25) {
    throw new Error('Invalid address')
  }

  const version = decoded[0]

  const checksum = decoded.slice(length - 4, length)
  const body = decoded.slice(0, length - 4)

  const expectedChecksum = sha256(sha256(body)).slice(0, 4)

  if (
    checksum.some(
      (value: number, index: number) => value !== expectedChecksum[index]
    )
  ) {
    throw new Error('Invalid address')
  }

  const validVersions = Object.keys(addressTypes).map(Number)

  if (!validVersions.includes(version)) {
    throw new Error('Invalid address')
  }

  const addressType = addressTypes[version]

  return {
    ...addressType,
    address,
    bech32: false,
  }
}

export const isUTXOAddress = (
  address: string,
  network?: UTXONetwork
): boolean => {
  try {
    const utxoAddress = getUTXOAddress(address)

    if (network) {
      return network === utxoAddress.network
    }

    return true
  } catch (error) {
    return false
  }
}
