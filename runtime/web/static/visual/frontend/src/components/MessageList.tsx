import { useSignal } from "@preact/signals";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { useScrollManager } from "./message-list/useScrollManager";
import { useTimelineFetch } from "./message-list/useTimelineFetch";
import { useTimelineStream } from "./message-list/useTimelineStream";
import { MessageItem } from "./message-list/MessageItem";
import { useCollapsedMessages } from "./message-list/useCollapsedMessages";
import type { Interaction } from "./message-list/types";
import { shouldHideTimelineInteraction } from "./message-list/helpers";
import { bindTimelineLatest, jumpTimelineToLatest } from '../../../../../src/ui/timeline-latest';

export function MessageList() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const timelineError = useSignal<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Stable ref used to forward setMessages into useScrollManager without
  // a circular dependency (setMessages comes from useTimelineFetch which
  // needs scrollToBottom from useScrollManager).
  const replaceMessagesRef = useRef<((posts: Interaction[]) => void) | null>(null);
  const onReplaceMessages = useCallback((posts: Interaction[]) => {
    replaceMessagesRef.current?.(posts);
  }, []);

  const { listRef, scrollToBottom, userScrolledRef } = useScrollManager(onReplaceMessages);
  const latestController = useRef<ReturnType<typeof bindTimelineLatest> | null>(null);

  const { isCollapsed, toggle: toggleCollapse } = useCollapsedMessages();

  const handleDeleteMessage = async (id: number) => {
    try {
      const res = await fetch(`/post/${id}`, { method: "DELETE", credentials: "same-origin" });
      if (res.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== id));
      } else {
        window.dispatchEvent(new CustomEvent("piclaw:status-flash", { detail: { message: "Failed to delete message", type: "error" } }));
      }
    } catch {
      window.dispatchEvent(new CustomEvent("piclaw:status-flash", { detail: { message: "Failed to delete message", type: "error" } }));
    }
  };

  const {
    messages,
    setMessages,
    replaceMessages,
    hasMore,
    loadingMore,
    fetchTimeline,
    loadMore,
    refetchTimelineOnReconnect,
  } = useTimelineFetch({ setConnected, scrollToBottom, timelineError, listRef });

  // Keep replaceMessagesRef in sync (setMessages is a stable setState setter)
  replaceMessagesRef.current = replaceMessages;
  useEffect(() => {
    const root = listRef.current; if (!root) return;
    const binding = bindTimelineLatest(root, state => window.dispatchEvent(new CustomEvent('piclaw:timeline-latest-state', { detail: { ...state, scroller: root } })));
    latestController.current = binding;
    const jump = () => { userScrolledRef.current = false; jumpTimelineToLatest(root); };
    const arrivals = () => binding.markNewMessages();
    root.addEventListener('piclaw:timeline-arrivals', arrivals);
    window.addEventListener('piclaw:jump-latest', jump);
    return () => { binding.dispose(); latestController.current = null; root.removeEventListener('piclaw:timeline-arrivals', arrivals); window.removeEventListener('piclaw:jump-latest', jump); };
  }, []);
  useEffect(() => { latestController.current?.noteLatest(Math.max(0, ...messages.map(message => Number(message.id) || 0))); }, [messages]);

  useTimelineStream({
    setMessages,
    setConnected,
    scrollToBottom,
    refetchTimelineOnReconnect,
    timelineError,
  });

  // Listen for optimistic user messages from compose box
  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      if (!msg?.id) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [
          ...prev,
          {
            id: msg.id,
            type: "user",
            content: msg.data?.content ?? "",
            created_at: msg.timestamp,
            data: msg.data,
          },
        ];
      });
      userScrolledRef.current = false;
      scrollToBottom(true);
    };
    window.addEventListener("piclaw:new-message", handler);
    return () => window.removeEventListener("piclaw:new-message", handler);
  }, [scrollToBottom, setMessages, userScrolledRef]);

  return (
    <div className="message-list" ref={listRef}>
      {connected === false && (
        <div className="message-list__status-banner message-list__status-banner--disconnected">
          ⚠️ Connection lost — showing last known messages
        </div>
      )}
      {timelineError.value && (
        <div
          className="message-list__error-banner"
          onClick={() => {
            timelineError.value = null;
            void fetchTimeline().then(() => {
              timelineError.value = null;
              scrollToBottom(true);
            });
          }}
        >
          ⚠ {timelineError.value}
        </div>
      )}

      {messages.length === 0 && connected === true && (
        <div className="message-list__empty">
          <p>No messages yet. Say hello! 👋</p>
        </div>
      )}

      {[...messages].reverse().filter((msg) => {
        if (shouldHideTimelineInteraction(msg)) return false;
        const c = msg.content ?? "";
        // Hide wizard-generated login/logout messages and their card responses
        if (c.startsWith("/login __step") || c.startsWith("/logout ")) return false;
        if (msg.content_blocks?.some((b: Record<string, unknown>) => {
          if (!b || typeof b !== "object") return false;
          const cardId = typeof b.card_id === "string" ? b.card_id : "";
          return cardId.startsWith("login-");
        })) return false;
        return true;
      }).map((msg) => (
        <MessageItem
          key={msg.id}
          interaction={msg}
          isCollapsed={isCollapsed(msg.id)}
          onToggleCollapse={() => toggleCollapse(msg.id)}
          onDelete={() => handleDeleteMessage(msg.id)}
        />
      ))}

      {hasMore && (
        <div className="message-list__load-more">
          <button
            type="button"
            className="message-list__load-more-btn"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading…" : "Load older messages"}
          </button>
        </div>
      )}
    </div>
  );
}
