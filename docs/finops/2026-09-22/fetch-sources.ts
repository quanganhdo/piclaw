import {mkdir} from 'node:fs/promises';
const dir=import.meta.dir+'/sources';await mkdir(dir,{recursive:true});
const urls={
'openai-pricing':'https://developers.openai.com/api/docs/pricing.md',
'openai-models':'https://developers.openai.com/api/docs/models.md',
'openai-api-pricing':'https://openai.com/api/pricing/',
'anthropic-pricing':'https://platform.claude.com/docs/en/about-claude/pricing.md',
'anthropic-models':'https://platform.claude.com/docs/en/about-claude/models/overview.md',
'openrouter':'https://openrouter.ai/api/v1/models',
'copilot-pricing':'https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing.md',
'google-pricing':'https://ai.google.dev/gemini-api/docs/pricing',
'groq-pricing':'https://groq.com/pricing',
'cerebras-pricing':'https://www.cerebras.ai/pricing',
'sambanova-pricing':'https://cloud.sambanova.ai/plans/pricing',
'deepseek-pricing':'https://api-docs.deepseek.com/quick_start/pricing',
'xai-pricing':'https://docs.x.ai/developers/models',
'mistral-pricing':'https://mistral.ai/pricing',
'kimi-pricing':'https://platform.kimi.ai/docs/pricing/chat-k3',
'zai-pricing':'https://docs.z.ai/guides/overview/pricing',
};
const results=await Promise.all(Object.entries(urls).map(async([key,url])=>{const time=new Date().toISOString();try{const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(45000)});const text=await r.text();const suffix=key==='openrouter'?'json':(text.trimStart().startsWith('<')?'html':'md');await Bun.write(`${dir}/${key}.${suffix}`,text);const v={key,url,finalUrl:r.url,retrievedAt:time,status:r.status,contentType:r.headers.get('content-type'),file:`${key}.${suffix}`,bytes:Buffer.byteLength(text)};console.log(JSON.stringify(v));return v;}catch(e){const v={key,url,retrievedAt:time,error:e.message};console.log(JSON.stringify(v));return v;}}));await Bun.write(dir+'/fetch-manifest.json',JSON.stringify(results,null,2));
