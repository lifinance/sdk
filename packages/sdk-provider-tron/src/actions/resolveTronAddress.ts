export async function resolveTronAddress(
  _name: string
): Promise<string | undefined> {
  // Tron does not have a widely-adopted name service
  return undefined
}
