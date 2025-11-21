export const median = (arr: bigint[]): bigint | undefined => {
  if (!arr.length) {
    return
  }
  const s = [...arr].sort((a, b) => (a > b ? 1 : a < b ? -1 : 0))
  const mid = Math.floor(s.length / 2)
  if (s.length % 2 === 0) {
    return (s[mid - 1] + s[mid]) / 2n
  }
  return s[mid]
}
