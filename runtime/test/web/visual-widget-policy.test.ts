import {expect,test} from 'bun:test';
import {buildWidgetOpenDetail,buildWidgetTabFromOpenDetail} from '../../web/static/visual/frontend/src/app/widgetOpen';
import {getGeneratedWidgetSandbox} from '../../web/src/ui/generated-widget-policy';
test('Visual tabs preserve live, static and explicitly interactive message policies',()=>{
 for(const [source,capabilities,interactive]of [['live',[],true],['message',[],false],['message',['interactive'],true]] as const){
  const detail=buildWidgetOpenDetail({type:'generated_widget',source,capabilities:[...capabilities],artifact:{kind:'html',html:'<p>widget</p>'}})!;
  const tab=buildWidgetTabFromOpenDetail(detail)!;
  expect(tab.widgetSource).toBe(source);expect(tab.widgetCapabilities).toEqual([...capabilities]);
  expect(getGeneratedWidgetSandbox({source:tab.widgetSource,kind:tab.widgetKind,capabilities:tab.widgetCapabilities}).includes('allow-scripts')).toBe(interactive);
 }
 const tab=buildWidgetTabFromOpenDetail({html:'preview',capabilities:['interactive',3] as any})!;
 expect(tab.widgetSource).toBe('message');expect(tab.widgetCapabilities).toEqual(['interactive']);
});

test('legacy interactive opt-in matches Classic without overriding explicit capabilities',()=>{
 expect(buildWidgetTabFromOpenDetail({html:'legacy',interactive:true})!.widgetCapabilities).toEqual(['interactive']);
 expect(buildWidgetTabFromOpenDetail({html:'static',interactive:true,capabilities:[]})!.widgetCapabilities).toEqual([]);
});
