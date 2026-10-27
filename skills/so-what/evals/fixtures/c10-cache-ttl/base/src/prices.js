import { get } from "./cache.js"
import { db } from "./db.js"

export const price = (sku) => get(`price:${sku}`, () => db.prices.byId(sku))
