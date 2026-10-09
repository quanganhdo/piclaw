import { expect, test } from 'bun:test';
import { normalizeIntelGpuSnapshots, normalizeGpuSnapshots, getGpuMeterRows, GpuMeterHistory, formatOptionalPercent, formatOptionalBytesCompact, buildNullableSparklinePath, buildIntelGpuCompactSummaryParts } from '../../web/src/components/intel-gpu-meters.ts';
const gpu = (patch = {}) => ({id:'0000:00:02.0',name:'Intel GPU',provider:'intel-drm-fdinfo',driver:'i915',sample_time_ms:1000,status:'ok',reasons:[],busy_percent:63,engines:[{name:'render',capacity:1,busy_percent:63}],memory:{resident_bytes:677*1024**2,total_bytes:800*1024**2,shared_bytes:null},coverage:{clients:3,scanned_processes:100,unreadable_processes:0,unreadable_clients:0,truncated:false},history:[{timestamp_ms:0,busy_percent:null,resident_bytes:null},{timestamp_ms:1000,busy_percent:63,resident_bytes:677*1024**2}],...patch});
test('no GPU, no Intel rows or detail controls',()=>{expect(normalizeIntelGpuSnapshots(undefined)).toEqual([]);expect(normalizeIntelGpuSnapshots([])).toEqual([]);expect(buildIntelGpuCompactSummaryParts([])).toEqual([]);expect(normalizeIntelGpuSnapshots([{}])).toEqual([])});
test('null/invalid counters never become zero',()=>{for(const v of [null,undefined,'',NaN,-1,101])expect(formatOptionalPercent(v)).toBe('—');expect(formatOptionalPercent(0)).toBe('0%');expect(formatOptionalBytesCompact(null)).toBe('—');expect(formatOptionalBytesCompact(0)).toBe('0B')});
test('GPU rows preserve backend unknown headline and sparse histories',()=>{const [m]=normalizeIntelGpuSnapshots([gpu({busy_percent:null})],{nowMs:2000});expect(m.rows.busyText).toBe('—');expect(m.rows.residentText).toBe('677M');expect(m.rows.gpuLabel).toBe('GPU');expect(m.coverageText).toContain('best-effort');expect(m.coverageText).not.toContain('coverage complete');expect(m.memoryWarningText).toContain('shared buffers');expect(m.rows.busySparkPath).not.toContain('NaN')});
test('stale samples and failed transport suppress current values and graphs',()=>{const [m]=normalizeIntelGpuSnapshots([gpu()],{nowMs:9000,lastSuccessAtMs:1000});expect(m.effectiveStatus).toBe('stale');expect(m.rows.busyText).toBe('—');expect(m.rows.residentText).toBe('—');expect(m.rows.busySparkPath).toBe('');expect(m.engines[0].busyPercent).toBeNull()});
test('multiple devices remain separate and unknown clients do not imply idle',()=>{const meters=normalizeIntelGpuSnapshots([gpu(),gpu({id:'0000:03:00.0',status:'unavailable',coverage:{clients:0}})],{nowMs:2000});expect(meters).toHaveLength(2);expect(meters[0].rows.gpuLabel).toBe('GPU0');expect(meters[1].rows.busyText).toBe('—');expect(meters[1].noVisibleClientsText).toContain('No visible clients');expect(buildIntelGpuCompactSummaryParts(meters)).toHaveLength(2)});
test('nullable sparkline draws separate segments instead of bridging gaps',()=>{const p=buildNullableSparklinePath([20,null,60],56,16,{min:0,max:100});expect((p.match(/M /g)||[]).length).toBe(2);expect(p).not.toContain('NaN');expect(buildNullableSparklinePath([null,null])).toBe('')});
test('single samples and 0/100 percent extremes have visible in-bounds strokes',()=>{
 expect(buildNullableSparklinePath([0],56,16,{min:0,max:100})).toBe('M 0 15.00 L 56 15.00');
 expect(buildNullableSparklinePath([100],56,16,{min:0,max:100})).toBe('M 0 1.00 L 56 1.00');
 expect(buildNullableSparklinePath([1024])).toBe('M 0 8.00 L 56 8.00');
 expect(buildNullableSparklinePath([null,0,null],56,16,{min:0,max:100})).toBe('M 28.00 15.00 L 28.01 15.00');
});
test('rows require current readings and drawable history; valid current-only snapshots render',()=>{
 const[empty]=normalizeGpuSnapshots([gpu({history:[{busy_percent:null,resident_bytes:null}]})],{nowMs:2000});expect(getGpuMeterRows(empty)).toEqual([]);
 const[current]=normalizeGpuSnapshots([gpu({history:[],busy_percent:0})],{nowMs:2000});expect(getGpuMeterRows(current)).toHaveLength(2);expect(current.rows.busySparkPath).toBe('M 0 15.00 L 56 15.00');
});
test('Intel and NVIDIA rows retain proven capability through unavailable/stale samples',()=>{
 for(const provider of ['intel-drm-fdinfo','nvml']) {
  const history=new GpuMeterHistory(), fresh=gpu({provider});
  const[initial]=history.update([fresh],{nowMs:2000});expect(getGpuMeterRows(initial)).toHaveLength(2);
  const missing=gpu({provider,status:'unavailable',sample_time_ms:3000,busy_percent:null,memory:{resident_bytes:null},history:[]});
  const[unknown]=history.update([missing],{nowMs:3001});expect(getGpuMeterRows(unknown).map(row=>row.value)).toEqual(['—','—']);expect(unknown.rows.busySparkPath).not.toBe('');
  const before=unknown.rows.busySparkPath;const[rerender]=history.update([missing],{nowMs:3001});expect(rerender.rows.busySparkPath).toBe(before);
  expect(history.update([],{nowMs:4000})).toEqual([]);
  const[returnedUnknown]=history.update([missing],{nowMs:4001});expect(getGpuMeterRows(returnedUnknown)).toEqual([]);
  history.update([fresh],{nowMs:2000});const[stale]=history.update([fresh],{nowMs:10000});expect(getGpuMeterRows(stale)).toHaveLength(2);expect(stale.rows.busyText).toBe('—');
  expect(history.update([gpu({provider,disabled:true})],{nowMs:2000})).toEqual([]);
 }
});
test('only proven metric sticks and eventually ages to an empty history without disappearing',()=>{
 const history=new GpuMeterHistory();history.update([gpu({memory:{resident_bytes:null}})],{nowMs:2000});
 let meter;for(let i=0;i<35;i++)[meter]=history.update([gpu({sample_time_ms:3000+i*2000,status:'unavailable',busy_percent:null,memory:{resident_bytes:null}})],{nowMs:3001+i*2000});
 expect(getGpuMeterRows(meter).map(row=>row.key)).toEqual(['busy']);expect(meter.rows.busySparkPath).toBe('');expect(meter.rows.busyText).toBe('—');
});
test('disabled and unavailable GPU lines are omitted while valid zero readings remain',()=>{
 const [unknown]=normalizeGpuSnapshots([gpu({busy_percent:null,memory:{resident_bytes:null}})],{nowMs:2000});expect(getGpuMeterRows(unknown)).toEqual([]);
 const [activity]=normalizeGpuSnapshots([gpu({busy_percent:0,memory:{resident_bytes:null}})],{nowMs:2000});expect(getGpuMeterRows(activity).map(row=>row.key)).toEqual(['busy']);expect(getGpuMeterRows(activity)[0].value).toBe('0%');
 expect(normalizeGpuSnapshots([gpu({disabled:true}),gpu({enabled:false}),gpu({status:'disabled'})],{nowMs:2000})).toEqual([]);
});
test('GPU display supports non-Intel snapshots without asserting observed-client memory semantics',()=>{
 const [meter]=normalizeGpuSnapshots([{id:'nvidia-0',name:'NVIDIA GPU',provider:'nvml',driver:'nvidia',status:'ok',sample_time_ms:1000,busy_percent:40,memory:{used_bytes:1024,total_bytes:4096},history:[]}],{nowMs:2000});
 expect(meter.name).toBe('NVIDIA GPU');expect(meter.rows.gpuLabel).toBe('GPU');expect(meter.rows.gmemLabel).toBe('VRAM');expect(meter.memoryWarningText).not.toContain('Client-reported');expect(meter.coverageText).toBe('');expect(getGpuMeterRows(meter)).toHaveLength(2);
});
test('absent refresh time is not epoch zero; true transport staleness still removes row availability',()=>{
 const [fresh]=normalizeGpuSnapshots([gpu({sample_time_ms:100000})],{nowMs:100001,lastSuccessAtMs:null});expect(getGpuMeterRows(fresh)).toHaveLength(2);const[stale]=normalizeGpuSnapshots([gpu({sample_time_ms:100000})],{nowMs:110000,lastSuccessAtMs:100000});expect(getGpuMeterRows(stale)).toEqual([]);
});
test('non-Intel observed-client telemetry keeps its memory caveat without a vendor assumption',()=>{
 const[meter]=normalizeGpuSnapshots([gpu({name:'AMD GPU',provider:'amd-drm-fdinfo',driver:'amdgpu'})],{nowMs:2000});expect(meter.rows.gmemLabel).toBe('GMEM');expect(meter.memoryWarningText).toContain('Observed client');expect(meter.name).toBe('AMD GPU');
});
