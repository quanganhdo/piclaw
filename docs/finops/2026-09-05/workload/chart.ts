import assert from 'node:assert/strict';
const d=await Bun.file(`${import.meta.dir}/scenario.json`).json();
const labels={fable:'Fable 5.1',astra:'Astra',old:'Fable 5',sol:'Sol',terra:'Terra',deep:'DeepSeek Pro 0813',kimi:'Kimi K3',mini:'MiniMax M3',flash:'DeepSeek Flash 0731'};
const short=[['Difficult debugging','Multi-file refactors'],['Routine coding','Tests & reviews'],['Infrastructure','Diagnosis & scripting'],['Research','Document synthesis'],['Small tasks','Extraction & summaries']];
const colors={frontier:'#537eab',precursor:'#ae7c3e',open:'#378773',recommended:'#707a8b'};
const esc=(s:any)=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const money=(v:number)=>`$${v.toFixed(2)}`;const taskMoney=(v:number)=>`$${v.toFixed(v<.01?4:3)}`;
const parts:string[]=[];
const text=(x:number,y:number,s:string,size=16,cls='text',extra='')=>parts.push(`<text x="${x}" y="${y}" font-size="${size}" class="${cls}" ${extra}>${esc(s)}</text>`);
const rect=(x:number,y:number,w:number,h:number,attrs='')=>parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" ${attrs}/>`);
rect(0,0,1240,1310,'class="background"');
text(40,58,'Which model for which workload?',32,'text strong');
text(40,90,'2–3 hours of moderate use per day · our caching ratio · prices as of 5 Sep 2026',17,'muted');
text(40,133,'MONTHLY API ESTIMATE',14,'muted strong');
text(1200,133,'Baseline: 2.5h/day · 8 tasks/day · 30 days',14,'muted','text-anchor="end"');
const sx=340,scale=6;
for(const tick of [0,25,50,75,100,125]){const x=sx+tick*scale;parts.push(`<path d="M${x} 147V333" class="grid"/>`);text(x,356,`$${tick}`,13,'muted','text-anchor="middle"');}
const monthly=[['Frontier choices',d.profiles.frontierByWorkload,'frontier'],['Precursor choices',d.profiles.precursorByWorkload,'precursor'],['Open-weight choices',d.profiles.openByWorkload,'open'],['Recommended mix',d.profiles.recommended,'recommended']];
monthly.forEach(([label,cost,key],i)=>{const y=159+i*44;assert(Number(cost)>=0&&Number(cost)<=125);text(40,y+20,String(label),18,key==='recommended'?'text strong':'text');rect(sx,y,Number(cost)*scale,28,`rx="4" fill="${colors[key]}"`);text(sx+Number(cost)*scale+12,y+20,money(Number(cost)),18,'text strong');});
parts.push('<path d="M40 384H1200" class="grid"/>');
text(40,422,'WORKLOAD RANKINGS',14,'muted strong');
text(1200,422,'1 → 2: suggested trial order · prices are USD per task',14,'muted','text-anchor="end"');
const columns=[['frontier','FRONTIER',244],['precursor','PRECURSOR',566],['open','OPEN WEIGHTS',888]];
for(const [key,name,x] of columns){rect(Number(x),442,312,32,`rx="5" fill="${colors[key]}" fill-opacity=".13"`);text(Number(x)+14,464,String(name),15,'text strong');}
let cells=0;
d.assumptions.rows.forEach((row:any,i:number)=>{
 const y=490+i*128;text(40,y+28,short[i][0],18,'text strong');text(40,y+53,short[i][1],15,'muted');text(40,y+82,`${row.tasks} task${row.tasks>1?'s':''}/day · ${row.minutes} min each`,13,'muted');
 for(const [key,_name,pos] of columns){const x=Number(pos),chosen=row[key][0]===row.default;rect(x,y,312,110,`rx="7" class="${chosen?'selected':'cell'}"`);if(chosen)text(x+12,y+19,'START HERE',10,'accent strong');else text(x+12,y+19,'ALTERNATIVES',10,'muted');
 row[key].forEach((model:string,rank:number)=>{const yy=y+46+rank*36;const cost=d.costsPerTask[i].usd[model];assert(Number.isFinite(cost));text(x+12,yy,`${rank+1} · ${labels[model]}`,15,rank===0?'text strong':'muted');text(x+300,yy,taskMoney(cost),15,rank===0?'text numeric':'muted numeric','text-anchor="end"');});cells++;}
});
parts.push('<path d="M40 1150H1200" class="grid"/>');
text(40,1182,`Cache mix: ${(d.assumptions.cacheShares.read*100).toFixed(2)}% reads · ${(d.assumptions.cacheShares.write*100).toFixed(2)}% writes · ${(d.assumptions.cacheShares.input*100).toFixed(2)}% uncached prompt`,15,'text');
text(40,1209,'Rankings are editorial trial recommendations, not measured quality scores. Task sizes are assumptions, not ledger volumes.',14,'muted');
text(40,1236,'Sol: OpenRouter rates. Terra: native OpenAI. Open weights: OpenRouter. Fable/Astra: native-equivalent rates.',14,'muted');
text(40,1263,'No subscription allowances deducted. Excludes tax, funding/tool fees and retries; missing cache tariffs use ordinary input.',14,'muted');
text(40,1290,'Full assumptions, route prices and plan-fit caveats: workload-model-rankings.html',13,'muted');
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="1310" viewBox="0 0 1240 1310" role="img" aria-labelledby="title desc"><title id="title">Model rankings and costs by workload</title><desc id="desc">Monthly API cost: frontier ${money(d.profiles.frontierByWorkload)}, precursor ${money(d.profiles.precursorByWorkload)}, open weights ${money(d.profiles.openByWorkload)}, recommended mix ${money(d.profiles.recommended)}. Five workloads each show two ranked model choices per class with task costs. Highlighted cells indicate recommended starting models. Estimates assume 2.5 hours daily and our cache ratios, not historical usage volume.</desc><style>text{font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.background{fill:#f7f8fa}.text{fill:#263342}.muted{fill:#566475}.strong{font-weight:600}.numeric{font-variant-numeric:tabular-nums}.cell{fill:white;stroke:#d9e0e8}.selected{fill:#edf7f3;stroke:#378773;stroke-width:1.5}.accent{fill:#276857}.grid{fill:none;stroke:#dce2e9;stroke-width:1}@media(prefers-color-scheme:dark){.background{fill:#111923}.text{fill:#e6edf5}.muted{fill:#b0bdcc}.cell{fill:#192431;stroke:#354557}.selected{fill:#17382f;stroke:#6ec6ac}.accent{fill:#83d9bf}.grid{stroke:#354252}}</style>${parts.join('\n')}</svg>`;
assert.equal(cells,15);assert(!/NaN|undefined/.test(svg));
await Bun.write(`${import.meta.dir}/workload-model-rankings.svg`,svg);
console.log('PASS: 15 ranking cells, 30 task-cost labels, 4 source-matched monthly bars. SVG written.');
