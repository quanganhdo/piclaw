import {expect,mock,test} from 'bun:test';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {formatToolName,isToolAllowed}=require('pi-mcp-adapter/types') as any;
const {reconstructToolMetadata}=require('pi-mcp-adapter/metadata-cache') as any;
const {executeCall,executeDescribe,executeList,executeSearch}=require('../../../node_modules/pi-mcp-adapter/proxy-modes.ts') as any;

test('raw and prefixed selectors preserve inclusion AND NOT exclusion with * and ?',()=>{
 expect(isToolAllowed('read-a','work-iq','server',['read-?'],[])).toBe(true);
 expect(isToolAllowed('read-ab','work-iq','server',['read-?'],[])).toBe(false);
 expect(isToolAllowed('retrieve','work-iq','server',[formatToolName('retrieve','work-iq','server')],[])).toBe(true);
 expect(isToolAllowed('retrieve','work-iq','server',['*'],['retrieve'])).toBe(false);
 expect(isToolAllowed('delete-secret','work-iq','server',['delete-*'],['*-secret'])).toBe(false);
 expect(isToolAllowed('anything','work-iq','server',[],[])).toBe(true);
});

test('cached tools and resources are filtered before list/search/describe/call surfaces',async()=>{
 const definition={command:'workiq',includeTools:['retrieve','read_public_*'],excludeTools:['*_secret']};
 const entry:any={configHash:'fixture',cachedAt:Date.now(),tools:[{name:'retrieve',description:'Read data',inputSchema:{type:'object'}},{name:'delete_secret',description:'Delete private data'}],resources:[{uri:'doc://public',name:'public docs',description:'Public'},{uri:'doc://private',name:'admin secret',description:'Private'}]};
 const metadata=reconstructToolMetadata('workiq',entry,'server',definition);
 expect(metadata.map((item:any)=>item.originalName)).toEqual(['retrieve','read_public_docs']);
 const getConnection=mock(()=>undefined),connect=mock();
 const state:any={config:{settings:{toolPrefix:'server'},mcpServers:{workiq:definition}},manager:{getConnection,isConnecting:()=>false,connect,touch:mock(),incrementInFlight:mock(),decrementInFlight:mock()},toolMetadata:new Map([['workiq',metadata]]),resourceCounts:new Map([['workiq',1]]),serverInstructions:new Map(),failureTracker:new Map(),failureMessages:new Map(),completedUiSessions:[]};
 expect((executeList(state,'workiq').details as any).tools).toEqual(metadata.map((item:any)=>item.name));
 expect((executeSearch(state,'private').details as any).matches).toEqual([]);
 expect((executeDescribe(state,formatToolName('delete_secret','workiq','server')).details as any).error).toBe('tool_not_found');
 const denied=await executeCall(state,formatToolName('delete_secret','workiq','server'),{});
 expect((denied.details as any).error).toBe('tool_not_found');expect(connect).not.toHaveBeenCalled();
});
