import { db } from "./db.js"

export async function listOrders(req, res) {
  const limit = Number(req.query.limit ?? 50)
  const rows = await db.orders.find({ limit })
  res.json(rows.map((o) => ({ id: o.id, total: o.total, legacy_status: o.status })))
}
