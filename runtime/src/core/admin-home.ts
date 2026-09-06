/** Administrative landing metadata, without transcripts, child trees or runtime paths. */
export interface AdminHome {
  user: { id: string; username: string; enabled: boolean };
  roots: { branch_id: string; agent_name: string; current: boolean }[];
}
