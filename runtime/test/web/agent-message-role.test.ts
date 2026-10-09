import { expect, test } from "bun:test";
import "../helpers.js";
import { initDatabase, getDb, storeMessage, getMessageByRowId, replaceMessageContent } from "../../src/db.js";
import { promoteCompletedAgentReply } from "../../src/db/messages.js";
import { projectFamilySseEvent } from "../../src/channels/web/sse/family-event-projector.js";
import { buildAgentMessageRoleBlock, getAgentMessageRole } from "../../src/db/agent-message-role.js";
import { sanitizePublicInboundContentBlocks, sanitizeModelPostedContentBlocks, validateServiceEffectContentBlocks } from "../../src/channels/web/messaging/content-block-safety.js";

test("only positive terminal or explicit host role identifies assistant output", () => {
  expect(getAgentMessageRole(false, false, [])).toBeNull();
  expect(getAgentMessageRole(true, true, [])).toBe("final");
  expect(getAgentMessageRole(true, false, [])).toBe("unknown");
  expect(getAgentMessageRole(true, false, [{ type: "agent_turn_marker", kind: "intermediate", cause: "tool_use" }])).toBe("unknown");
  expect(getAgentMessageRole(true, false, [buildAgentMessageRoleBlock("final", false)])).toBe("final");
  expect(getAgentMessageRole(true, false, [buildAgentMessageRoleBlock("intermediate", false)])).toBe("intermediate");
  expect(getAgentMessageRole(true, false, [buildAgentMessageRoleBlock("unknown", false)])).toBe("unknown");
  expect(getAgentMessageRole(true, false, [buildAgentMessageRoleBlock("intermediate", true)])).toBe("unknown");
  expect(getAgentMessageRole(true, false, [{ type: "agent_message_role", role: "intermediate" }])).toBe("unknown");
  expect(getAgentMessageRole(true, false, [buildAgentMessageRoleBlock("intermediate", false), buildAgentMessageRoleBlock("final", false)])).toBe("unknown");
});

test("untrusted browser, model and service-effect blocks cannot forge output roles", () => {
  const blocks = [buildAgentMessageRoleBlock("intermediate", false), { type: "image", mime_type: "image/png" }];
  expect(sanitizePublicInboundContentBlocks(blocks)).toEqual([blocks[1]]);
  expect(sanitizeModelPostedContentBlocks(blocks)).toEqual([blocks[1]]);
  expect(validateServiceEffectContentBlocks(blocks)).toBeNull();
});

test("database interactions expose roles without backfilling or touching legacy rows", () => {
  initDatabase();
  const chat = "web:role-test";
  const put = (id: string, terminal: boolean, blocks?: unknown[], bot = true) => storeMessage({ id, chat_jid: chat, sender: "fixture", sender_name: "Fixture", content: "same text", timestamp: new Date().toISOString(), is_bot_message: bot, is_from_me: false, is_terminal_agent_reply: terminal, content_blocks: blocks });
  const legacy = put("role-legacy", false, [{type:"agent_turn_marker",kind:"intermediate",cause:"completed_boundary"}]);
  const final = put("role-final", true);
  const providerFinal = put("role-provider-final", false, [buildAgentMessageRoleBlock("final", false)]);
  const intermediate = put("role-intermediate", false, [buildAgentMessageRoleBlock("intermediate", false)]);
  const user = put("role-user", false, undefined, false);
  expect(getMessageByRowId(chat, legacy)?.data.agent_message_role).toBe("unknown");
  expect(getMessageByRowId(chat, final)?.data).toMatchObject({agent_message_role:"final",is_terminal_agent_reply:true});
  expect(getMessageByRowId(chat, providerFinal)?.data).toMatchObject({agent_message_role:"final",is_terminal_agent_reply:false});
  expect(getMessageByRowId(chat, intermediate)?.data.agent_message_role).toBe("intermediate");
  expect(getMessageByRowId(chat, user)?.data.agent_message_role).toBeUndefined();
  expect(getDb().query("SELECT is_terminal_agent_reply FROM messages WHERE rowid=?").get(legacy)).toEqual({is_terminal_agent_reply:0});
  const replaced = replaceMessageContent(chat, intermediate, "closing reply", { mediaIds: [], contentBlocks: [buildAgentMessageRoleBlock("final", true)], isTerminalAgentReply: true });
  expect(replaced?.data).toMatchObject({agent_message_role:"final",is_terminal_agent_reply:true});
});

test("conflicting versions and terminal metadata fail closed", () => {
  const intermediate = buildAgentMessageRoleBlock("intermediate", false);
  expect(getAgentMessageRole(true, false, [intermediate, {type:"agent_message_role",version:2,role:"final",terminal:false}])).toBe("unknown");
  expect(getAgentMessageRole(true, false, [intermediate, {type:"agent_message_role"}])).toBe("unknown");
  expect(getAgentMessageRole(true, false, [buildAgentMessageRoleBlock("final", true)])).toBe("unknown");
});


test('promotion requires exact live-boundary host evidence and matching chat',()=>{
  initDatabase();let index=0;const put=(blocks:any[])=>storeMessage({id:'promote-'+index++,chat_jid:'web:promote',sender:'agent',content:'unchanged',timestamp:new Date().toISOString(),is_from_me:false,is_bot_message:true,content_blocks:blocks});
  const marker={type:'agent_turn_marker',kind:'intermediate',cause:'completed_boundary'};
  const legacy=put([marker]);expect(promoteCompletedAgentReply('web:promote',legacy)).toBe(false);
  const live=put([marker,buildAgentMessageRoleBlock('unknown',false)]);
  expect(promoteCompletedAgentReply('web:wrong',live)).toBe(false);expect(promoteCompletedAgentReply('web:promote',live)).toBe(true);
  expect(getMessageByRowId('web:promote',live)?.data).toMatchObject({agent_message_role:'final',is_terminal_agent_reply:true});
  for(const blocks of [[marker,buildAgentMessageRoleBlock('intermediate',false)],[marker,buildAgentMessageRoleBlock('unknown',false),{type:'agent_message_role'}],[{...marker,followed_by_tool_use:true},buildAgentMessageRoleBlock('unknown',false)]]) {
    const row=put(blocks);expect(promoteCompletedAgentReply('web:promote',row)).toBe(false);
  }
});

test('family event projection retains server classification but not arbitrary blocks',()=>{
  const block=buildAgentMessageRoleBlock('final',false);
  const projected=projectFamilySseEvent('agent_response',{id:12,chat_jid:'web:family',data:{type:'agent_response',content:'answer',agent_message_role:'final',is_terminal_agent_reply:false,content_blocks:[block,{type:'private_runtime',secret:'hidden'}]}})as any;
  expect(projected.data).toMatchObject({agent_message_role:'final',is_terminal_agent_reply:false,content_blocks:[block]});
});
