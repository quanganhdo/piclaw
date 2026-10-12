import{afterEach,expect,test}from'bun:test';
import{registerOwnedDictationProvider,selectOwnedDictationProvider,getSelectedDictationProvider,resetDictationProvidersForTests}from'../../web/src/ui/composer-dictation-registry';
afterEach(resetDictationProvidersForTests);
const provider=(id:string)=>({id,label:id,availability:()=>({available:true}),start:async()=>({finish:async()=>({status:'finished' as const}),cancel:async()=>{}})});
test('owner-bound selection rejects duplicate and ambiguous takeover; unregister disables provider',()=>{
 const remove=registerOwnedDictationProvider('owner-one',provider('one'));registerOwnedDictationProvider('owner-two',provider('two'));
 expect(()=>registerOwnedDictationProvider('owner-two',provider('one'))).toThrow('Duplicate');
 expect(()=>selectOwnedDictationProvider('owner-two','one')).toThrow('belongs');
 selectOwnedDictationProvider('owner-one','one');expect(getSelectedDictationProvider()?.owner).toBe('owner-one');
 expect(()=>selectOwnedDictationProvider('owner-two','two')).toThrow('Another');
 remove();remove();expect(getSelectedDictationProvider()).toBeUndefined();
});
