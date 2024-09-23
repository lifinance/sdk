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

export function modifyFee(psbt: Psbt, newFee: bigint, accountAddress: string) {
  const newPsbt = new Psbt()
  const inputs = psbt.data.inputs
  const outputs = psbt.txOutputs

  // Add inputs to the new PSBT
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]
    const inputData: InputData = {
      hash: psbt.txInputs[i].hash,
      index: psbt.txInputs[i].index,
    }

    // Include UTXO information
    if (input.nonWitnessUtxo) {
      inputData.nonWitnessUtxo = input.nonWitnessUtxo
    } else if (input.witnessUtxo) {
      inputData.witnessUtxo = input.witnessUtxo
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

  const changeOutputScript = address.toOutputScript(accountAddress)

  // Add outputs to the new PSBT
  for (const output of outputs) {
    const outputData = {
      script: output.script,
      value: output.value,
    }

    const scriptsAreEqual =
      output.script.length === changeOutputScript.length &&
      output.script.every((value, index) => value === changeOutputScript[index])

    if (scriptsAreEqual) {
      outputData.value = output.value - newFee
      if (outputData.value < 0) {
        throw new Error(
          'Insufficient funds to adjust the fee by the specified amount.'
        )
      }
    }

    newPsbt.addOutput(outputData)
  }

  // Modify the input sequence number to enable RBF
  newPsbt.txInputs.forEach((_, index) => {
    // Set sequence number to less than 0xfffffffe, e.g., 0xfffffffd
    newPsbt.setInputSequence(index, 0xfffffffd)
  })

  return newPsbt
}
