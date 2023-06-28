import { executeTransaction, getSigner } from '../helpers'

const run = async () => {
  console.log('Speed up stuck transaction')

  const customTx = {
    chainId: 1,
    data: '',
    to: '',
    nonce: 1,
    gasPrice: 1_000_000_000,
  }
  console.log(customTx)

  // execute tx
  const signer = await getSigner(customTx.chainId)
  const receipt = await executeTransaction(signer, customTx)
  console.log(receipt)
}

run()
