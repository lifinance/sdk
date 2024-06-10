import readline from 'readline'

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
