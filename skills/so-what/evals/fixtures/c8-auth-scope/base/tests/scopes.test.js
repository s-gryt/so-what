import assert from "node:assert"
import { can } from "../src/auth/scopes.js"

assert.equal(can("viewer", "reports:read"), true)
assert.equal(can("viewer", "reports:export"), false)
assert.equal(can("analyst", "reports:export"), true)
