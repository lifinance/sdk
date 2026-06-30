type QueryPrimitive = string | number | boolean | bigint

const isPrimitive = (value: unknown): value is QueryPrimitive =>
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean' ||
  typeof value === 'bigint'

// Arrays of objects use qs indices notation (`key[0][subKey]=value`) to match
// the backend's `qs.parse(str, { comma: true })`; only values are encoded.
const serialize = (key: string, value: unknown): string[] => {
  if (value === undefined || value === null) {
    return []
  }
  if (isPrimitive(value)) {
    return [`${key}=${encodeURIComponent(String(value))}`]
  }
  if (Array.isArray(value)) {
    // Scalar arrays stay comma-joined (backend splits on `comma: true`).
    if (value.every(isPrimitive)) {
      return [`${key}=${encodeURIComponent(value.join(','))}`]
    }
    return value.flatMap((item, index) => serialize(`${key}[${index}]`, item))
  }
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([subKey, subValue]) => serialize(`${key}[${subKey}]`, subValue)
  )
}

// Encode params into a query string (no leading `?`). Drop-in for
// `URLSearchParams` that handles nested array/object params; skips null/undefined.
export const toQueryString = (params: Record<string, unknown>): string =>
  Object.entries(params)
    .flatMap(([key, value]) => serialize(key, value))
    .join('&')
