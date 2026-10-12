import{expect,test}from'bun:test';
import{mkdtempSync,mkdirSync,writeFileSync,rmSync,copyFileSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';
test('packed public declarations compile independently and match core contracts',async()=>{
 const root=join(import.meta.dir,'../../..');const temp=mkdtempSync(join(tmpdir(),'addon-hook-types-'));
 try{
  const archive=join(temp,'piclaw.tgz');const pack=Bun.spawnSync(['bun','pm','pack','--ignore-scripts','--filename',archive],{cwd:root,stdout:'pipe',stderr:'pipe'});if(pack.exitCode)throw Error(pack.stderr.toString());
  const installed=join(temp,'node_modules/piclaw');mkdirSync(installed,{recursive:true});const extract=Bun.spawnSync(['tar','xzf',archive,'--strip-components=1','-C',installed],{stdout:'pipe',stderr:'pipe'});expect(extract.exitCode).toBe(0);
  writeFileSync(join(temp,'consumer.ts'),`import type {ComposerDictationAddonApi,AuthenticatedSocketAddonApi} from 'piclaw/runtime/public/addon-hooks';
export function register(web:ComposerDictationAddonApi,sockets:AuthenticatedSocketAddonApi){
 const dispose=web.registerComposerDictationProvider({id:'test',label:'Test',availability:()=>({available:true}),start:async c=>({finish:async()=>{c.updateSegment({segmentId:'one',text:'final',final:true});return{status:'finished'};},cancel:async()=>{}})});
 const stop=sockets.register({path:'realtime',maxMessageBytes:1024,maxQueuedBytes:4096,maxSessionMs:1000,maxConnections:1,authorize:async()=>({chatJid:'web:test'}),open:async c=>({message:async frame=>{await c.send(frame);},dispose:async()=>{}})});return()=>{dispose();stop();};}
`);
  const compile=Bun.spawnSync(['bun',join(root,'node_modules/typescript/bin/tsc'),'--noEmit','--strict','--skipLibCheck','--moduleResolution','bundler','--module','esnext','--target','es2022','--lib','ES2022,DOM',join(temp,'consumer.ts')],{cwd:temp,stdout:'pipe',stderr:'pipe'});if(compile.exitCode)throw Error(compile.stdout.toString()+compile.stderr.toString());expect(compile.exitCode).toBe(0);
  const parity=join(root,'runtime/src/.public-hook-parity.ts');writeFileSync(parity,`import type {ComposerDictationProvider as P,AuthenticatedAddonSocketRegistration as S} from '../public/addon-hooks';import type {ComposerDictationProvider as C} from '../web/src/ui/composer-dictation';import type {AuthenticatedAddonSocketRegistration as D} from './addons/authenticated-socket';type Assert<T extends true>=T;export type Parity=[Assert<P extends C?true:false>,Assert<C extends P?true:false>,Assert<S extends D?true:false>,Assert<D extends S?true:false>];`);
  try{const check=Bun.spawnSync(['bun',join(root,'node_modules/typescript/bin/tsc'),'--noEmit','-p',join(root,'runtime/tsconfig.json')],{cwd:root,stdout:'pipe',stderr:'pipe'});if(check.exitCode)throw Error(check.stdout.toString()+check.stderr.toString());expect(check.exitCode).toBe(0);}finally{rmSync(parity,{force:true});}
 }finally{rmSync(temp,{recursive:true,force:true});}
},30000);
