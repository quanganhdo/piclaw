import { ChatSurface } from './components/chat-surface.js';
import { rewriteOwnedMediaUrl } from './components/post.js';
import { FamilyApi } from './family-api.js';
import { validMemorySource } from './family-memory.js';
import { isCompactionStatus } from './ui/status-duration.js';
import { uploadMedia } from './ui/upload-transfers.js';
import { getGeneratedWidgetShouldCloseOnSubmit, getGeneratedWidgetSubmissionText } from './ui/generated-widget.js';
import { html, render, useState } from './vendor/preact-htm.js';

const denyStatusWorkspaceLookup = async (): Promise<null> => null;

export interface FamilyChatDirectoryEntry {
  branch_id?: string;
  chat_jid: string;
  root_chat_jid: string;
  parent_branch_id?: string | null;
  agent_name: string;
  archived_at?: string | null;
  model?: string | null;
  model_label?: string | null;
  is_active?: boolean;
  capabilities?: Record<string, boolean>;
}

interface FamilyChatSurfaceSnapshot {
  posts: any[];
  hasMore: boolean;
  directory: FamilyChatDirectoryEntry[];
  currentChatJid: string;
  enabled: boolean;
  identity: FamilyApi['identity'];
  modelState: Record<string, any> | null;
  agentState: Record<string, any> | null;
  contextUsage: Record<string, any> | null;
  queueItems: any[];
  connectionStatus: string;
}

function FamilyChatSurfaceView({ owner }: { owner: FamilyChatSurface }) {
  const [value, setValue] = useState(owner.readSnapshot());
  owner.bindRender(setValue);
  return owner.renderSnapshot(value);
}

/**
 * Thin family adapter for the one shared production ChatSurface. It owns no
 * alternate renderer, compose widget, model picker, session picker or status UI.
 */
export class FamilyChatSurface {
  private readonly host = document.getElementById('family-chat-root') as HTMLElement;
  private snapshot: FamilyChatSurfaceSnapshot;
  private readonly postCapabilities: Record<string, unknown>;
  private readonly preferenceRuntime: EventTarget & { localStorage: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void } };
  private stopped = false;
  private pending: { chatJid: string; content: string; mediaIds: number[]; requestId: string } | null = null;
  private renderSetter: ((value: FamilyChatSurfaceSnapshot) => void) | null = null;
  private readonly composeBrowserStorage: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void };
  private readonly composeDrafts = new Map<string, string>();
  private readonly cardRequests = new Map<string,string>();
  private floatingWidget: any = null;
  private attachmentPreview: { mediaId: number; info: any } | null = null;

  constructor(
    private readonly api: FamilyApi,
    private readonly hooks: {
      navigate: (chatJid: string) => Promise<void>;
      changed: () => Promise<void>;
      refreshDirectory: () => Promise<void>;
      previewMemory: (source: any) => Promise<void> | void;
      submissionState: (busy: boolean) => void;
    },
  ) {
    this.snapshot = {
      posts: [], hasMore: false, directory: [], currentChatJid: '', enabled: false, identity: api.identity,
      modelState: null, agentState: null, contextUsage: null, queueItems: [], connectionStatus: 'disconnected',
    };
    const preferences = new Map<string, string>();
    const composeState = new Map<string, string>();
    const runtime = new EventTarget() as FamilyChatSurface['preferenceRuntime'];
    runtime.localStorage = { getItem: key => preferences.get(key) ?? null, setItem: (key, value) => { preferences.set(key, value); } };
    this.preferenceRuntime = runtime;
    this.composeBrowserStorage = {
      getItem: key => composeState.get(key) ?? null,
      setItem: (key, value) => { composeState.set(key, value); },
    };
    this.postCapabilities = Object.freeze({
      media: true,
      mediaActions: true,
      cards: true,
      widgets: true,
      annotations: true,
      annotationActions: true,
      cardActions: true,
      widgetActions: true,
      resourceActions: true,
      thinking: true,
      delete: false,
      rewriteImageSrc: rewriteOwnedMediaUrl,
      loadMediaInfo: (mediaId: number) => this.api.request(`/media/${mediaId}/info`),
      loadThinking: (messageId: number, chatJid: string) => this.api.request(`/agent/thinking?message_id=${encodeURIComponent(messageId)}&chat_jid=${encodeURIComponent(chatJid)}`),
    });
    render(html`<${FamilyChatSurfaceView} owner=${this} />`, this.host);
  }

  readSnapshot(): FamilyChatSurfaceSnapshot { return this.snapshot; }
  bindRender(setter: (value: FamilyChatSurfaceSnapshot) => void): void { this.renderSetter = setter; }

  update(value: Partial<FamilyChatSurfaceSnapshot>): void {
    if (this.stopped) return;
    this.snapshot = { ...this.snapshot, ...value };
    this.host.dataset.chatJid = this.snapshot.currentChatJid;
    this.host.setAttribute('aria-busy', String(!this.snapshot.enabled));
    this.renderSetter?.(this.snapshot);
  }

  clear(options: { preserveComposeDraft?: boolean } = {}): void {
    this.pending = null; this.floatingWidget = null; this.attachmentPreview = null;
    if (!options.preserveComposeDraft) this.composeDrafts.clear();
    this.update({ posts: [], hasMore: false, directory: [], currentChatJid: '', enabled: false, modelState: null, agentState: null, contextUsage: null, queueItems: [], connectionStatus: 'disconnected' });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.pending = null; this.floatingWidget = null; this.attachmentPreview = null;
    this.renderSetter = null;
    render(null, this.host);
    this.host.replaceChildren();
    this.host.dataset.chatJid = '';
    this.host.setAttribute('aria-busy', 'true');
  }

  private readonly sendMessage = async (
    _agentId: string,
    content: string,
    _threadId: unknown,
    mediaIds: number[],
    mode: string | null | undefined,
    chatJid: string,
  ): Promise<any> => {
    // ComposeBox model controls use this injected service directly. Admit only
    // exact model/thinking controls; all other slash/mention inputs stay denied.
    if (this.stopped || chatJid !== this.snapshot.currentChatJid) throw new Error('This family conversation is unavailable. Refresh before sending.');
    const command = typeof content === 'string' ? content.trim() : '';
    const modelControl = command.match(/^\/(model|thinking)\s+(.+)$/i);
    if (modelControl && !mediaIds?.length && !mode) {
      return await this.api.request(`/agent/models?chat_jid=${encodeURIComponent(chatJid)}`, 'PATCH', { action: modelControl[1].toLowerCase(), value: modelControl[2] });
    }
    if (/^\/abort\s*$/i.test(command)) {
      return await this.api.request('/agent/runs/abort', 'POST', { chat_jid: chatJid, turn_id: this.snapshot.agentState?.data?.turn_id ?? undefined });
    }
    let message = command;
    let familyMode = mode === 'queue' || mode === 'steer' || mode === 'auto' ? mode : 'send';
    const explicit = command.match(/^\/(queue-all|queue|steer)\s+([\s\S]+)$/i);
    if (explicit) {
      familyMode = explicit[1].toLowerCase() === 'queue-all' ? 'queue_all' : explicit[1].toLowerCase();
      message = explicit[2].trim();
    }
    if ((!message && !mediaIds.length) || /^[\s]*[/@]/.test(message)) throw new Error('A message or attachment and a permitted live-turn mode are required by the current family capability policy.');
    const pendingContent = `${familyMode}:${message}`;
    if (!this.pending || this.pending.chatJid !== chatJid || this.pending.content !== pendingContent
      || JSON.stringify(this.pending.mediaIds) !== JSON.stringify(mediaIds)) {
      this.pending = { chatJid, content: pendingContent, mediaIds: [...mediaIds], requestId: crypto.randomUUID() };
    }
    const request = this.pending;
    const response = await this.api.request(`/agent/default/message?chat_jid=${encodeURIComponent(chatJid)}`, 'POST', {
      content: message,
      request_id: request.requestId,
      mode: familyMode,
      media_ids: request.mediaIds,
    });
    if (this.pending === request) this.pending = null;
    return response;
  };

  private readonly loadModels = async (chatJid: string): Promise<any> => {
    return await this.api.request(`/agent/models?chat_jid=${encodeURIComponent(chatJid)}`);
  };

  private readonly loadComposeCommands = async (chatJid: string): Promise<any> => {
    const response = await this.api.request(`/agent/commands?chat_jid=${encodeURIComponent(chatJid)}`);
    if (Array.isArray(response?.mentions)) {
      const byJid = new Map(this.snapshot.directory.map(entry => [entry.chat_jid, entry]));
      for (const mention of response.mentions) {
        const chatJid = typeof mention?.chat_jid === 'string' ? mention.chat_jid : '';
        const agentName = typeof mention?.agent_name === 'string' ? mention.agent_name : '';
        if (!chatJid || !agentName || byJid.has(chatJid)) continue;
        byJid.set(chatJid, { ...mention, chat_jid: chatJid, agent_name: agentName });
      }
      this.update({ directory: [...byJid.values()] });
    }
    return { commands: Array.isArray(response?.commands) ? response.commands : [] };
  };

  private readonly mutateSession = async (path: string, body: Record<string, unknown>): Promise<any> => {
    const response = await this.api.request(path, 'POST', body);
    await this.hooks.refreshDirectory();
    return response;
  };

  renderSnapshot(value: FamilyChatSurfaceSnapshot): unknown {
    if (this.stopped) return null;
    const activeAgentState = value.agentState?.status === 'active' ? value.agentState : null;
    const terminalError = value.agentState?.data?.type === 'error' ? value.agentState.data : null;
    const agentStatus = activeAgentState?.data ?? terminalError;
    const currentTurnId = typeof agentStatus?.turn_id === 'string' ? agentStatus.turn_id : null;
    const currentBranch = value.directory.find(branch => branch.chat_jid === value.currentChatJid) as (FamilyChatDirectoryEntry & { capabilities?: Record<string, boolean> }) | undefined;
    const renderAccessory = (post: any) => {
      const source = post?.memory_source;
      if (!validMemorySource(source) || source.chat_jid !== value.currentChatJid || source.message_rowid !== post.id) return null;
      return html`<button
        type="button"
        class="memory-preview"
        disabled=${!value.enabled}
        onClick=${() => { if (value.enabled) void this.hooks.previewMemory(source); }}
      >Preview for family memory</button>`;
    };
    return html`<${ChatSurface}
      timelineId="timeline"
      composeId="compose-form"
      posts=${value.posts}
      hasMore=${value.hasMore}
      renderPostAccessory=${renderAccessory}
      postCapabilities=${this.postCapabilities}
      onOpenWidget=${(widget: any) => { this.floatingWidget = widget; this.renderSetter?.({ ...this.snapshot }); }}
      onOpenAttachmentPreview=${(preview: any) => { this.attachmentPreview = preview; this.renderSetter?.({ ...this.snapshot }); }}
      onSaveAnnotations=${async (postId: number, annotations: unknown[], chatJid: string) => {
        const response = await this.api.request(`/post/${postId}/annotations?chat_jid=${encodeURIComponent(chatJid)}`, 'PATCH', { annotations });
        return response.annotations;
      }}
      onSubmitCardAction=${async (payload: any) => {
        const key=`${payload.chat_jid}:${payload.post_id}:${payload.card_id}:${JSON.stringify(payload.action)}`;
        let id=this.cardRequests.get(key);if(!id){id=crypto.randomUUID();this.cardRequests.set(key,id);}
        const response=await this.api.request('/agent/card-action','POST',{...payload,request_id:id});this.cardRequests.delete(key);return response;
      }}
      agents=${{}}
      user=${{ name: value.identity.displayName, user_name: value.identity.displayName }}
      reverse=${true}
      agentStatus=${agentStatus}
      isCompactionStatus=${isCompactionStatus}
      agentDraft=${value.agentState?.draft ?? null}
      agentThought=${value.agentState?.thought ?? null}
      currentTurnId=${currentTurnId}
      loadStatusWorkspaceBranch=${denyStatusWorkspaceLookup}
      floatingWidget=${this.floatingWidget}
      onCloseWidget=${() => { this.floatingWidget = null; this.renderSetter?.({ ...this.snapshot }); }}
      onWidgetEvent=${(event: any) => {
        if(event?.kind==='widget.close'){this.floatingWidget=null;this.renderSetter?.({...this.snapshot});return;}
        if(event?.kind!=='widget.submit')return;
        const text=getGeneratedWidgetSubmissionText(event.payload);if(!text)return;
        void this.sendMessage('default',text,null,[],activeAgentState?'queue':'send',value.currentChatJid).then(()=>{
          if(getGeneratedWidgetShouldCloseOnSubmit(event.payload))this.floatingWidget=null;
          this.composeDrafts.delete(value.currentChatJid);this.renderSetter?.({...this.snapshot});void this.hooks.changed();
        }).catch(error=>{document.getElementById('family-error')!.textContent=error?.message||'Widget submission failed.';});
      }}
      attachmentPreview=${this.attachmentPreview}
      onCloseAttachmentPreview=${() => { this.attachmentPreview = null; this.renderSetter?.({ ...this.snapshot }); }}
      composeKey=${`${value.identity.userId}:${value.currentChatJid}`}
      composeProps=${{
        key: `${value.identity.userId}:${value.currentChatJid}`,
        currentChatJid: value.currentChatJid || value.identity.homeChatJid,
        activeChatAgents: value.directory,
        activeModel: value.modelState?.current ?? null,
        agentModelsPayload: value.modelState,
        thinkingLevel: value.modelState?.thinking_level ?? null,
        supportsThinking: value.modelState?.supports_thinking === true,
        contextUsage: value.contextUsage ?? value.modelState?.context_usage ?? null,
        statusNotice: isCompactionStatus(agentStatus) ? agentStatus : null,
        preferenceRuntime: this.preferenceRuntime,
        onModelStateChange: (state: any) => { if (state && typeof state === 'object') this.update({ modelState: state }); },
        onSwitchChat: value.enabled ? (chatJid: string) => { void this.hooks.navigate(chatJid); } : undefined,
        onCreateSession: value.enabled && currentBranch?.capabilities?.fork === true ? async () => {
          const sourceChatJid = value.currentChatJid;
          const response = await this.mutateSession('/agent/branch-fork', { chat_jid: sourceChatJid, request_id: crypto.randomUUID() });
          if (this.stopped || this.snapshot.currentChatJid !== sourceChatJid) return;
          const chatJid = response?.branch?.chat_jid; if (typeof chatJid === 'string') await this.hooks.navigate(chatJid);
        } : undefined,
        onCreateRootSession: value.enabled ? async (agentName: string) => {
          const sourceChatJid = value.currentChatJid;
          const response = await this.mutateSession('/agent/root-session', { agent_name: agentName });
          if (this.stopped || this.snapshot.currentChatJid !== sourceChatJid) return;
          const chatJid = response?.branch?.chat_jid; if (typeof chatJid === 'string') await this.hooks.navigate(chatJid);
        } : undefined,
        onRenameSession: value.enabled && currentBranch?.capabilities?.rename === true ? async () => {
          const name = window.prompt('Rename current session', currentBranch.agent_name)?.trim();
          const sourceChatJid = value.currentChatJid;
          if (name) { await this.mutateSession('/agent/branch-rename', { chat_jid: sourceChatJid, agent_name: name }); if (!this.stopped && this.snapshot.currentChatJid === sourceChatJid) await this.hooks.changed(); }
        } : undefined,
        onDeleteSession: value.enabled ? async (chatJid: string, options?: { confirmed?: boolean }) => {
          const branch = value.directory.find(item => item.chat_jid === chatJid) as any;
          const confirmed = options?.confirmed === true || window.confirm(`Archive @${branch?.agent_name || chatJid}? History and files are retained.`);
          if (branch?.capabilities?.archive !== true || !confirmed) return false;
          await this.mutateSession('/agent/branch-prune', { chat_jid: chatJid });
          if (chatJid === value.currentChatJid) await this.hooks.navigate(value.identity.homeChatJid); else await this.hooks.changed();
          return true;
        } : undefined,
        onRestoreSession: value.enabled ? async (chatJid: string) => {
          const branch = value.directory.find(item => item.chat_jid === chatJid) as any;
          if (branch?.capabilities?.restore !== true) throw new Error('This session cannot be restored.');
          const sourceChatJid = value.currentChatJid;
          await this.mutateSession('/agent/branch-restore', { chat_jid: chatJid, agent_name: branch.agent_name });
          if (!this.stopped && this.snapshot.currentChatJid === sourceChatJid) await this.hooks.navigate(chatJid);
        } : undefined,
        onSubmitIntercept: value.enabled ? undefined : async () => { throw new Error('This family conversation is unavailable. Refresh before sending.'); },
        onPost: () => { this.composeDrafts.delete(value.currentChatJid); document.getElementById('family-error')!.textContent = ''; void this.hooks.changed(); },
        onSubmitError: (message: string) => {
          document.getElementById('family-error')!.textContent = `${message} Resend unchanged text to reuse the request ID; do not assume it was rejected.`;
        },
        onSubmissionStateChange: this.hooks.submissionState,
        draftValue: this.composeDrafts.get(value.currentChatJid) ?? '',
        onContentChange: (content: string) => {
          if (content) this.composeDrafts.set(value.currentChatJid, content);
          else this.composeDrafts.delete(value.currentChatJid);
        },
        followupQueueItems: value.queueItems,
        onInjectQueuedFollowup: value.enabled ? async (item: any) => {
          await this.api.request('/agent/queue-steer', 'POST', { chat_jid: value.currentChatJid, row_id: item.row_id });
          await this.hooks.changed();
        } : undefined,
        onRemoveQueuedFollowup: value.enabled ? async (item: any) => {
          await this.api.request('/agent/queue-remove', 'POST', { chat_jid: value.currentChatJid, row_id: item.row_id });
          await this.hooks.changed();
        } : undefined,
        onMoveQueuedFollowup: value.enabled ? async (fromIndex: number, toIndex: number) => {
          await this.api.request('/agent/queue-reorder', 'POST', { chat_jid: value.currentChatJid, from_index: fromIndex, to_index: toIndex });
          await this.hooks.changed();
        } : undefined,
        isAgentActive: activeAgentState !== null,
        connectionStatus: value.enabled ? value.connectionStatus : 'disconnected',
        stateAccessFailed: !value.enabled,
        showQueueStack: true,
        services: {
          sendAgentMessage: this.sendMessage,
          getAgentModels: this.loadModels,
          uploadMedia: (file: File, options: any) => uploadMedia(file, { ...options, headers: {
            'x-piclaw-account-id': value.identity.userId,
            'x-piclaw-login-id': value.identity.loginId,
          } }),
          fetchCommands: this.loadComposeCommands,
          browserStorage: this.composeBrowserStorage,
        },
        capabilities: {
          persistBrowserState: true,
          commands: true,
          mentions: true,
          media: true,
          search: false,
          location: false,
          speech: true,
          notifications: false,
          modelPicker: true,
          modelSettings: false,
          modelCompaction: false,
          sessionRollup: false,
        },
        storageNamespace: `family:${value.identity.userId}`,
        disabled: !value.enabled,
        inputId: 'message-text',
        sendButtonId: 'send-message',
      }}
    />`;
  }
}
