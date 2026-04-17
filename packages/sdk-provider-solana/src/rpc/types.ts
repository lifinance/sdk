import type { createSolanaRpc, Rpc } from '@solana/kit'
import type { JitoRpcApi } from './jito/createJitoRpc.js'

export type SolanaRpcType = ReturnType<typeof createSolanaRpc>
export type JitoRpcType = Rpc<JitoRpcApi>
