import { SuiClient } from '@mysten/sui/client'

const SNS_REGISTRY_ID =
  '0x6e0ddefc0ad3ed64f53f5f91b7023077b2f7c131d7e6d5e0d1a0e4e6f1a2c3b4'

export async function getSuiNSAddress(
  name: string,
  rpcUrl?: string
): Promise<string | undefined> {
  const client = new SuiClient({
    url: rpcUrl || 'https://fullnode.mainnet.sui.io:443',
  })

  try {
    const result = await client.getObject({
      id: SNS_REGISTRY_ID,
      options: {
        showContent: true,
      },
    })

    if (!result.data?.content) {
      return
    }

    const registry = result.data.content as any
    const nameRecord = registry.fields.records.find(
      (record: any) => record.fields.name === name
    )

    if (!nameRecord) {
      return
    }

    return nameRecord.fields.address
  } catch (error) {
    console.error('Error resolving SuiNS address:', error)
    return
  }
}
