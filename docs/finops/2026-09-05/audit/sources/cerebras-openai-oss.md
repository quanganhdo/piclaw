> ## Documentation Index
> Fetch the complete documentation index at: https://inference-docs.cerebras.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# OpenAI GPT OSS

> This model excels at efficient reasoning across science, math, and coding applications. It's ideal for real-time coding assistance, processing large documents for Q&A and summarization, agentic research workflows, and regulated on-premises workloads.

export const ModelInfo = ({modelId, modelCardUrl, playgroundUrl, contextLength = {}, maxOutput = {}, speed, inputOutput = {}, pricing = {}, rateLimits = [], endpoints = [], features = [], knownLimitations = []}) => {
  const [copied, setCopied] = React.useState(false);
  const hasImageLimits = rateLimits.some(limit => limit.imagesPerRequest);
  const hasTotalTokenLimits = rateLimits.some(limit => limit.totalTokensPerMin);
  const rateLimitMetricColumns = 3 + (hasTotalTokenLimits ? 1 : 0) + (hasImageLimits ? 1 : 0);
  const rateLimitGridTemplate = `minmax(0, 1.2fr) repeat(${rateLimitMetricColumns}, minmax(0, 1fr))`;
  const handleCopy = () => {
    navigator.clipboard.writeText(modelId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return <div className="space-y-6 not-prose">
      {modelId && <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border border-zinc-200 dark:border-zinc-800 rounded-xl px-5 py-3 bg-[#f7f5f2] dark:bg-zinc-900">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xs font-mono font-semibold tracking-wider text-zinc-500 dark:text-zinc-400 uppercase shrink-0">Model ID</span>
            <button onClick={handleCopy} className="inline-flex items-center gap-1.5 group cursor-pointer bg-transparent border-0 p-0 min-w-0" title="Copy model ID">
              <code className="text-sm font-mono font-semibold text-zinc-900 dark:text-white break-all">{modelId}</code>
              <span className="text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors shrink-0">
                <Icon icon={copied ? "check" : "copy"} size={13} color="currentColor" />
              </span>
            </button>
          </div>
          <div className="flex items-center gap-4 sm:gap-6 shrink-0">
            {playgroundUrl && <a href={playgroundUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors">
                Try in Playground
                <Icon icon="arrow-right" size={14} color="currentColor" />
              </a>}
            {modelCardUrl && <a href={modelCardUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors">
                Model card
                <Icon icon="external-link" size={14} color="currentColor" />
              </a>}
          </div>
        </div>}

      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
        <h3 className="text-base font-bold text-zinc-900 dark:text-white mb-6">Model Stats</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <div className="text-xs font-mono font-semibold tracking-wider text-zinc-500 dark:text-zinc-400 mb-3 uppercase">SPEED</div>
            <div className="text-3xl font-bold text-orange-500 dark:text-orange-400">{speed?.value}</div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{speed?.unit}</div>
          </div>

          <div>
            <div className="text-xs font-mono font-semibold tracking-wider text-zinc-500 dark:text-zinc-400 mb-3 uppercase">CONTEXT WINDOW</div>
            <div className="space-y-2">
              <div className="flex items-baseline gap-3">
                <span className="text-xs text-zinc-500 dark:text-zinc-400 w-8 shrink-0">Free</span>
                <span className="text-sm font-semibold text-zinc-900 dark:text-white">{contextLength.freeTier}</span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-xs text-zinc-500 dark:text-zinc-400 w-8 shrink-0">Paid</span>
                <span className="text-sm font-semibold text-zinc-900 dark:text-white">{contextLength.paidTiers}</span>
              </div>
            </div>
          </div>

          <div>
            <div className="text-xs font-mono font-semibold tracking-wider text-zinc-500 dark:text-zinc-400 mb-3 uppercase">MAX OUTPUT</div>
            <div className="space-y-2">
              <div className="flex items-baseline gap-3">
                <span className="text-xs text-zinc-500 dark:text-zinc-400 w-8 shrink-0">Free</span>
                <span className="text-sm font-semibold text-zinc-900 dark:text-white">{maxOutput.freeTier || 'N/A'}</span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-xs text-zinc-500 dark:text-zinc-400 w-8 shrink-0">Paid</span>
                <span className="text-sm font-semibold text-zinc-900 dark:text-white">{maxOutput.paidTiers || 'N/A'}</span>
              </div>
            </div>
          </div>

          <div>
            <div className="text-xs font-mono font-semibold tracking-wider text-zinc-500 dark:text-zinc-400 mb-3 uppercase">MODALITY</div>
            <div className="space-y-2">
              <div className="flex items-baseline gap-3">
                <span className="text-xs text-zinc-500 dark:text-zinc-400 w-10 shrink-0">Input</span>
                <span className="text-sm font-semibold text-zinc-900 dark:text-white">
                  {inputOutput.inputFormats ? inputOutput.inputFormats.map(f => f.charAt(0).toUpperCase() + f.slice(1)).join(', ') : 'Text'}
                </span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-xs text-zinc-500 dark:text-zinc-400 w-10 shrink-0">Output</span>
                <span className="text-sm font-semibold text-zinc-900 dark:text-white">
                  {inputOutput.outputFormats ? inputOutput.outputFormats.map(f => f.charAt(0).toUpperCase() + f.slice(1)).join(', ') : 'Text'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {pricing.inputPrice && pricing.outputPrice && <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
          <div className="flex items-baseline gap-2 mb-6">
            <h3 className="text-base font-bold text-zinc-900 dark:text-white">Pricing</h3>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">per million tokens</span>
          </div>
          <div className="flex flex-col sm:flex-row">
            <div className="flex-1">
              <div className="text-xs font-mono font-semibold tracking-wider text-zinc-500 dark:text-zinc-400 mb-2 uppercase">Input</div>
              <div className="text-4xl font-bold text-zinc-900 dark:text-white">{pricing.inputPrice.split(' /')[0]}</div>
            </div>
            <div className="hidden sm:block w-px bg-zinc-200 dark:bg-zinc-800 mx-8"></div>
            <div className="sm:hidden h-px bg-zinc-200 dark:bg-zinc-800 my-5"></div>
            <div className="flex-1">
              <div className="text-xs font-mono font-semibold tracking-wider text-zinc-500 dark:text-zinc-400 mb-2 uppercase">Output</div>
              <div className="text-4xl font-bold text-zinc-900 dark:text-white">{pricing.outputPrice.split(' /')[0]}</div>
            </div>
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-10">
            Developer pricing. For volume discounts and enterprise features, see our{' '}
            <a href="https://www.cerebras.ai/pricing" className="text-black dark:text-white font-semibold underline decoration-orange-500 underline-offset-4 decoration-1 hover:decoration-2">
              pricing page
            </a>
            .
          </p>
        </div>}

      {knownLimitations && knownLimitations.length > 0 && <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
          <h3 className="text-base font-bold text-zinc-900 dark:text-white mb-4">Model Notes</h3>
          <div className="space-y-2">
            {knownLimitations.map((limitation, index) => <div key={index} className="flex items-start gap-2 py-2">
                <div className="w-1.5 h-1.5 bg-zinc-400 dark:bg-zinc-500 rounded-full flex-shrink-0 mt-2"></div>
                <div className="text-zinc-900 dark:text-white text-sm leading-relaxed prose-sm max-w-none">
                  {limitation}
                </div>
              </div>)}
          </div>
        </div>}

      {rateLimits && rateLimits.length > 0 && <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
          <h3 className="text-base font-bold text-zinc-900 dark:text-white mb-4">Rate Limits</h3>
          <div role="table" aria-label="Rate limits" className="w-full text-sm">
            <div role="row" className="grid border-b border-zinc-200 dark:border-zinc-800" style={{
    gridTemplateColumns: rateLimitGridTemplate
  }}>
              <div role="columnheader" className="text-left py-3 px-2 text-zinc-500 dark:text-zinc-400 font-medium">Tier</div>
              <div role="columnheader" className="whitespace-normal break-words text-right leading-tight py-3 px-2 text-zinc-500 dark:text-zinc-400 font-medium">Requests / min</div>
              <div role="columnheader" className="whitespace-normal break-words text-right leading-tight py-3 px-2 text-zinc-500 dark:text-zinc-400 font-medium">{hasTotalTokenLimits ? 'Uncached tokens / min' : 'Input tokens / min'}</div>
              {hasTotalTokenLimits && <div role="columnheader" className="whitespace-normal break-words text-right leading-tight py-3 px-2 text-zinc-500 dark:text-zinc-400 font-medium">Total tokens / min</div>}
              <div role="columnheader" className="whitespace-normal break-words text-right leading-tight py-3 px-2 text-zinc-500 dark:text-zinc-400 font-medium">Daily tokens</div>
              {hasImageLimits && <div role="columnheader" className="whitespace-normal break-words text-right leading-tight py-3 px-2 text-zinc-500 dark:text-zinc-400 font-medium">Images / request</div>}
            </div>
            <div role="rowgroup">
              {rateLimits.map((limit, index) => <div key={index} role="row" className="grid border-b border-zinc-200/50 dark:border-zinc-800/50 last:border-b-0" style={{
    gridTemplateColumns: rateLimitGridTemplate
  }}>
                  <div role="cell" className="py-3 px-2 text-zinc-900 dark:text-white font-medium">{limit.tier}</div>
                  <div role="cell" className="text-right py-3 px-2 text-zinc-900 dark:text-white">{limit.requestsPerMin}</div>
                  <div role="cell" className="text-right py-3 px-2 text-zinc-900 dark:text-white">{limit.inputTokensPerMin}</div>
                  {hasTotalTokenLimits && <div role="cell" className="text-right py-3 px-2 text-zinc-900 dark:text-white">{limit.totalTokensPerMin || 'N/A'}</div>}
                  <div role="cell" className="text-right py-3 px-2 text-zinc-900 dark:text-white">{limit.dailyTokens}</div>
                  {hasImageLimits && <div role="cell" className="text-right py-3 px-2 text-zinc-900 dark:text-white">{limit.imagesPerRequest || 'N/A'}</div>}
                </div>)}
            </div>
          </div>
        </div>}

      {(endpoints && endpoints.length > 0 || features.length > 0) && <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {endpoints && endpoints.length > 0 && <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
              <h3 className="text-base font-bold text-zinc-900 dark:text-white mb-4">Endpoints</h3>
              <ul className="space-y-2">
                {endpoints.map((endpoint, index) => {
    const endpointDetails = {
      'Chat Completions': {
        apiPath: '/v1/chat/completions',
        referenceUrl: '/api-reference/chat-completions'
      },
      'Completions': {
        apiPath: '/v1/completions',
        referenceUrl: '/api-reference/completions'
      },
      'Models': {
        apiPath: '/v1/models',
        referenceUrl: '/api-reference/models/list-models'
      }
    };
    const endpointName = typeof endpoint === 'string' ? endpoint : endpoint.name;
    const endpointDetail = endpointDetails[endpointName] || ({});
    const endpointApiPath = typeof endpoint === 'object' && endpoint.apiPath ? endpoint.apiPath : endpointDetail.apiPath;
    const endpointReferenceUrl = typeof endpoint === 'object' && endpoint.referenceUrl ? endpoint.referenceUrl : endpointDetail.referenceUrl;
    return <li key={index} className="flex items-center gap-2 text-sm text-zinc-900 dark:text-white">
                      <div className="w-1.5 h-1.5 bg-zinc-400 dark:bg-zinc-500 rounded-full flex-shrink-0"></div>
                      {endpointReferenceUrl ? <>
                          <a href={endpointReferenceUrl} className="font-semibold text-zinc-900 dark:text-white underline underline-offset-4 decoration-2 hover:text-orange-500 hover:decoration-4" style={{
      textDecorationColor: '#f97316'
    }}>
                            {endpointName}
                          </a>
                          {endpointApiPath && <code className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">{endpointApiPath}</code>}
                        </> : <>
                          <span className="font-medium">{endpointName}</span>
                          {endpointApiPath && <code className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">{endpointApiPath}</code>}
                        </>}
                    </li>;
  })}
              </ul>
            </div>}
          {features.length > 0 && <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
              <h3 className="text-base font-bold text-zinc-900 dark:text-white mb-4">Capabilities</h3>
              <ul className="space-y-2">
                {features.map((feature, index) => <li key={index} className="flex items-center gap-2 text-sm text-zinc-900 dark:text-white">
                    <div className="w-1.5 h-1.5 bg-zinc-400 dark:bg-zinc-500 rounded-full flex-shrink-0"></div>
                    {feature}
                  </li>)}
              </ul>
            </div>}
        </div>}


      <div className="bg-gradient-to-r from-orange-600/10 to-red-500/10 border border-orange-600/20 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 bg-orange-600/20 rounded-lg flex items-center justify-center">
            <Icon icon="rocket" size={18} color="#fb923c" />
          </div>
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Need Higher Limits?</h3>
        </div>
        <p className="text-zinc-700 dark:text-zinc-300">
          Reach out for custom pricing with our Enterprise tier for higher rate limits and dedicated support.
        </p>
        <div className="mt-4">
          <a href="https://cerebras.ai/contact-us" className="inline-flex items-center gap-2 bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg transition-colors font-medium">
            Contact Sales
            <Icon icon="arrow-right" color="white" size={16} />
          </a>
        </div>
      </div>
    </div>;
};

Model ID: `gpt-oss-120b`. Pricing: $0.35 per million input tokens, $0.75 per million output tokens. Context window: 65k tokens (free tier), 131k tokens (paid). Max output: 32k tokens (free tier), 40k tokens (paid). Speed: \~3000 tokens/sec. Capabilities: Reasoning, Streaming, Structured Outputs, Tool Calling, Prompt Caching. Free tier rate limits: 30 requests/min, 60k input tokens/min, 1M tokens/day. Notes: Use the `reasoning_effort` parameter to control reasoning; the default effort level is `medium`. When `min_tokens` is set, the model may generate EOS tokens which can cause parser failures. This model may call tools that aren't directly specified — reprompt with "you're hallucinating a tool call" to help it self-correct. The API maps the "system" role to developer-level instructions in the prompt hierarchy.

<ModelInfo
  modelId="gpt-oss-120b"
  modelCardUrl="https://openai.com/index/gpt-oss-model-card/"
  playgroundUrl="https://cloud.cerebras.ai"
  contextLength={{
freeTier: "65k tokens",
paidTiers: "131k tokens"
}}
  maxOutput={{
freeTier: "32k tokens",
paidTiers: "40k tokens"
}}
  speed={{
value: "~3000",
unit: "tokens/sec"
}}
  rateLimits={[
{
  tier: "Free Trial",
  requestsPerMin: "5",
  inputTokensPerMin: "30k",
  dailyTokens: "1M"
},
{
  tier: "Developer",
  requestsPerMin: "1K",
  inputTokensPerMin: "1M",
  dailyTokens: "N/A"
}
]}
  pricing={{
inputPrice: "$0.35 / M tokens",
outputPrice: "$0.75 / M tokens"
}}
  endpoints={[
"Chat Completions",
"Completions"
]}
  features={[
"Reasoning",
"Streaming",
"Sampling Controls",
"Structured Outputs", 
"Tool Calling",
"Prompt Caching"
]}
  inputOutput={{
inputFormats: ["text"],
outputFormats: ["text"]
}}
  knownLimitations={[
<span>
Use the <code>reasoning_effort</code> parameter to control reasoning for this model. The default effort level is <code>medium</code>. Learn more in our <a href="/capabilities/reasoning#gpt-oss:-reasoning_effort" className="font-semibold text-zinc-900 dark:text-white underline underline-offset-4 decoration-2 hover:text-orange-500 hover:decoration-4" style={{ textDecorationColor: '#f97316' }}>reasoning guide</a>.
</span>,
<span>
When <code>min_tokens</code> is set, the model may generate EOS (End of Sequence) tokens which may cause parser failures. <b>Use at your own risk.</b>
</span>,
<span>
This model may call tools that aren't directly specified due to its training. Monitor for non-approved tools and reprompt with "you're hallucinating a tool call" to help the model self-correct and stick to provided tools.
</span>,
<span>
For this model, our API maps the "system" role to developer-level instructions in our prompt hierarchy. See our <a href="/resources/openai#developer-role" className="font-semibold text-zinc-900 dark:text-white underline underline-offset-4 decoration-2 hover:text-orange-500 hover:decoration-4" style={{ textDecorationColor: '#f97316' }}>OpenAI Compatibility guide</a> for more details.
</span>,
<span>
In Chat Completions, standard sampling controls are supported, including <code>temperature</code>, <code>top_p</code>, <code>frequency_penalty</code>, <code>presence_penalty</code>, <code>seed</code>, and <code>logit_bias</code>. See the <a href="/api-reference/chat-completions" className="font-semibold text-zinc-900 dark:text-white underline underline-offset-4 decoration-2 hover:text-orange-500 hover:decoration-4" style={{ textDecorationColor: '#f97316' }}>Chat Completions API reference</a> for parameter details.
</span>
]}
/>
