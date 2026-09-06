import type { SessionSettings } from '../../src/core/session-settings.js';
import { FamilyApi } from './family-api.js';
type Branch = SessionSettings['branches'][number];
const node = <T extends HTMLElement>(id:string) => document.getElementById(id) as T;
const MAX_MESSAGES=2000, MAX_BYTES=8*1024*1024, PAGE_SIZE=100;

/** Private memory-only export. Never navigate to an unpinned download URL. */
export class FamilyTranscript {
  private target:Branch|null=null;
  private generation=0;
  private controller:AbortController|null=null;
  private text='';
  private busy=false;
  private url:string|null=null;
  private urlTimer:ReturnType<typeof setTimeout>|null=null;
  private status=node('transcript-status');
  constructor(private api:FamilyApi) {
    node('cancel-transcript').addEventListener('click',()=>this.clear());
    node('transcript-confirm').addEventListener('change',()=>{node<HTMLButtonElement>('prepare-transcript').disabled=this.busy||!node<HTMLInputElement>('transcript-confirm').checked||!this.target;});
    node('prepare-transcript').addEventListener('click',()=>{void this.prepare();});
    node('save-transcript').addEventListener('click',()=>{void this.save();});
  }
  clear():void {
    this.generation++;this.controller?.abort();this.controller=null;this.target=null;this.text='';this.busy=false;
    this.revoke();node('transcript-export').hidden=true;node('transcript-target').textContent='';this.status.textContent='';
    node<HTMLInputElement>('transcript-confirm').checked=false;node<HTMLButtonElement>('prepare-transcript').disabled=true;node<HTMLButtonElement>('save-transcript').disabled=true;
  }
  private revoke():void {if(this.url)URL.revokeObjectURL(this.url);this.url=null;if(this.urlTimer)clearTimeout(this.urlTimer);this.urlTimer=null;}
  choose(branch:Branch):void {
    this.clear();if(branch.capabilities.download_transcript!==true||!branch.archived_at||document.hidden)return;
    this.target={...branch};node('transcript-export').hidden=false;node('transcript-target').textContent=`Archived @${branch.agent_name} · ${branch.chat_jid}`;
    node<HTMLInputElement>('transcript-confirm').disabled=false;node('transcript-heading').focus();
  }
  private valid(generation:number):boolean {return generation===this.generation&&Boolean(this.target)&&!document.hidden&&!this.controller?.signal.aborted;}
  private async checkArchive(branch:Branch,signal:AbortSignal):Promise<void> {
    const value:SessionSettings=await this.api.request('/account/trees','GET',undefined,signal);
    const current=value?.branches?.find(row=>row.branch_id===branch.branch_id&&row.chat_jid===branch.chat_jid);
    if(!current||current.archived_at!==branch.archived_at||current.root_chat_jid!==branch.root_chat_jid||current.agent_name!==branch.agent_name||current.capabilities.download_transcript!==true)throw new Error('Archive changed or is unavailable. Refresh My sessions.');
  }
  private async prepare():Promise<void> {
    if(!this.target||this.busy||document.hidden||!node<HTMLInputElement>('transcript-confirm').checked)return;
    const branch=this.target,generation=++this.generation,controller=new AbortController();this.controller=controller;this.busy=true;this.text='';this.revoke();
    node<HTMLButtonElement>('prepare-transcript').disabled=true;node<HTMLButtonElement>('save-transcript').disabled=true;node<HTMLInputElement>('transcript-confirm').disabled=true;
    try {
      const pages:string[][]=[];let before:number|null=null,count=0,truncated=0;
      const header=`PiClaw archived text transcript\nSession: ${branch.chat_jid}\nHandle: ${branch.agent_name}\nArchived: ${branch.archived_at}\n\nThis is a paginated text export, not a full backup or atomic database snapshot.\nExcluded: media, rich blocks, previews, annotations, thread links, tasks, configuration, add-ons and session files.\nLong messages may be truncated to 32,000 characters (marked below).\n\n`;
      let bytes=new TextEncoder().encode(header).length;
      if(bytes>MAX_BYTES)throw new Error('Transcript exceeds the 8 MiB limit. No partial file was prepared.');
      for(let pageNumber=0;pageNumber<20;pageNumber++) {
        this.status.textContent=`Preparing transcript… ${count} messages`;
        const value=await this.api.request(`/agent/branch-download?chat_jid=${encodeURIComponent(branch.chat_jid)}&limit=${PAGE_SIZE}${before===null?'':`&before=${before}`}`,'GET',undefined,controller.signal);
        if(!this.valid(generation))return;
        if(value?.schema!=='piclaw.owned-transcript.v1'||value.branch?.branch_id!==branch.branch_id||value.branch.chat_jid!==branch.chat_jid||value.branch.root_chat_jid!==branch.root_chat_jid||value.branch.archived_at!==branch.archived_at||value.branch.agent_name!==branch.agent_name
          ||!Array.isArray(value.messages)||value.messages.length>PAGE_SIZE||typeof value.page?.has_more!=='boolean'||value.page.limit!==PAGE_SIZE)throw new Error('Invalid or changed transcript page.');
        const parts:string[]=[];let previous=0;
        for(const message of value.messages) {
          if(!Number.isSafeInteger(message.id)||message.id<=previous||(before!==null&&message.id>=before)||typeof message.content!=='string'||message.content.length>128000
            ||(message.timestamp!==null&&(typeof message.timestamp!=='string'||message.timestamp.length>128))||(message.sender_name!==null&&(typeof message.sender_name!=='string'||message.sender_name.length>512))||![0,1].includes(message.content_truncated)||![0,1].includes(message.is_bot_message))throw new Error('Invalid transcript message order or content.');
          previous=message.id;count++;if(message.content_truncated)truncated++;
          const part=`--- Message ${message.id} · ${message.timestamp??''} · ${message.sender_name??(message.is_bot_message?'Assistant':'User')} ---\n${message.content}\n${message.content_truncated?'[Message truncated by export]\n':''}\n`;
          bytes+=new TextEncoder().encode(part).length;if(bytes>MAX_BYTES||count>MAX_MESSAGES)throw new Error('Transcript exceeds the 2,000-message or 8 MiB limit. No partial file was prepared.');parts.push(part);
        }
        pages.push(parts);
        if(!value.page.has_more) {
          if(value.page.next_before!==null)throw new Error('Invalid final transcript page.');
          const summary=`Messages: ${count}; truncated messages: ${truncated}\n\n`;
          if(bytes+new TextEncoder().encode(summary).length>MAX_BYTES)throw new Error('Transcript exceeds the 8 MiB limit. No partial file was prepared.');
          await this.checkArchive(branch,controller.signal);if(!this.valid(generation))return;
          this.text=header+summary+pages.reverse().map(parts=>parts.join('')).join('');
          node<HTMLButtonElement>('save-transcript').disabled=false;this.status.textContent=`Prepared ${count} messages (${truncated} truncated). Choose Save text file to download. No file has been saved yet.`;return;
        }
        if(!value.messages.length||value.page.next_before!==value.messages[0].id||!Number.isSafeInteger(value.page.next_before)||(before!==null&&value.page.next_before>=before))throw new Error('Transcript pagination did not advance.');
        before=value.page.next_before;
      }
      throw new Error('Transcript exceeds the 2,000-message limit. No partial file was prepared.');
    } catch(error) {if(this.valid(generation)){this.text='';this.status.textContent=`${(error as Error).message} Close and refresh before trying again.`;}}
    finally {if(this.valid(generation))this.busy=false;}
  }
  private async save():Promise<void> {
    if(!this.target||!this.text||this.busy||document.hidden)return;
    const branch=this.target,generation=this.generation,controller=this.controller!;this.busy=true;node<HTMLButtonElement>('save-transcript').disabled=true;
    try {
      await this.checkArchive(branch,controller.signal);if(!this.valid(generation))return;
      this.url=URL.createObjectURL(new Blob([this.text],{type:'text/plain;charset=utf-8'}));this.text='';
      const link=document.createElement('a');link.href=this.url;link.download=`piclaw-transcript-${branch.branch_id.replace(/[^a-zA-Z0-9_-]/g,'_')}.txt`;document.body.append(link);link.click();link.remove();
      this.urlTimer=setTimeout(()=>this.revoke(),30000);this.status.textContent='Download requested. Protect the saved file; signing out cannot recall it.';
    } catch(error) {if(this.valid(generation)){this.text='';this.status.textContent=`${(error as Error).message} Nothing was downloaded. Close and refresh.`;}}
    finally {if(this.valid(generation))this.busy=false;}
  }
}
