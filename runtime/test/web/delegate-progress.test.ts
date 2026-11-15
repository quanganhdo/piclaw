import {expect,test} from 'bun:test';
import {resolveDelegateProgressRows as rows} from '../../web/src/ui/delegate-progress.ts';
const child=(id:string,extra:Record<string,unknown>={})=>({tool_call_id:id,model:'provider/model',phase:'generating',tools:[],elapsedSeconds:0,responseChars:0,...extra});
test('native public child rows preserve opaque IDs and completed siblings',()=>{
 const result=rows([child('call_a|fc_1',{phase:'done',elapsedSeconds:61,responseChars:1234}),child('call_b|fc_2',{phase:'tool',tools:['read']})]);
 expect(result).toEqual([
  {id:'call_a|fc_1',label:'Delegate 1/2',model:'provider/model',phase:'done',detail:'Complete · 1m 1s · 1,234 response characters'},
  {id:'call_b|fc_2',label:'Delegate 2/2',model:'provider/model',phase:'tool',detail:'Running read · 0s'},
 ]);
});
test('invalid wire values are not rendered and metadata is bounded',()=>{
 for(const value of [null,{},'unsafe',1])expect(rows(value)).toEqual([]);
 expect(rows([null,child('id',{model:'<img src=x>'}),child('id',{phase:'thought'}),child('id\n'),child('x'.repeat(513))])).toEqual([]);
 expect(rows([child('same'),child('same')])).toHaveLength(1);
 expect(rows(Array.from({length:100},(_,i)=>child(String(i))))).toHaveLength(32);
});
test('untrusted child output/reasoning and invalid counters never become progress text',()=>{
 const result=rows([child('id',{phase:'tool',tools:['read','<script>','bad\n'],elapsedSeconds:NaN,responseChars:Infinity,thinking:'PRIVATE_SENTINEL',text:'PRIVATE_SENTINEL',output:'PRIVATE_SENTINEL',detail:'PRIVATE_SENTINEL'})]);
 expect(result[0]?.detail).toBe('Running read');expect(JSON.stringify(result)).not.toContain('PRIVATE_SENTINEL');
 expect(rows([child('id',{elapsedSeconds:-1,responseChars:1.1})])[0]?.detail).toBe('Generating response');
});
