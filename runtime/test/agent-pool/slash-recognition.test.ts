import { expect, test } from 'bun:test';
import { isSlashCommandInvocation } from '../../src/agent-control/agent-control-parser.js';

test("isSlashCommandInvocation only accepts command-shaped leading slash tokens", () => {
  expect(isSlashCommandInvocation("/skill:demo")).toBe(true);
  expect(isSlashCommandInvocation("/ext hello")).toBe(true);
  expect(isSlashCommandInvocation("Please run /skill:demo")).toBe(false);
  expect(isSlashCommandInvocation("/workspace/piclaw is the repo")).toBe(false);
  expect(isSlashCommandInvocation("/agent/keychain dispatch path")).toBe(false);
});
