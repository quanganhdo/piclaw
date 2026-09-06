/** Owned tree metadata, separate from signed-in browser devices. No message content. */
export interface SessionSettings {
  home_chat_jid: string | null;
  capabilities: { create_root: boolean };
  branches: {
    branch_id: string; chat_jid: string; root_chat_jid: string; parent_branch_id: string | null;
    agent_name: string; archived_at: string | null;
    capabilities: { open: boolean; fork: boolean; rename: boolean; archive: boolean; restore: boolean; set_home: boolean; download_transcript?: boolean };
  }[];
}
