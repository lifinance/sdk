export const decodeTaskId = (taskId: string) => {
  const decoded = new TextDecoder()
    .decode(
      new Uint8Array(
        taskId
          .slice(2)
          .match(/.{1,2}/g)
          ?.map((byte) => Number.parseInt(byte, 16)) ?? []
      )
    )
    .split('|')
  return decoded
}
