import { afterEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { IntelGpuAccounting, emptyCoverage, parseDrmClient, type DrmClient, type IntelDevice } from "../../../src/channels/web/agent/intel-gpu-accounting.js";
import { IntelDrmReader, IntelGpuMetrics, procStartTime, staleGpuSnapshots } from "../../../src/channels/web/agent/intel-gpu-metrics.js";
const device: IntelDevice = { id: "0000:00:02.0", name: "Intel GPU", driver: "i915", render_node: "renderD128" };
const text = (busy = "0", extra = "") => `drm-driver: i915\ndrm-pdev: ${device.id}\ndrm-client-id: 1\ndrm-engine-render: ${busy} ns\ndrm-resident-system0: 64 KiB\ndrm-total-system0: 2 MiB\n${extra}`;
const client = (busy = "0", extra = "", owner = "10:123") => parseDrmClient(text(busy, extra), device.id, owner)!;
const samples = (a: IntelGpuAccounting, c: DrmClient[], ms: number, coverage = emptyCoverage()) => a.sample([device], c, coverage, ms, ms + 10000)[0];
const roots: string[] = [];
const samplers: IntelGpuMetrics[] = [];
afterEach(async () => { for (const s of samplers.splice(0)) s.stop(); for (const p of roots.splice(0)) await fs.rm(p, { recursive: true, force: true }); });

test("DRM parser preserves bigint, units and memory subsets", () => {
 const p=client("9007199254740993123", "drm-active-system0: 123 KiB\ndrm-purgeable-system0: 4 KiB\ndrm-shared-system0: 1 KiB\ndrm-engine-capacity-video: 2");
 expect(p.engines.get("render")).toBe(9007199254740993123n);
 expect(p.regions.get("system0")).toEqual({resident_bytes:65536,total_bytes:2097152,shared_bytes:1024});
 expect(p.capacities.get("video")).toBe(2); expect(p.invalid).toBe(false);
 expect(parseDrmClient(text().replace('i915','xe'),device.id,'x')).toBeNull();
 expect(parseDrmClient(text(),"0000:03:00.0",'x')).toBeNull();
 expect(client('0','drm-resident-local: 1 GB').invalid).toBe(true);
 expect(client('0','drm-engine-capacity-render: 0').invalid).toBe(true);
 expect(client('0','drm-engine-render: 1 ns').invalid).toBe(true);
});

test("first sample unknown; exact busy deltas; descriptor dedup; capacity normalisation", () => {
 const a=new IntelGpuAccounting();
 expect(samples(a,[client('0')],0).busy_percent).toBeNull();
 const extra='drm-engine-video: 1000000000 ns\ndrm-engine-capacity-video: 2';
 const second=samples(a,[client('1000000000'),client('1000000000','','20:456')],2000);
 expect(second.busy_percent).toBe(50);expect(second.coverage.clients).toBe(1);expect(second.memory.resident_bytes).toBe(65536);
 samples(a,[client('1000000000',extra)],4000);
 const last=samples(a,[client('1000000000',extra.replace('1000000000 ns','3000000000 ns'))],6000);
 expect(last.engines.find(e=>e.name==='video')?.busy_percent).toBe(50);
 expect(last.busy_percent).toBe(50);
});

test("counter regressions retain high water and recovered interval remains a gap", () => {
 const a=new IntelGpuAccounting(); samples(a,[client('100')],0);
 expect(samples(a,[client('90')],2000).busy_percent).toBeNull();
 expect(samples(a,[client('200')],4000).busy_percent).toBeNull();
 expect(samples(a,[client('200000200')],6000).busy_percent).toBe(10);
});

test("process/client churn, missing samples and old series never create spikes", () => {
 const a=new IntelGpuAccounting(3);samples(a,[client('0')],0);
 expect(samples(a,[client('1000000000','','10:999')],2000).busy_percent).toBeNull();
 const absent=samples(a,[],4000);expect(absent.status).toBe('unavailable');expect(absent.memory.resident_bytes).toBeNull();
 expect(samples(a,[client('2000000000','','10:999')],6000).busy_percent).toBeNull();
 const gap=samples(a,[client('3000000000','','10:999')],16000);expect(gap.busy_percent).toBeNull();expect(gap.history).toHaveLength(3);
});

test("invalid and >100% intervals are unknown; inaccessible discovery is partial", () => {
 const a=new IntelGpuAccounting();samples(a,[client()],0);
 const invalid=samples(a,[client('3000000000')],2000);
 expect(invalid.busy_percent).toBeNull();expect(invalid.status).toBe('partial');
 const c={...emptyCoverage(),unreadable_processes:4,truncated:true};
 const ok=samples(a,[client('3000000000')],4000,c);expect(ok.busy_percent).toBe(0);expect(ok.status).toBe('partial');
 expect(ok.coverage.scope).toBe('observed-clients');
});

test("devices never aggregate; missing memory stays null, not zero", () => {
 const a=new IntelGpuAccounting(),d2={...device,id:'0000:03:00.0'};
 const noMemory=client();noMemory.regions.clear();
 const result=a.sample([device,d2],[noMemory],emptyCoverage(),0,0);
 expect(result).toHaveLength(2);expect(result[0].memory.resident_bytes).toBeNull();expect(result[1].status).toBe('unavailable');
 expect(a.sample([],[],emptyCoverage(),2000,2000)).toEqual([]);
});

test("stale cached values are explicitly unavailable", () => {
 const a=new IntelGpuAccounting();samples(a,[client()],0);const s=samples(a,[client('1000000000')],2000);
 const stale=staleGpuSnapshots([s],20000)[0];expect(stale.status).toBe('stale');expect(stale.busy_percent).toBeNull();expect(stale.memory.resident_bytes).toBeNull();
});

test("same cached sampler handles many consumers without overlapping scans and expires idle demand", async () => {
 let count=0,active=0,peak=0;
 const s=new IntelGpuMetrics({scan:async()=>{count++;active++;peak=Math.max(peak,active);await Bun.sleep(8);active--;return {devices:[],clients:[],coverage:emptyCoverage()};}},()=>performance.now(),()=>Date.now(),5,25);samplers.push(s);
 for(let i=0;i<30;i++)expect(s.read()).toEqual([]);
 expect(count).toBe(0);
 await Bun.sleep(75);const completed=count;
 expect(completed).toBeGreaterThan(0);expect(peak).toBe(1);
 await Bun.sleep(30);expect(count).toBe(completed);
 s.stop();expect(s.read()).toEqual([]);
});

test("proc stat parser allows parentheses/spaces in comm", () => {
 expect(procStartTime(`10 (a ) b) S ${Array(18).fill('0').join(' ')} 999 0`)).toBe('999');
 expect(procStartTime('bad')).toBeNull();
});

test("reader uses owned proc/sys fixtures and absent hardware returns no GPU", async () => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'intel-meters-'));roots.push(root);
 const proc=path.join(root,'proc'),sys=path.join(root,'drm');await fs.mkdir(proc);await fs.mkdir(sys);
 const r=new IntelDrmReader(proc,sys,()=>0,'linux');expect((await r.scan()).devices).toEqual([]);
 const dev=path.join(sys,'renderD128','device');await fs.mkdir(dev,{recursive:true});await fs.writeFile(path.join(dev,'vendor'),'0x8086\n');await fs.writeFile(path.join(dev,'uevent'),`PCI_SLOT_NAME=${device.id}\n`);await fs.symlink('/sys/bus/pci/drivers/i915',path.join(dev,'driver'));
 const base=path.join(proc,'10');await fs.mkdir(path.join(base,'fdinfo'),{recursive:true});await fs.mkdir(path.join(base,'fd'));await fs.writeFile(path.join(base,'stat'),`10 (worker) S ${Array(18).fill('0').join(' ')} 123 0`);await fs.symlink('/dev/dri/renderD128',path.join(base,'fd','9'));await fs.writeFile(path.join(base,'fdinfo','9'),text());
 const scan=await new IntelDrmReader(proc,sys,()=>0,'linux').scan();expect(scan.devices).toHaveLength(1);expect(scan.clients).toHaveLength(1);expect(scan.clients[0].owners).toEqual(['10:123']);
 expect((await new IntelDrmReader(proc,sys,()=>0,'darwin').scan()).devices).toEqual([]);
});

test("availability gates reject other vendors/drivers and detect removal/reappearance", async () => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'intel-gates-'));roots.push(root);
 const proc=path.join(root,'proc'),sys=path.join(root,'drm'),dev=path.join(sys,'renderD128','device');
 await fs.mkdir(proc);await fs.mkdir(dev,{recursive:true});
 await fs.writeFile(path.join(dev,'uevent'),`PCI_SLOT_NAME=${device.id}\n`);
 await fs.symlink('/sys/bus/pci/drivers/i915',path.join(dev,'driver'));
 let now=0;const reader=new IntelDrmReader(proc,sys,()=>now,'linux');
 await fs.writeFile(path.join(dev,'vendor'),'0x10de');expect((await reader.scan()).devices).toEqual([]);
 await fs.writeFile(path.join(dev,'vendor'),'0x8086');await fs.unlink(path.join(dev,'driver'));await fs.symlink('/sys/bus/pci/drivers/xe',path.join(dev,'driver'));
 now+=31000;expect((await reader.scan()).devices).toEqual([]);
 await fs.unlink(path.join(dev,'driver'));await fs.symlink('/sys/bus/pci/drivers/i915',path.join(dev,'driver'));
 now+=31000;const present=await reader.scan();expect(present.devices).toHaveLength(1);expect(present.clients).toEqual([]);
 await fs.rm(path.join(sys,'renderD128'),{recursive:true});now+=31000;expect((await reader.scan()).devices).toEqual([]);
 await fs.mkdir(dev,{recursive:true});await fs.writeFile(path.join(dev,'vendor'),'0x8086');await fs.writeFile(path.join(dev,'uevent'),'PCI_SLOT_NAME=not-a-pci-device\n');await fs.symlink('/sys/bus/pci/drivers/i915',path.join(dev,'driver'));
 now+=31000;expect((await reader.scan()).devices).toEqual([]);
 await fs.writeFile(path.join(dev,'uevent'),`PCI_SLOT_NAME=${device.id}\n`);now+=31000;expect((await reader.scan()).devices).toHaveLength(1);
});

test("bounded reads, fd disappearance and PID reuse lose coverage instead of fabricating idle", async () => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'intel-client-gates-'));roots.push(root);
 const proc=path.join(root,'proc'),sys=path.join(root,'drm'),dev=path.join(sys,'renderD128','device'),base=path.join(proc,'10');
 await fs.mkdir(dev,{recursive:true});await fs.mkdir(path.join(base,'fd'),{recursive:true});await fs.mkdir(path.join(base,'fdinfo'));
 await fs.writeFile(path.join(dev,'vendor'),'0x8086');await fs.writeFile(path.join(dev,'uevent'),`PCI_SLOT_NAME=${device.id}\n`);await fs.symlink('/sys/bus/pci/drivers/i915',path.join(dev,'driver'));
 const stat=(start:number)=>`10 (worker) S ${Array(18).fill('0').join(' ')} ${start} 0`;
 await fs.writeFile(path.join(base,'stat'),stat(123));await fs.symlink('/dev/dri/renderD128',path.join(base,'fd','9'));await fs.writeFile(path.join(base,'fdinfo','9'),text());
 let now=0;const reader=new IntelDrmReader(proc,sys,()=>now,'linux');expect((await reader.scan()).clients).toHaveLength(1);
 await fs.writeFile(path.join(base,'fdinfo','9'),'x'.repeat(16385));now=2000;const large=await reader.scan();expect(large.clients).toEqual([]);expect(large.coverage.unreadable_clients).toBeGreaterThan(0);
 await fs.writeFile(path.join(base,'fdinfo','9'),text());now=4000;expect((await reader.scan()).clients).toHaveLength(1);
 await fs.writeFile(path.join(base,'stat'),stat(456));now=6000;const reused=await reader.scan();expect(reused.clients).toEqual([]);expect(reused.coverage.unreadable_clients).toBeGreaterThan(0);
 await fs.unlink(path.join(base,'fdinfo','9'));now=8000;const gone=await reader.scan();expect(gone.clients).toEqual([]);expect(gone.coverage.unreadable_clients).toBeGreaterThan(0);
});

test("partial device discovery retains all known devices until complete removal evidence", async () => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'intel-partial-devices-'));roots.push(root);
 const proc=path.join(root,'proc'),sys=path.join(root,'drm');await fs.mkdir(proc);await fs.mkdir(sys);
 for(const [node,id] of [['renderD128',device.id],['renderD129','0000:03:00.0']]) {
  const dev=path.join(sys,node,'device');await fs.mkdir(dev,{recursive:true});
  await fs.writeFile(path.join(dev,'vendor'),'0x8086');await fs.writeFile(path.join(dev,'uevent'),`PCI_SLOT_NAME=${id}\n`);
  await fs.symlink('/sys/bus/pci/drivers/i915',path.join(dev,'driver'));
 }
 let now=0;const reader=new IntelDrmReader(proc,sys,()=>now,'linux');expect((await reader.scan()).devices).toHaveLength(2);
 await fs.unlink(path.join(sys,'renderD129','device','uevent'));now=31000;
 const partial=await reader.scan();expect(partial.devices).toHaveLength(2);expect(partial.coverage.truncated).toBe(true);
 await fs.rm(path.join(sys,'renderD129'),{recursive:true});now=37000;
 const complete=await reader.scan();expect(complete.devices).toHaveLength(1);expect(complete.devices[0].id).toBe(device.id);expect(complete.coverage.truncated).toBe(false);
});

test("conflicting capacity and missing engine fields never produce a zero headline", () => {
 const a=new IntelGpuAccounting(),other=client('0','drm-engine-capacity-render: 2','20:123');other.id='2';
 samples(a,[client(),other],0);const mismatch=samples(a,[client('100'),{...other,engines:new Map([['render',100n]])}],2000);
 expect(mismatch.busy_percent).toBeNull();expect(mismatch.reasons).toContain('Inconsistent engine capacity');
 const b=new IntelGpuAccounting(),noEngines=client();noEngines.id='3';noEngines.engines.clear();samples(b,[client(),noEngines],0);
 expect(samples(b,[client('0'),noEngines],2000).busy_percent).toBeNull();
});
