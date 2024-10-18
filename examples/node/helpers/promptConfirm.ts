import { createInterface } from 'node:readline'

export const promptConfirm = async (msg: string) => {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    rl.question(`${msg} (Y/n)`, (a: any) => {
      const input = a.trim().toLowerCase()
      const confirmed = input === '' || input === 'y'
      resolve(confirmed)
      rl.close()
    })
  })
}
