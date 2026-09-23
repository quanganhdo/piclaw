import { expect, test } from "bun:test";
import "../../helpers.js";
import { getSearchResponse } from "../../../src/channels/web/timeline-service.js";
import * as db from "../../../src/db.js";
import { updateChatProject } from "../../../src/db/chat-project.js";

function makeMessage(chatJid: string, content: string, timestamp: string, isBot = false) {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    chat_jid: chatJid,
    sender: isBot ? "bot" : "user",
    sender_name: isBot ? "Bot" : "User",
    content,
    timestamp,
    is_from_me: false,
    is_bot_message: isBot,
  };
}

test("all-chat search annotates agent responses with the branch short agent name", () => {
  db.initDatabase();

  const chatJid = `web:timeline-search-agent-${Date.now()}`;
  const agentName = `agent-${Date.now()}`;
  db.storeChatMetadata(chatJid, new Date().toISOString(), "Agent");
  db.ensureChatBranch({
    chat_jid: chatJid,
    root_chat_jid: chatJid,
    agent_name: agentName,
  });

  db.storeMessage(makeMessage(chatJid, "needle agent", "2024-03-01T00:00:00.000Z", true));
  db.storeMessage(makeMessage(chatJid, "needle user", "2024-03-01T00:01:00.000Z", false));

  const result = getSearchResponse(chatJid, "needle", 10, 0, "all", null);
  expect(result.status).toBe(200);

  const body = result.body as {
    results: Array<{ data: { content: string; type: string }; chat_agent_name?: string }>;
  };
  expect(body.results).toHaveLength(2);
  expect(body.results[0]).toMatchObject({
    data: { content: "needle user", type: "user_message" },
  });
  expect(body.results[0]?.chat_agent_name).toBeUndefined();
  expect(body.results[1]).toMatchObject({
    data: { content: "needle agent", type: "agent_response" },
    chat_agent_name: agentName,
  });
});

test("all-chat search carries bounded per-row effective project metadata", () => {
  db.initDatabase();
  const root = `web:project-root-${Date.now()}`, child = `${root}:branch:child`;
  db.storeChatMetadata(root, new Date().toISOString(), "Root"); db.storeChatMetadata(child, new Date().toISOString(), "Child");
  const rootBranch = db.ensureChatBranch({ chat_jid: root, root_chat_jid: root, agent_name: `root-${Date.now()}` });
  db.ensureChatBranch({ chat_jid: child, root_chat_jid: root, parent_branch_id: rootBranch.branch_id, agent_name: `child-${Date.now()}` });
  updateChatProject(root, "set", "https://github.com/example/root");
  const token = `projecttoken${Date.now()}`;
  db.storeMessage(makeMessage(root, `${token} root`, "2024-03-01T00:00:00.000Z"));
  db.storeMessage(makeMessage(child, `${token} child`, "2024-03-01T00:01:00.000Z"));
  const response = getSearchResponse(child, token, 10, 0, "all", null).body as { results: Array<{ chat_jid?: string; project_repository?: { repository_url: string | null; source_branch_id: string | null; revision: string | null } }> };
  expect(response.results).toHaveLength(2);
  for (const row of response.results) {
    expect(row.project_repository?.repository_url).toBe("https://github.com/example/root");
    expect(row.project_repository?.source_branch_id).toBe(rootBranch.branch_id);
    expect(row.project_repository?.revision).toContain(rootBranch.branch_id);
  }
});

test("root-scoped search derives the root chat from the registry", () => {
  db.initDatabase();

  const rootChatJid = `web:timeline-search-root-${Date.now()}`;
  const branchChatJid = `${rootChatJid}:branch:1`;
  db.storeChatMetadata(rootChatJid, new Date().toISOString(), "Root");
  db.storeChatMetadata(branchChatJid, new Date().toISOString(), "Branch");

  const rootBranch = db.ensureChatBranch({
    chat_jid: rootChatJid,
    root_chat_jid: rootChatJid,
    agent_name: `root-${Date.now()}`,
  });
  db.ensureChatBranch({
    chat_jid: branchChatJid,
    root_chat_jid: rootChatJid,
    parent_branch_id: rootBranch.branch_id,
    agent_name: `branch-${Date.now()}`,
  });

  db.storeMessage(makeMessage(rootChatJid, "needle root", "2024-03-01T00:00:00.000Z"));
  db.storeMessage(makeMessage(branchChatJid, "needle branch", "2024-03-01T00:01:00.000Z"));

  const result = getSearchResponse(branchChatJid, "needle", 10, 0, "root", "web:wrong-root");
  expect(result.status).toBe(200);

  const body = result.body as {
    root_chat_jid: string | null;
    results: Array<{ data: { content: string } }>;
  };
  expect(body.root_chat_jid).toBe(rootChatJid);
  expect(body.results.map((row) => row.data.content)).toEqual(["needle branch", "needle root"]);
});
