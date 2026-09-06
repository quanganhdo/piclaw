export const ACCOUNT_AVATAR_INPUT_BYTES = 2 * 1024 * 1024;
export const ACCOUNT_AVATAR_STORED_BYTES = 256 * 1024;
export const ACCOUNT_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export interface OwnAccountAvatar {
  user_id: string;
  revision: number;
  present: boolean;
  can_edit: boolean;
}
