export const getRootCause = (e: Error | undefined) => {
  let rootCause = e
  while (rootCause?.cause) {
    rootCause = rootCause.cause as Error
  }
  return rootCause
}
