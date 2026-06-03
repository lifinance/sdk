export async function resolveTronAddress(name: string): Promise<string> {
  // Tron does not have a name service, return the address as-is
  return name
}
