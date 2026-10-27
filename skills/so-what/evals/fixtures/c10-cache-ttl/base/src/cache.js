const store = new Map()
const TTL_MS = 60 * 1000

export function get(key, load) {
  const hit = store.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  const value = load(key)
  store.set(key, { value, at: Date.now() })
  return value
}
