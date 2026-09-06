export const ACCOUNT_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AccountThinkingLevel = typeof ACCOUNT_THINKING_LEVELS[number];
export interface AccountModelDefaults {
  revision: number;
  model: string | null;
  thinking_level: AccountThinkingLevel | null;
}
export interface OwnAccountModelDefaults {
  user_id: string;
  preferences: AccountModelDefaults;
  can_edit: boolean;
  models: { label: string; name: string; thinking_levels: AccountThinkingLevel[] }[];
  effective: { model: string | null; thinking_level: AccountThinkingLevel | null; source: 'account' | 'instance'; available: boolean };
}

export function validateAccountModelDefaults(model: unknown, thinking: unknown): Omit<AccountModelDefaults, 'revision'> {
  if (model !== null && (typeof model !== 'string' || model.length > 256 || !/^[^\s\p{Cc}\p{Cf}/]+\/[^\s\p{Cc}\p{Cf}]+$/u.test(model))) throw new Error('Invalid default model.');
  if (thinking !== null && (!(ACCOUNT_THINKING_LEVELS as readonly unknown[]).includes(thinking) || model === null)) throw new Error('Choose a model before choosing its thinking level.');
  return { model: model as string | null, thinking_level: thinking as AccountThinkingLevel | null };
}
