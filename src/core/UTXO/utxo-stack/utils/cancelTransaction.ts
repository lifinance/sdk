import { address, Psbt } from 'bitcoinjs-lib'

interface InputData {
  hash: Uint8Array
  index: number
  nonWitnessUtxo?: Uint8Array
  witnessUtxo?: {
    script: Uint8Array
    value: bigint
  }
  redeemScript?: Uint8Array
  witnessScript?: Uint8Array
}

export function cancelTransaction(psbt: Psbt, accountAddress: string): Psbt {
  const newPsbt = new Psbt()
  const inputs = psbt.data.inputs
  const txInputs = psbt.txInputs

  // Add inputs to the new PSBT
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]
    const txInput = txInputs[i]
    const inputData: InputData = {
      hash: txInput.hash,
      index: txInput.index,
    }

    // Include UTXO information
    if (input.nonWitnessUtxo) {
      inputData.nonWitnessUtxo = input.nonWitnessUtxo
    } else if (input.witnessUtxo) {
      inputData.witnessUtxo = input.witnessUtxo
    } else {
      throw new Error('Input UTXO information is missing')
    }

    // Include scripts if necessary
    if (input.redeemScript) {
      inputData.redeemScript = input.redeemScript
    }
    if (input.witnessScript) {
      inputData.witnessScript = input.witnessScript
    }

    newPsbt.addInput(inputData)
  }

  // Compute total output amount from the original transaction
  const outputs = psbt.txOutputs
  let totalOutputValue = BigInt(0)

  for (const output of outputs) {
    totalOutputValue += output.value
  }

  if (totalOutputValue <= BigInt(0)) {
    throw new Error('Total output value must be greater than zero')
  }

  // Create the output to send funds back to sender's address
  const outputScript = address.toOutputScript(accountAddress)
  newPsbt.addOutput({
    script: outputScript,
    value: totalOutputValue,
  })

  // Modify the input sequence number to enable RBF
  newPsbt.txInputs.forEach((_, index) => {
    // Set sequence number to less than 0xfffffffe, e.g., 0xfffffffd
    newPsbt.setInputSequence(index, 0xfffffffd)
  })

  return newPsbt
}
