export interface SDKStorage {
  get(key: string): string | null | Promise<string | null>
  set(key: string, value: string): void | Promise<void>
  remove(key: string): void | Promise<void>
}

export class LocalStorageAdapter implements SDKStorage {
  get(key: string): string | null {
    return window.localStorage.getItem(key)
  }

  set(key: string, value: string): void {
    window.localStorage.setItem(key, value)
  }

  remove(key: string): void {
    window.localStorage.removeItem(key)
  }
}

export class InMemoryStorage implements SDKStorage {
  private store = new Map<string, string>()

  get(key: string): string | null {
    return this.store.get(key) ?? null
  }

  set(key: string, value: string): void {
    this.store.set(key, value)
  }

  remove(key: string): void {
    this.store.delete(key)
  }
}

export function createDefaultStorage(): SDKStorage {
  if (typeof window !== 'undefined' && window.localStorage) {
    return new LocalStorageAdapter()
  }
  return new InMemoryStorage()
}
