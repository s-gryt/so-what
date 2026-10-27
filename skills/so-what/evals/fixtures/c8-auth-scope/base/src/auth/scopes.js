export const ROLE_SCOPES = {
  admin: ["reports:read", "reports:export", "users:write"],
  analyst: ["reports:read", "reports:export"],
  viewer: ["reports:read"],
}

export const can = (role, scope) => (ROLE_SCOPES[role] ?? []).includes(scope)
