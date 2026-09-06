export interface FamilyToolPolicy {
  revision: number;
  denied: readonly string[];
  allowed: readonly string[];
}
export interface AdminToolPolicy {
  user: { id: string; username: string };
  ceiling: readonly string[];
  policy: FamilyToolPolicy;
}
