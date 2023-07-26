import type { ConfigUpdate, LifiStep, StatusResponse } from '@lifi/sdk'
import { LiFi } from '@lifi/sdk'
import { config } from 'dotenv'
import type { Signer } from 'ethers'
import { BigNumber, ethers } from 'ethers'
import * as readline from 'readline'

config({
  path: '../.env',
})

let lifi: LiFi
export const getLifi = (config?: ConfigUpdate) => {
  if (!lifi) {
    lifi = new LiFi(
      config ?? {
        integrator: 'lifi-sdk-node-example',
      }
    )
  }
  return lifi
}

export const getSigner = async (chainId: number) => {
  const privateKey = process.env.PRIVATE_KEY
  const mnemonic = process.env.MNEMONIC

  if (!privateKey && !mnemonic) {
    throw new Error(
      'Please specify a MNEMONIC or PRIVATE_KEY in your environment variables: `export MNEMONIC="..."`'
    )
  }

  const provider = await getLifi({
    integrator: 'lifi-sdk-node-example',
  }).getRpcProvider(chainId)
  const wallet = mnemonic
    ? ethers.Wallet.fromMnemonic(mnemonic)
    : new ethers.Wallet(privateKey!)

  return wallet.connect(provider)
}

export const executeTransaction = async (
  wallet: ethers.Signer,
  transaction: ethers.providers.TransactionRequest
) => {
  console.log(transaction)
  const tx = await wallet.sendTransaction(transaction)
  console.log(tx)
  const receipt = await tx.wait()
  console.log(receipt)
  return receipt
}

export const executeCrossChainQuote = async (
  signer: Signer,
  quote: LifiStep
) => {
  // Approval
  if (quote.action.fromToken.address !== ethers.constants.AddressZero) {
    // check approval
    const approval = await lifi.getTokenApproval(
      signer,
      quote.action.fromToken,
      quote.estimate.approvalAddress
    )
    if (!approval) {
      throw 'Failed to load approval'
    }

    // set approval
    if (BigNumber.from(approval).lt(quote.action.fromAmount)) {
      await lifi.approveToken({
        signer,
        token: quote.action.fromToken,
        amount: quote.action.fromAmount,
        approvalAddress: quote.estimate.approvalAddress,
      })
    }
  }

  // execute transaction
  const receipt = await executeTransaction(signer, quote.transactionRequest!)

  // wait for execution
  let result: StatusResponse
  do {
    await new Promise((res) => {
      setTimeout(() => {
        res(null)
      }, 5000)
    })
    result = await lifi.getStatus({
      txHash: receipt.transactionHash,
      bridge: quote.tool,
      fromChain: quote.action.fromChainId,
      toChain: quote.action.toChainId,
    })
    console.log('Status update', result)
  } while (result.status !== 'DONE' && result.status !== 'FAILED')

  console.log('DONE', result)
}

export const promptConfirm = async (msg: string) => {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    rl.question(msg + ' (Y/n)', function (a) {
      const input = a.trim().toLowerCase()
      const confirmed = input === '' || input === 'y'
      resolve(confirmed)
      rl.close()
    })
  })
}

export const promptAsk = async (
  msg: string,
  defaultAnswer: string
): Promise<string> => {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    rl.question(msg, function (answer) {
      if (!answer || answer === '') {
        resolve(defaultAnswer)
      } else {
        resolve(answer)
      }
      rl.close()
    })
  })
}

export const promptAskNumber = async (
  msg: string,
  defaultAnswer: number
): Promise<number> => {
  return parseInt(await promptAsk(msg, defaultAnswer.toString()))
}
