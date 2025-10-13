import type { StaticToken } from '@lifi/types'

export const isToken = (token: StaticToken): token is StaticToken => {
  const { address, decimals, chainId } = token

  return (
    typeof address === 'string' &&
    typeof decimals === 'number' &&
    typeof chainId === 'number'
  )
}
