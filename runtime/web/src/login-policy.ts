export interface LoginPolicy {
  mode: "single-user" | "family-shared";
  auth_enabled: boolean;
  totp: boolean;
  passkey: boolean;
  username_required: boolean;
}

/** Reject unknown/inconsistent policy instead of silently dropping the account requirement. */
export function parseLoginPolicy(value: unknown): LoginPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid login configuration.");
  const data = value as Record<string, unknown>;
  if ((data.mode !== "single-user" && data.mode !== "family-shared") || ["auth_enabled", "totp", "passkey", "username_required"].some(key => typeof data[key] !== "boolean")
    || data.username_required !== (data.mode === "family-shared" && data.totp)
    || (!data.auth_enabled && (data.mode !== "single-user" || data.totp || data.passkey))
    || (data.auth_enabled && !data.totp && !data.passkey)) throw new Error("Invalid login configuration.");
  return { mode: data.mode, auth_enabled: data.auth_enabled as boolean, totp: data.totp as boolean, passkey: data.passkey as boolean, username_required: data.username_required as boolean };
}

export function buildTotpLoginBody(policy: LoginPolicy, username: string, code: string): { code: string; username?: string } {
  if (!policy.auth_enabled || !policy.totp) throw new Error("Code login is unavailable.");
  const normalCode = code.trim();
  if (!/^\d{6}$/.test(normalCode)) throw new Error("Enter a six-digit code.");
  if (!policy.username_required) return { code: normalCode };
  const name = username.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) throw new Error("Enter your account username.");
  return { username: name, code: normalCode };
}
