import { expect, test } from 'bun:test';
import '../helpers.js';
import { parseControlCommand } from '../../src/agent-control/index.js';

test("parseControlCommand parses model and thinking commands", () => {
  const modelCmd = parseControlCommand("@PiClaw /model openai/gpt-test", /(?:^|\s)@PiClaw\b/i);
  expect(modelCmd?.type).toBe("model");
  expect(modelCmd && "provider" in modelCmd ? modelCmd.provider : null).toBe("openai");
  expect(modelCmd && "modelId" in modelCmd ? modelCmd.modelId : null).toBe("gpt-test");

  const thinkingCmd = parseControlCommand("/thinking high");
  expect(thinkingCmd?.type).toBe("thinking");
  expect(thinkingCmd && "level" in thinkingCmd ? thinkingCmd.level : null).toBe("high");

  const restartCmd = parseControlCommand("/restart");
  expect(restartCmd?.type).toBe("restart");

  const exitCmd = parseControlCommand("/exit");
  expect(exitCmd?.type).toBe("exit");

  const shellCmd = parseControlCommand("/shell ls -la");
  expect(shellCmd?.type).toBe("shell");
  expect(shellCmd && "command" in shellCmd ? shellCmd.command : null).toBe("ls -la");

  const queueCmd = parseControlCommand("/queue do this next");
  expect(queueCmd?.type).toBe("queue");
  expect(queueCmd && "message" in queueCmd ? queueCmd.message : null).toBe("do this next");

  const queueAllCmd = parseControlCommand("/queue-all batch this");
  expect(queueAllCmd?.type).toBe("queue_all");
  expect(queueAllCmd && "message" in queueAllCmd ? queueAllCmd.message : null).toBe("batch this");

  const steerCmd = parseControlCommand("/steer zoom in");
  expect(steerCmd?.type).toBe("steer");
  expect(steerCmd && "message" in steerCmd ? steerCmd.message : null).toBe("zoom in");

  const stateCmd = parseControlCommand("/state");
  expect(stateCmd?.type).toBe("state");

  const quotaCmd = parseControlCommand("/quota");
  expect(quotaCmd?.type).toBe("quota");

  const autoCompactCmd = parseControlCommand("/auto-compact on");
  expect(autoCompactCmd?.type).toBe("auto_compact");
  expect(autoCompactCmd && "enabled" in autoCompactCmd ? autoCompactCmd.enabled : null).toBe(true);

  const bashCmd = parseControlCommand("/bash ls");
  expect(bashCmd?.type).toBe("bash");
  expect(bashCmd && "command" in bashCmd ? bashCmd.command : null).toBe("ls");

  const abortCmd = parseControlCommand("/abort");
  expect(abortCmd?.type).toBe("abort");

  const rollupCmd = parseControlCommand("/rollup");
  expect(rollupCmd?.type).toBe("rollup");

  const treeCmd = parseControlCommand("/tree abc123 --summarize --label checkpoint");
  expect(treeCmd?.type).toBe("tree");
  expect(treeCmd && "targetId" in treeCmd ? treeCmd.targetId : null).toBe("abc123");

  const labelCmd = parseControlCommand("/label abc123 milestone");
  expect(labelCmd?.type).toBe("label");
  expect(labelCmd && "label" in labelCmd ? labelCmd.label : null).toBe("milestone");

  const agentNameCmd = parseControlCommand("/agent-name Pi");
  expect(agentNameCmd?.type).toBe("agent_name");
  expect(agentNameCmd && "name" in agentNameCmd ? agentNameCmd.name : null).toBe("Pi");

  const agentAvatarCmd = parseControlCommand("/agent-avatar https://example.com/avatar.png");
  expect(agentAvatarCmd?.type).toBe("agent_avatar");
  expect(agentAvatarCmd && "avatar" in agentAvatarCmd ? agentAvatarCmd.avatar : null).toBe(
    "https://example.com/avatar.png"
  );

  const searchCmd = parseControlCommand("/search --scope notes \"token pricing\"");
  expect(searchCmd?.type).toBe("search_workspace");
  expect(searchCmd && "query" in searchCmd ? searchCmd.query : null).toBe("token pricing");
  expect(searchCmd && "scope" in searchCmd ? searchCmd.scope : null).toBe("notes");
});
