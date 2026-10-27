import flags from "../config/flags.json" with { type: "json" }
import { legacyCheckout, newCheckout } from "./flows.js"

export const checkout = (cart) => (flags.new_checkout ? newCheckout(cart) : legacyCheckout(cart))
