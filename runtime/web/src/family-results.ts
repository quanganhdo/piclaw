import { FamilyApi } from './family-api.js';

function node<T extends HTMLElement>(id:string):T { return document.getElementById(id) as T; }
interface ResultItem { execution_id:string;chat_jid:string;created_at:number;state:string;publication_recorded:boolean }
const states=['unsettled','expired-unsettled','settled'];
const validId=(id:unknown):id is string=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(id);

/** No browser storage, automatic publication, or caller-selectable result destination. */
export class FamilyResults {
  private root=node('scheduled-results');
  private list=node('scheduled-result-list');
  private detail=node('scheduled-result-detail');
  private status=node('scheduled-results-status');
  private confirm=node<HTMLInputElement>('confirm-result-publication');
  private publish=node<HTMLButtonElement>('publish-result');
  private opened=false;
  private paused=false;
  private stopped=false;
  private busy=false;
  private generation=0;
  private controller:AbortController|null=null;
  private selected:{id:string;chat:string}|null=null;

  constructor(private api:FamilyApi,private hooks:{lock:(value:boolean)=>boolean;changed:()=>Promise<void>}) {
    node('open-results').addEventListener('click',()=>{if(this.paused||this.stopped||this.busy)return;this.opened=true;void this.load(true);});
    node('close-results').addEventListener('click',()=>{this.opened=false;this.clear();node('open-results').focus();});
    node('refresh-results').addEventListener('click',()=>{void this.load();});
    this.confirm.addEventListener('change',()=>{this.publish.disabled=this.busy||!this.selected||!this.confirm.checked;});
    this.publish.addEventListener('click',()=>{void this.publishSelected();});
  }
  private visible():boolean {return this.opened&&!this.paused&&!this.stopped&&!document.hidden;}
  private resetDetail():void {
    this.selected=null;this.detail.hidden=true;this.confirm.checked=false;this.confirm.disabled=true;this.publish.disabled=true;
    node('scheduled-result-target').textContent='';node('scheduled-result-text').textContent='';node('scheduled-result-state').textContent='';
  }
  private clear():void {
    this.generation++;this.controller?.abort();this.controller=null;this.root.hidden=true;this.list.replaceChildren();this.status.textContent='';this.resetDetail();
  }
  suspend():void {this.paused=true;this.clear();node<HTMLButtonElement>('open-results').disabled=true;}
  resume():void {
    if(this.stopped)return;
    const wasPaused=this.paused;this.paused=false;node<HTMLButtonElement>('open-results').disabled=this.busy;
    if(wasPaused&&this.opened&&!this.busy)void this.load();
  }
  stop():void {this.stopped=true;this.opened=false;this.clear();node<HTMLButtonElement>('open-results').disabled=true;}
  private startRequest():{generation:number;signal:AbortSignal} {
    this.controller?.abort();this.controller=new AbortController();return {generation:++this.generation,signal:this.controller.signal};
  }
  private active(generation:number):boolean {return this.visible()&&generation===this.generation;}
  private async load(focus=false):Promise<void> {
    if(!this.visible()||this.busy)return;
    this.clear();this.root.hidden=false;this.status.textContent='Loading scheduled results…';
    const request=this.startRequest();if(focus)node('scheduled-results-heading').focus();
    try {
      const value=await this.api.request('/agent/scheduled-results','GET',undefined,request.signal);
      if(!this.active(request.generation))return;
      if(value?.owner_user_id!==this.api.identity.userId||value.window_size!==50||!Array.isArray(value.items)||value.items.length>50)throw Error('Invalid result list. Refresh before continuing.');
      const fragment=document.createDocumentFragment(),ids=new Set<string>();
      for(const item of value.items as ResultItem[]) {
        if(!validId(item.execution_id)||ids.has(item.execution_id)||typeof item.chat_jid!=='string'||!item.chat_jid||!Number.isSafeInteger(item.created_at)||!states.includes(item.state)||typeof item.publication_recorded!=='boolean')throw Error('Invalid result metadata.');
        ids.add(item.execution_id);const li=document.createElement('li'),label=document.createElement('span'),button=document.createElement('button');
        label.textContent=`${item.chat_jid} · ${new Date(item.created_at).toISOString()} · recorded state: ${item.state}${item.publication_recorded?' · publication receipt recorded':''}`;
        button.type='button';button.textContent='Inspect result';button.addEventListener('click',()=>{void this.inspect(item);});li.append(label,button);fragment.append(li);
      }
      this.list.replaceChildren(fragment);this.status.textContent=value.items.length?'Metadata only from the newest 50 owned execution records. Inspect to validate and read a result; publication integrity is checked when confirming.':'No accessible scheduled results in the newest 50 owned execution records.';
    }catch(error){if(this.active(request.generation)){this.list.replaceChildren();this.status.textContent=(error as Error).message;}}
  }
  private async inspect(item:ResultItem):Promise<void> {
    if(!this.visible()||this.busy)return;
    this.resetDetail();const request=this.startRequest();this.status.textContent='Loading result…';
    try {
      const value=await this.api.request(`/agent/scheduled-results/${encodeURIComponent(item.execution_id)}`,'GET',undefined,request.signal);
      if(!this.active(request.generation))return;
      if(value?.execution_id!==item.execution_id||value.owner_user_id!==this.api.identity.userId||value.chat_jid!==item.chat_jid||!states.includes(value.state)||typeof value.publication_recorded!=='boolean'
        ||(value.state==='settled'?(!['success','error'].includes(value.result?.status)||typeof value.result?.text!=='string'||new TextEncoder().encode(value.result.text).byteLength>102400):value.result!==null))throw Error('Invalid result response. Refresh before continuing.');
      this.detail.hidden=false;node('scheduled-result-target').textContent=`Original conversation: ${value.chat_jid} · Execution: ${item.execution_id}`;
      node('scheduled-result-state').textContent=`${value.state}${value.result?' · '+value.result.status:''}${value.publication_recorded?' · Publication already recorded; confirming again checks the existing message.':''}`;
      node('scheduled-result-text').textContent=value.result?.text??'';this.status.textContent='';
      if(value.state==='settled'){this.selected={id:item.execution_id,chat:item.chat_jid};this.confirm.disabled=false;}
      node('scheduled-result-detail-heading').focus();
    }catch(error){if(this.active(request.generation)){this.resetDetail();this.status.textContent=(error as Error).message;}}
  }
  private async publishSelected():Promise<void> {
    if(!this.visible()||this.busy||!this.selected||!this.confirm.checked||!this.hooks.lock(true))return;
    const target=this.selected;this.busy=true;this.confirm.checked=false;this.confirm.disabled=true;this.publish.disabled=true;
    const request=this.startRequest();this.status.textContent='Publishing result…';
    try {
      const value=await this.api.request(`/agent/scheduled-results/${encodeURIComponent(target.id)}/publish`,'POST',{confirm:true},request.signal);
      if(!this.active(request.generation))return;
      if(value?.execution_id!==target.id||value.chat_jid!==target.chat||!Number.isSafeInteger(value.message_rowid)||value.message_rowid<=0||typeof value.created!=='boolean')throw Error('Invalid publication response.');
      this.resetDetail();this.status.textContent=`${value.created?'Published':'Publication verified'} as message ${value.message_rowid} in ${target.chat}. Refresh results before another action.`;
    }catch(error){if(this.active(request.generation)){this.resetDetail();this.status.textContent=`${(error as Error).message} Publication may have completed. Refresh results and inspect before confirming again.`;}}
    finally {
      this.busy=false;this.hooks.lock(false);
      if(!this.stopped)await this.hooks.changed();
      if(this.visible())node<HTMLButtonElement>('open-results').disabled=false;
    }
  }
}
