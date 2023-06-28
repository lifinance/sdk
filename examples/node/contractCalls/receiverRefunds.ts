import { ethers } from 'ethers'
import { executeTransaction, getSigner } from '../helpers'

type Refund = {
  srcLink: string
  destLink: string
  receiver: string
  amount: string
  token: string
  chain: string
  transactionId: string
  refundTxHash?: string
  refundLink?: string
}

// const withdraws = [
//   {
//     amount: "",
//     token: "",
//     chain: ChainId.ARB,
//     receiver: ""
//   },
// ]

const refunds: Refund[] = [
  // {
  //   srcLink: '',
  //   destLink: '',
  //   receiver: '',
  //   amount: '',
  //   token: '',
  //   chain: '',
  //   transactionId: '',
  //   refundTxHash: '',
  //   refundLink: ''
  // },
]

const run = async () => {
  console.log('Refund stuck funds in receiver')

  for (const refund of refunds) {
    try {
      // build tx
      const CONTRACT_ADDRESS = '0x74674DAFd6f4495e7F63F7637E94b8B89B2f01dB'
      const ABI = [
        'function pullToken(address assetId, address receiver, uint256 amount)',
      ]
      const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI)
      const refundTx = await contract.populateTransaction.pullToken(
        refund.token,
        refund.receiver,
        refund.amount
      )
      console.log(refundTx)

      // execute tx
      const signer = await getSigner(parseInt(refund.chain))
      const receipt = await executeTransaction(signer, refundTx)
      console.log(receipt)

      // save result
      refund.refundTxHash = receipt.transactionHash
    } catch (e) {
      console.error(e)
    }
  }

  console.log(refunds)
}

run()
