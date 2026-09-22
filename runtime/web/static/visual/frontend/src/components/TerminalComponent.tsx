import { terminalThemeFromCss } from '../../../../../src/ui/theme-terminal';
import { useEffect, useRef, useState } from "preact/hooks";
import { Terminal as XtermTerminal } from "../../../../common/js/vendor/xterm/xterm.mjs";
import { FitAddon as XtermFitAddon } from "../../../../common/js/vendor/xterm/addon-fit.mjs";

import { createLogger } from "../utils/logger";
const log = createLogger("terminal");

type TerminalTheme = Record<string, string>;
type TerminalDimensions = { cols: number; rows: number };
type Disposable = { dispose: () => void };

interface TerminalInstance {
  options: { theme?: TerminalTheme };
  rows: number;
  refresh(start: number, end: number): void;
  open(container: HTMLElement): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  loadAddon(addon: unknown): void;
  onData(callback: (data: string) => void): Disposable;
  onResize(callback: (dims: TerminalDimensions) => void): Disposable;
  dispose(): void;
}

interface FitAddonInstance {
  fit(): void;
  proposeDimensions(): TerminalDimensions | undefined;
  dispose?(): void;
}

interface TerminalSessionInfo {
  ws_path: string;
}

function getTerminalClientId(): string {
  const key = "piclaw-terminal-client-id";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(key, id);
  }
  return id;
}

type ConnStatus = "connecting" | "connected" | "error" | "retrying";

export function TerminalComponent() {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<TerminalInstance | null>(null);
  const mountedRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connStatus, setConnStatus] = useState<ConnStatus>("connecting");
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    mountedRef.current = true;
    let terminal: TerminalInstance | null = null;
    let fitAddon: FitAddonInstance | null = null;
    let ws: WebSocket | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const refreshTheme = () => {
      const active = terminalRef.current;
      if (!mountedRef.current || !active) return;
      active.options.theme = terminalThemeFromCss();
      active.refresh(0, Math.max(0, active.rows - 1));
    };
    window.addEventListener('piclaw-theme-change', refreshTheme);

    async function setup() {
      if (!containerRef.current || !mountedRef.current) return;

      setConnStatus("connecting");
      setErrorMsg("");

      // Fetch terminal session info — fall back to default path if this fails
      const clientId = getTerminalClientId();
      let wsPath = "/terminal/ws";
      try {
        const resp = await fetch(`/terminal/session?client=${clientId}`, { credentials: "same-origin" });
        if (resp.ok) {
          const sessionInfo = await resp.json() as TerminalSessionInfo;
          wsPath = sessionInfo.ws_path || wsPath;
        } else {
          log.warn(`/terminal/session returned ${resp.status}, connecting directly`);
        }
      } catch (err) {
        log.warn("failed to fetch session info, connecting directly:", err);
      }

      if (!mountedRef.current || !containerRef.current) return;

      // Dispose any existing terminal before creating a new one
      if (terminalRef.current) {
        terminalRef.current.dispose();
        terminalRef.current = null;
      }

      // Create terminal
      const nextTerminal = new XtermTerminal({
        fontFamily: '"JetBrains Mono NF", monospace',
        fontSize: 13,
        theme: terminalThemeFromCss(),
        cursorBlink: true,
        cursorStyle: "block",
        scrollback: 5000,
      }) as TerminalInstance;
      terminal = nextTerminal;
      terminalRef.current = nextTerminal;

      // Load FitAddon
      const nextFitAddon = new XtermFitAddon() as FitAddonInstance;
      fitAddon = nextFitAddon;
      nextTerminal.loadAddon(nextFitAddon);

      // Mount terminal to DOM — container needs non-zero dimensions
      nextTerminal.open(containerRef.current);

      // Wait for fonts to be ready before fitting
      try {
        await document.fonts.ready;
      } catch (_) { /* ignore */ }

      if (!mountedRef.current) return;
      nextFitAddon.fit();
      resizeObserver = typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
          if (!mountedRef.current || !fitAddon) return;
          requestAnimationFrame(() => {
            if (!mountedRef.current || !fitAddon) return;
            fitAddon.fit();
          });
        })
        : null;
      resizeObserver?.observe(containerRef.current);

      // Connect WebSocket
      const wsUrl = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + wsPath + (wsPath.includes("?") ? "&" : "?") + `client=${clientId}`;
      ws = new WebSocket(wsUrl);

      const connectTimeout = setTimeout(() => {
        if (ws && ws.readyState !== WebSocket.OPEN && mountedRef.current) {
          ws.close();
          setConnStatus("error");
          setErrorMsg("Connection timed out. Retrying...");
          scheduleRetry();
        }
      }, 8000);

      ws.addEventListener("open", () => {
        clearTimeout(connectTimeout);
        if (!mountedRef.current) return;
        setConnStatus("connected");
        setErrorMsg("");
        // Send resize on open after fit
        const dims = fitAddon?.proposeDimensions();
        if (dims) {
          ws!.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
        }
      });

      ws.addEventListener("message", (event: MessageEvent) => {
        const activeTerminal = terminal;
        if (!activeTerminal) return;
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type === "output" && typeof msg.data === "string") {
            activeTerminal.write(msg.data);
          } else if (msg.type === "session") {
            // Session established — optionally resize to server's reported dimensions
            const cols = msg.cols as number | undefined;
            const rows = msg.rows as number | undefined;
            if (cols && rows) {
              // Prefer fit dimensions but accept server's if no container size yet
              const dims = fitAddon?.proposeDimensions();
              if (!dims) {
                activeTerminal.resize(cols, rows);
              }
            }
          }
        } catch (_) {
          // Binary or non-JSON data — write directly
          if (typeof event.data === "string") {
            activeTerminal.write(event.data);
          }
        }
      });

      ws.addEventListener("close", (event) => {
        clearTimeout(connectTimeout);
        if (mountedRef.current) {
          if (event.code === 1006) {
            setConnStatus("error");
            setErrorMsg("Terminal connection rejected — check authentication.");
            scheduleRetry(10000);
          } else {
            const reason = event.reason ? `: ${event.reason}` : "";
            setConnStatus("retrying");
            setErrorMsg(`Connection closed (code ${event.code}${reason}). Retrying in 3s...`);
            scheduleRetry(3000);
          }
        }
      });

      ws.addEventListener("error", () => {
        clearTimeout(connectTimeout);
        if (mountedRef.current) {
          setConnStatus("error");
          setErrorMsg("WebSocket error. Retrying in 3s...");
          scheduleRetry();
        }
      });

      // Forward keyboard input to WebSocket
      nextTerminal.onData((data: string) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "input", data }));
        }
      });

      // Forward resize events to WebSocket
      nextTerminal.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols, rows }));
        }
      });
    }

    function scheduleRetry(delay = 3000) {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        if (mountedRef.current) {
          setConnStatus("connecting");
          setup().catch((err) => log.error("setup error:", err));
        }
      }, delay);
    }

    setup().catch((err) => {
      log.error("setup error:", err);
      if (mountedRef.current) {
        setConnStatus("error");
        setErrorMsg(`Failed to start terminal: ${String(err)}`);
        scheduleRetry();
      }
    });

    return () => {
      mountedRef.current = false;
      window.removeEventListener('piclaw-theme-change', refreshTheme);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (ws) {
        ws.close();
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (fitAddon) {
        fitAddon.dispose?.();
      }
      if (terminal) {
        terminal.dispose();
        terminalRef.current = null;
      }
    };
  }, []);

  const showOverlay = connStatus !== "connected";

  return (
    <div className="terminal__outer">
      {/* Terminal canvas container — always rendered so open() has a DOM target */}
      <div
        ref={containerRef}
        className="terminal__canvas"
      />
      {/* Status overlay — shown while connecting/erroring */}
      {showOverlay && (
        <div
          className={`terminal__overlay${connStatus === "error" ? " terminal__overlay--error" : ""}`}
        >
          {connStatus === "connecting" && (
            <span className="terminal__overlay-connecting">Connecting to terminal...</span>
          )}
          {(connStatus === "error" || connStatus === "retrying") && (
            <>
              <span className="terminal__overlay-error">⚠ {errorMsg || "Terminal connection error"}</span>
              <span className="terminal__overlay-retry">Retrying automatically...</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
