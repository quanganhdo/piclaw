import type { AuthenticatedPrincipal } from '../core/access-types';
import { createLogger } from '../utils/logger';
const log=createLogger('addons.authenticated-socket');
export type { AuthenticatedPrincipal } from '../core/access-types';
export interface AuthenticatedAddonSocketRegistration {
  path: string;
  maxMessageBytes: number;
  maxQueuedBytes: number;
  maxSessionMs: number;
  maxConnections: number;
  authorize(context: {principal: Readonly<AuthenticatedPrincipal>; request: Request; signal: AbortSignal}): Promise<Readonly<{chatJid: string; workspaceId?: string}>>;
  open(context: {principal: Readonly<AuthenticatedPrincipal>; scope: Readonly<{chatJid: string; workspaceId?: string}>; signal: AbortSignal; send(message: string | Uint8Array): Promise<void>; close(code?: number, reason?: string): void}): Promise<{message(message: string | Uint8Array): Promise<void>; dispose(): Promise<void>}>;
}
export interface AddonSocketTransport {
  send(message: string | Uint8Array): Promise<void>;
  close(code: number, reason: string): void;
}
/** One capacity-owned socket; abort is distinct from awaited handler cleanup. */
export class AuthenticatedAddonSocketSession {
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private opening: Promise<Awaited<ReturnType<AuthenticatedAddonSocketRegistration['open']>>> | undefined;
  private handler: Awaited<ReturnType<AuthenticatedAddonSocketRegistration['open']>> | undefined;
  private queue: Promise<void> = Promise.resolve();
  private queuedBytes = 0;
  private closing: Promise<void> | undefined;
  private closed = false;
  private transport: AddonSocketTransport | undefined;
  private outbound = new Set<Promise<void>>();
  private outboundBytes = 0;
  private outboundTail: Promise<void> = Promise.resolve();
  private revocationTimer: ReturnType<typeof setInterval> | undefined;
  private authorized: (() => boolean) | undefined;
  monitorAuthorization(check: () => boolean): void {
    this.authorized = check;
    this.revocationTimer = setInterval(() => { if (!check()) void this.close(1008, 'Authorization revoked.').catch(error => log.warn('Socket revocation cleanup failed.',{operation:'addon_socket.revocation_cleanup'})); }, 1000);
  }
  private preparation: Promise<unknown> | undefined;
  retainPreparation(preparation: Promise<unknown>): void { if (this.preparation) throw Error('Socket preparation already owned.'); this.preparation = preparation; }
  constructor(readonly registration: AuthenticatedAddonSocketRegistration, private readonly release: () => void) {
    this.signal = this.controller.signal;
    this.timer = setTimeout(() => { void this.close(1008, 'Session expired.').catch(error=>log.warn('Socket expiry cleanup failed.',{operation:'addon_socket.expiry_cleanup'})); }, registration.maxSessionMs);
  }
  async open(principal: Readonly<AuthenticatedPrincipal>, scope: Readonly<{chatJid:string;workspaceId?:string}>, transport: AddonSocketTransport): Promise<void> {
    if (this.opening || this.closed) throw Error('Socket session is not available.');
    this.transport = transport;
    this.opening = Promise.resolve().then(() => this.registration.open({principal,scope,signal:this.signal,
      send: message => {
        if(this.closed||this.authorized?.()===false)return Promise.reject(Error('Socket is closed or unauthorized.'));
        const bytes=Math.max(1,typeof message==='string'?Buffer.byteLength(message):message.byteLength);
        if(bytes>this.registration.maxMessageBytes||this.outboundBytes+bytes>this.registration.maxQueuedBytes)return Promise.reject(Error('Socket output exceeds limit.'));
        this.outboundBytes+=bytes;
        const captured=typeof message==='string'?message:message.slice();
        const pending=this.outboundTail.then(()=>{if(this.closed||this.authorized?.()===false)throw Error('Socket is closed or unauthorized.');return transport.send(captured);});
        this.outboundTail=pending.catch(error=>{log.warn('Socket outbound frame failed.',{operation:'addon_socket.outbound_failure'});});this.outbound.add(pending);
        void pending.then(()=>{this.outbound.delete(pending);this.outboundBytes-=bytes;},()=>{this.outbound.delete(pending);this.outboundBytes-=bytes;});
        return pending;
      },
      close: code => { void this.close(code??1000).catch(error=>log.warn('Socket add-on cleanup failed.',{operation:'addon_socket.addon_cleanup'})); },
    }));
    try {
      const handler = await this.opening;
      this.handler = handler;
      if (this.closed) { await this.close(); return; }
    } catch { transport.close(1011,'Add-on session failed.'); await this.close(); throw Error('Add-on socket open failed.'); }
  }
  message(message: string | Uint8Array): Promise<void> {
    if(this.closed||this.authorized?.()===false)return Promise.reject(Error('Socket is closed or unauthorized.'));
    const bytes=Math.max(1,typeof message==='string'?Buffer.byteLength(message):message.byteLength);
    if(bytes>this.registration.maxMessageBytes || this.queuedBytes+bytes>this.registration.maxQueuedBytes){void this.close(1009,'Socket input exceeds limits.').catch(error=>log.warn('Socket limit cleanup failed.',{operation:'addon_socket.limit_cleanup'}));return Promise.reject(Error('Socket input exceeds limits.'));}
    const captured=typeof message==='string'?message:message.slice();
    this.queuedBytes+=bytes;
    const pending=this.queue.then(async()=>{if(this.closed||this.authorized?.()===false)throw Error('Socket closed or unauthorized before dispatch.');const handler=this.handler??await this.opening;if(!handler)throw Error('Socket is not open.');if(this.closed||this.authorized?.()===false)throw Error('Socket closed or unauthorized after opening.');await handler.message(captured);});
    this.queue=pending.then(()=>{this.queuedBytes-=bytes;},()=>{this.queuedBytes-=bytes;});
    return pending;
  }
  close(_code=1000,_reason='Session closed.'): Promise<void> {
    if(this.closing)return this.closing;
    this.closed=true;clearTimeout(this.timer);clearInterval(this.revocationTimer);this.controller.abort();
    this.closing=(async()=>{
      let failed=false;
      try{this.transport?.close(_code, 'Add-on session closed.');}catch{failed=true;log.warn('Socket transport close failed.',{operation:'addon_socket.transport_close'});}
      const results=await Promise.allSettled([this.opening,this.queue,...this.outbound,this.preparation]);
      const opened=results[0];
      if(opened.status==='fulfilled'&&opened.value){try{await opened.value.dispose();}catch{failed=true;log.warn('Socket disposal failed.',{operation:'addon_socket.dispose'});}}
      if(failed)throw Error('Authenticated socket cleanup failed.');
      this.release();
    })();
    return this.closing;
  }
}
