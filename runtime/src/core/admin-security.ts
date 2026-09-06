import type { AccountSettings } from './account-settings.js';

/** Explicit admin-only security metadata. No conversation, home, secret or bearer data. */
export interface AdminSecurity {
  user: { id: string; username: string; display_name: string; enabled: boolean };
  factors: AccountSettings['factors'];
  sessions: Omit<AccountSettings['sessions'][number], 'current'>[];
}
export type AdminSecurityRevocation =
  | { kind: 'session' | 'passkey'; item_id: string; confirm_username: string }
  | { kind: 'totp'; confirm_username: string };
