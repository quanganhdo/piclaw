import { Type } from 'typebox';
import { StringEnum } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { getChatJid } from '../core/chat-context.js';
import { requireFamilyToolAccess } from '../agent-pool/family-tool-access.js';
import { getChatProject, updateChatProject } from '../db/chat-project.js';

/** Deliberately current-chat-only: no user-supplied target or remote authority. */
export const chatProjectTool: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.registerTool({
    name: 'chat_project',
    label: 'Chat project',
    description: 'Get, set, clear or inherit the current chat repository used for bare #123 issue/PR links. Set repository_url to a GitHub/Gitea web URL (including self-hosted). Clear disables links in this chat; inherit removes the override and follows its parent. Persistent across restarts. No network requests; does not modify repositories. Message references remain available from timestamps.',
    promptSnippet: "chat_project: set the current chat's GitHub/Gitea repository for bare #123 links, or get/clear/inherit it.",
    parameters: Type.Object({
      action: StringEnum(['get', 'set', 'clear', 'inherit'] as const),
      repository_url: Type.Optional(Type.String({ description: 'Repository web URL for set, e.g. https://github.com/owner/repo or https://gitea.example/owner/repo.' })),
    }),
    async execute(_id, params: { action: string; repository_url?: string }) {
      requireFamilyToolAccess('chat_project');
      const chatJid = getChatJid('').trim();
      if (!chatJid) throw new Error('chat_project requires an active chat context.');
      if (!['get', 'set', 'clear', 'inherit'].includes(params.action)) throw new Error('Unknown chat_project action.');
      if (params.action === 'set' && !params.repository_url?.trim()) throw new Error('repository_url is required for set.');
      if (params.action !== 'set' && params.repository_url !== undefined) throw new Error('repository_url is only valid for set.');
      const result = params.action === 'get' ? getChatProject(chatJid) : updateChatProject(chatJid, params.action as 'set' | 'clear' | 'inherit', params.repository_url);
      return { content: [{ type: 'text', text: result.repository_url ? `Numeric references in this chat link to ${result.repository_url}/issues/<number> (${result.mode}).` : `Numeric references in this chat remain plain text (${result.mode}).` }], details: result };
    },
  });
};
