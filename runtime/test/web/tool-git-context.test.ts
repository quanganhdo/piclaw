import { expect, test } from 'bun:test';

import {
  extractHostLabelFromUrl,
  extractShellCwdFromCommand,
  extractToolContextPath,
  extractToolPortainerHost,
  extractToolProxmoxHost,
  extractToolSshTarget,
  stripRemotePathFromSshTarget,
} from '../../web/src/ui/tool-git-context.js';

test('extractShellCwdFromCommand parses leading cd prefixes', () => {
  expect(extractShellCwdFromCommand('cd /workspace/piclaw && bun test')).toBe('/workspace/piclaw');
  expect(extractShellCwdFromCommand("cd 'projects/demo app' && make test")).toBe('projects/demo app');
  expect(extractShellCwdFromCommand('echo hi')).toBeNull();
});

test('extractToolContextPath prefers cwd and explicit repo context fields', () => {
  expect(extractToolContextPath('bash', { cwd: 'piclaw', command: 'echo hi' })).toBe('piclaw');
  expect(extractToolContextPath('write', { project_dir: 'projects/demo' })).toBe('projects/demo');
  expect(extractToolContextPath('autoresearch', { repo_path: 'projects/demo' })).toBe('projects/demo');
});

test('extractToolContextPath ignores generic file paths for non-execution tools', () => {
  expect(extractToolContextPath('read', { path: 'notes/index.md' })).toBeNull();
  expect(extractToolContextPath('write', { filePath: 'notes/index.md' })).toBeNull();
  expect(extractToolContextPath('search', { paths: ['a/b.md', 'c/d.md'] })).toBeNull();
});

test('extractToolContextPath falls back to command prefixes', () => {
  expect(extractToolContextPath('bash', { command: 'cd /workspace/piclaw && bun run typecheck' })).toBe('/workspace/piclaw');
  expect(extractToolContextPath('exec_batch', { commands: ['cd repo && git status', 'pwd'] })).toBe('repo');
  expect(extractToolContextPath('bash', null)).toBeNull();
});

test('stripRemotePathFromSshTarget keeps user@host and removes remote paths', () => {
  expect(stripRemotePathFromSshTarget('agent@example.com:/srv/project')).toBe('agent@example.com');
  expect(stripRemotePathFromSshTarget('agent@example.com:~/repo')).toBe('agent@example.com');
  expect(stripRemotePathFromSshTarget('agent@example.com')).toBe('agent@example.com');
});

test('extractToolSshTarget reads ssh wrapper targets', () => {
  expect(extractToolSshTarget('ssh', { ssh_target: 'agent@example.com:/srv/project' })).toBe('agent@example.com');
  expect(extractToolSshTarget('bash', { ssh_target: 'agent@example.com:/srv/project' })).toBe('agent@example.com');
  expect(extractToolSshTarget('ssh', { action: 'get' })).toBeNull();
});

test('stripRemotePathFromSshTarget also handles top-level status payload values', () => {
  expect(stripRemotePathFromSshTarget('agent@example.com:/srv/project')).toBe('agent@example.com');
});

test('extractHostLabelFromUrl keeps hostname and port', () => {
  expect(extractHostLabelFromUrl('https://pve.example.com:8006/api2/json')).toBe('pve.example.com:8006');
  expect(extractHostLabelFromUrl('https://portainer.example.com/api')).toBe('portainer.example.com');
});

test('extractToolProxmoxHost and extractToolPortainerHost read configured API hosts', () => {
  expect(extractToolProxmoxHost('proxmox', { base_url: 'https://pve.example.com:8006/api2/json' })).toBe('pve.example.com:8006');
  expect(extractToolPortainerHost('portainer', { base_url: 'https://portainer.example.com/api' })).toBe('portainer.example.com');
  expect(extractToolProxmoxHost('bash', { base_url: 'https://pve.example.com:8006/api2/json' })).toBeNull();
  expect(extractToolPortainerHost('bash', { base_url: 'https://portainer.example.com/api' })).toBeNull();
});
