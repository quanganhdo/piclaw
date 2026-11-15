> ## Documentation Index
> Fetch the complete documentation index at: https://docs.inceptionlabs.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Models

> Compare models, capabilities, and pricing.

<CardGroup cols={2}>
  <Card title="50% off Mercury 3" icon="badge-percent" color="#2C9AF2" href="https://platform.inceptionlabs.ai" horizontal />

  <Card title="50% off Mercury Decide" icon="badge-percent" color="#2C9AF2" href="https://platform.inceptionlabs.ai" horizontal />
</CardGroup>

## Models

| Model | Input Price (1M Tokens) | Cached Input Price (1M Tokens) | Output Price (1M Tokens) | Supported Endpoints | Context Window | Max Output Tokens | Features | Supported Formats |
| - | - | - | :- | - | - | - | - | - |
| **Mercury 3** | ~~\$0.20~~ → **\$0.10** | ~~\$0.02~~ → **\$0.01** | ~~\$0.70~~ → **\$0.35** | `v1/chat/completions` | Chat: 1M | 131,072 | `Tool Calling`<br />`Structured Outputs` | `Text` |
| **Mercury Voice** | ~~\$0.40~~ → **\$0.20** | ~~\$0.04~~ → **\$0.02** | ~~\$1.50~~ → **\$0.75** | `v1/chat/completions` | Chat: 128K | 50,000 | `Tool Calling`<br />`Structured Outputs` | `Text` |
| **Mercury Decide** | ~~\$0.04~~ → **\$0.02** | \$0 | \$0 | `v1/decisions` | — | — | `Classification`<br />`Scoring` | `Text / JSON / Image` |
| **Mercury 2.5** | \$0.20 | \$0.02 | \$0.75 | `v1/chat/completions` | Chat: 260K | 65,536 | `Tool Calling`<br />`Structured Outputs` | `Text` |
| **Mercury 2** | \$0.25 | \$0.025 | \$0.75 | `v1/chat/completions` | Chat: 128K | 50,000 | `Tool Calling`<br />`Structured Outputs` | `Text` |
| **Mercury Edit 2** | \$0.25 | \$0.025 | \$0.75 | `v1/fim/completions`<br />`v1/edit/completions` | FIM: 32K<br />NextEdit: 32K | 8,192 | | `Text` |

<Tabs>
  <Tab title="Mercury 3">
    Our most intelligent model yet, with a 1M-token context window, up to 131,072 output tokens, and `instant`, `low`, `medium`, and `high` reasoning effort. Temperature is adjustable from 0.5 to 1.0.

    Mercury 3 is **50% off at launch**: \$0.10 per million input tokens and \$0.35 per million output tokens (regularly \$0.20 and \$0.70).

    Export your API key as an environment variable in your terminal.

    <CodeGroup>
      ```bash macOS / Linux theme={null}
      export INCEPTION_API_KEY="your_api_key_here"
      ```

      ```cmd Windows (Command Prompt) theme={null}
      set INCEPTION_API_KEY=your_api_key_here
      ```

      ```powershell Windows (PowerShell) theme={null}
      $env:INCEPTION_API_KEY="your_api_key_here"
      ```
    </CodeGroup>

    ## Example Usage

    ### Chat Completions

    `v1/chat/completions`

    <CodeGroup>
      ```bash cURL theme={null}
      curl https://api.inceptionlabs.ai/v1/chat/completions \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $INCEPTION_API_KEY" \
        -d '{
          "model": "mercury-3",
          "messages": [
            {"role": "user", "content": "What is a diffusion model?"}
          ],
          "reasoning_effort": "medium",
          "max_completion_tokens": 8192
        }'
      ```

      ```python Python theme={null}
      from inceptionai import Inception

      client = Inception()  # reads INCEPTION_API_KEY from the environment

      completion = client.chat.completions.create(
          model="mercury-3",
          messages=[{"role": "user", "content": "What is a diffusion model?"}],
          reasoning_effort="medium",
          max_completion_tokens=8192,
      )
      print(completion.choices[0].message.content)
      ```

      ```typescript TypeScript theme={null}
      import Inception from 'inceptionai';

      const client = new Inception(); // reads INCEPTION_API_KEY from the environment

      const completion = await client.chat.completions.create({
        model: 'mercury-3',
        messages: [{ role: 'user', content: 'What is a diffusion model?' }],
        reasoning_effort: 'medium',
        max_completion_tokens: 8192,
      });
      console.log(completion.choices[0]?.message.content);
      ```
    </CodeGroup>
  </Tab>

  <Tab title="Mercury Voice">
    A diffusion LLM tuned for voice agents. It reasons, calls tools, returns structured outputs, and follows long system prompts while keeping latency low enough for natural conversation.

    Mercury Voice is available to enterprise customers through the OpenAI-compatible Inception API, and works with LiveKit, Pipecat, Vapi, Retell, or your own voice stack. It supports `low`, `medium`, and `high` reasoning effort. Temperature is adjustable from 0.5 to 1.0.

    Mercury 3 is **50% off at launch**: \$0.10 per million input tokens and \$0.35 per million output tokens (regularly \$0.20 and \$0.70).

    <Card title="Get access to Mercury Voice" icon="microphone" href="mailto:sales@inceptionlabs.ai" horizontal>
      Contact [sales@inceptionlabs.ai](mailto:sales@inceptionlabs.ai) to enable Mercury Voice for your organization.
    </Card>
  </Tab>

  <Tab title="Mercury Decide">
    Evaluate named questions against shared context with `mercury-decide` at `v1/decisions`. Get binary probabilities, categorical choices, or ordinal scores with typed answers.

    Only input tokens are billed, at **\$0.02 per million tokens** (50% off the regular \$0.04 price). Output tokens are reported but not charged. This endpoint does not support chat completions, streaming, or tool calling.

    <Card title="Start using Mercury Decide" icon="list-check" href="/capabilities/decisions" horizontal>
      Request examples, question types, response fields, and limits.
    </Card>
  </Tab>

  <Tab title="Mercury 2.5">
    Our previous-generation reasoning model for fast chat, agents, and structured workflows.

    Export your API key as an environment variable in your terminal.

    <CodeGroup>
      ```bash macOS / Linux theme={null}
      export INCEPTION_API_KEY="your_api_key_here"
      ```

      ```cmd Windows (Command Prompt) theme={null}
      set INCEPTION_API_KEY=your_api_key_here
      ```

      ```powershell Windows (PowerShell) theme={null}
      $env:INCEPTION_API_KEY="your_api_key_here"
      ```
    </CodeGroup>

    ## Example Usage

    ### Chat Completions

    `v1/chat/completions`

    <CodeGroup>
      ```bash cURL theme={null}
      curl https://api.inceptionlabs.ai/v1/chat/completions \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $INCEPTION_API_KEY" \
        -d '{
          "model": "mercury-2.5",
          "messages": [
            {"role": "user", "content": "What is a diffusion model?"}
          ],
          "reasoning_effort": "medium",
          "max_completion_tokens": 8192
        }'
      ```

      ```python Python theme={null}
      from inceptionai import Inception

      client = Inception()  # reads INCEPTION_API_KEY from the environment

      completion = client.chat.completions.create(
          model="mercury-2.5",
          messages=[{"role": "user", "content": "What is a diffusion model?"}],
          reasoning_effort="medium",
          max_completion_tokens=8192,
      )
      print(completion.choices[0].message.content)
      ```

      ```typescript TypeScript theme={null}
      import Inception from 'inceptionai';

      const client = new Inception(); // reads INCEPTION_API_KEY from the environment

      const completion = await client.chat.completions.create({
        model: 'mercury-2.5',
        messages: [{ role: 'user', content: 'What is a diffusion model?' }],
        reasoning_effort: 'medium',
        max_completion_tokens: 8192,
      });
      console.log(completion.choices[0]?.message.content);
      ```
    </CodeGroup>
  </Tab>

  <Tab title="Mercury 2">
    An earlier-generation reasoning model for chat completions.

    Export your API key as an environment variable in your terminal.

    <CodeGroup>
      ```bash macOS / Linux theme={null}
      export INCEPTION_API_KEY="your_api_key_here"
      ```

      ```cmd Windows (Command Prompt) theme={null}
      set INCEPTION_API_KEY=your_api_key_here
      ```

      ```powershell Windows (PowerShell) theme={null}
      $env:INCEPTION_API_KEY="your_api_key_here"
      ```
    </CodeGroup>

    ## Example Usage

    ### Chat Completions

    `v1/chat/completions`

    <CodeGroup>
      ```bash cURL theme={null}
      curl https://api.inceptionlabs.ai/v1/chat/completions \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $INCEPTION_API_KEY" \
        -d '{
          "model": "mercury-2",
          "messages": [
            {"role": "user", "content": "What is a diffusion model?"}
          ],
          "max_completion_tokens": 8192
        }'
      ```

      ```python Python theme={null}
      from inceptionai import Inception

      client = Inception()  # reads INCEPTION_API_KEY from the environment

      completion = client.chat.completions.create(
          model="mercury-2",
          messages=[{"role": "user", "content": "What is a diffusion model?"}],
          max_completion_tokens=8192,
      )
      print(completion.choices[0].message.content)
      ```

      ```typescript TypeScript theme={null}
      import Inception from 'inceptionai';

      const client = new Inception(); // reads INCEPTION_API_KEY from the environment

      const completion = await client.chat.completions.create({
        model: 'mercury-2',
        messages: [{ role: 'user', content: 'What is a diffusion model?' }],
        max_completion_tokens: 8192,
      });
      console.log(completion.choices[0]?.message.content);
      ```
    </CodeGroup>
  </Tab>

  <Tab title="Mercury Edit 2">
    A code editing LLM for autocomplete (FIM) and next edit suggestions.

    Export your API key as an environment variable in your terminal.

    <CodeGroup>
      ```bash macOS / Linux theme={null}
      export INCEPTION_API_KEY="your_api_key_here"
      ```

      ```cmd Windows (Command Prompt) theme={null}
      set INCEPTION_API_KEY=your_api_key_here
      ```

      ```powershell Windows (PowerShell) theme={null}
      $env:INCEPTION_API_KEY="your_api_key_here"
      ```
    </CodeGroup>

    ## Example Usage

    ### Autocomplete (FIM)

    `v1/fim/completions`

    <CodeGroup>
      ```bash cURL theme={null}
      curl https://api.inceptionlabs.ai/v1/fim/completions \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $INCEPTION_API_KEY" \
        -d '{
          "model": "mercury-edit-2",
          "prompt": "def factorial(n):\n    if n <= 1:\n        return 1\n    return n * ",
          "suffix": "\n\nprint(factorial(5))",
          "max_tokens": 1000
        }'
      ```

      ```python Python theme={null}
      from inceptionai import Inception

      client = Inception()  # reads INCEPTION_API_KEY from the environment

      completion = client.fim.completions.create(
          model="mercury-edit-2",
          prompt="def factorial(n):\n    if n <= 1:\n        return 1\n    return n * ",
          suffix="\n\nprint(factorial(5))",
          max_tokens=1000,
      )
      print(completion.choices[0].text)
      ```

      ```typescript TypeScript theme={null}
      import Inception from 'inceptionai';

      const client = new Inception(); // reads INCEPTION_API_KEY from the environment

      const completion = await client.fim.completions.create({
        model: 'mercury-edit-2',
        prompt: 'def factorial(n):\n    if n <= 1:\n        return 1\n    return n * ',
        suffix: '\n\nprint(factorial(5))',
        max_tokens: 1000,
      });
      console.log(completion.choices[0]?.text);
      ```
    </CodeGroup>

    ### Next-Edit

    `v1/edit/completions`

    <CodeGroup>
      ```bash cURL theme={null}
      curl https://api.inceptionlabs.ai/v1/edit/completions \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $INCEPTION_API_KEY" \
        --data-binary @- <<'JSON'
      {
        "model": "mercury-edit-2",
        "messages": [
          {"role": "user", "content": "<|recently_viewed_code_snippets|>\n\n<|/recently_viewed_code_snippets|>\n\n<|current_file_content|>\ncurrent_file_path: solver.py\n'''\nfunction: flagAllNeighbors\n----------\nThis function marks each of the covered neighbors of the cell at the given row\n<|code_to_edit|>\nand col as flagged.\n'''\ndef flagAllNeighbors(board<|cursor|>, row, col): \n for r, c in b.getNeighbors(row, col):\n if b.isValid(r, c):\n b.flag(r, c)\n\n<|/code_to_edit|>\n<|/current_file_content|>\n\n<|edit_diff_history|>\n--- /c:/Users/test/testing/solver.py\n+++ /c:/Users/test/testing/solver.py\n@@ -6,1 +6,1 @@\n-def flagAllNeighbors(b, row, col): \n+def flagAllNeighbors(board, row, col): \n\n<|/edit_diff_history|>"}
        ],
        "max_tokens": 1000
      }
      JSON
      ```

      ```python Python theme={null}
      from inceptionai import Inception

      client = Inception()  # reads INCEPTION_API_KEY from the environment

      completion = client.edit.completions.create(
          model="mercury-edit-2",
          messages=[
              {"role": "user", "content": "<|recently_viewed_code_snippets|>\n\n<|/recently_viewed_code_snippets|>\n\n<|current_file_content|>\ncurrent_file_path: solver.py\n'''\nfunction: flagAllNeighbors\n----------\nThis function marks each of the covered neighbors of the cell at the given row\n<|code_to_edit|>\nand col as flagged.\n'''\ndef flagAllNeighbors(board<|cursor|>, row, col): \n for r, c in b.getNeighbors(row, col):\n if b.isValid(r, c):\n b.flag(r, c)\n\n<|/code_to_edit|>\n<|/current_file_content|>\n\n<|edit_diff_history|>\n--- /c:/Users/test/testing/solver.py\n+++ /c:/Users/test/testing/solver.py\n@@ -6,1 +6,1 @@\n-def flagAllNeighbors(b, row, col): \n+def flagAllNeighbors(board, row, col): \n\n<|/edit_diff_history|>"}
          ],
          max_tokens=1000,
      )
      print(completion.choices[0].message.content)
      ```

      ```typescript TypeScript theme={null}
      import Inception from 'inceptionai';

      const client = new Inception(); // reads INCEPTION_API_KEY from the environment

      const completion = await client.edit.completions.create({
        model: 'mercury-edit-2',
        messages: [
          { role: 'user', content: '<|recently_viewed_code_snippets|>\n\n<|/recently_viewed_code_snippets|>\n\n<|current_file_content|>\ncurrent_file_path: solver.py\n\'\'\'\nfunction: flagAllNeighbors\n----------\nThis function marks each of the covered neighbors of the cell at the given row\n<|code_to_edit|>\nand col as flagged.\n\'\'\'\ndef flagAllNeighbors(board<|cursor|>, row, col): \n for r, c in b.getNeighbors(row, col):\n if b.isValid(r, c):\n b.flag(r, c)\n\n<|/code_to_edit|>\n<|/current_file_content|>\n\n<|edit_diff_history|>\n--- /c:/Users/test/testing/solver.py\n+++ /c:/Users/test/testing/solver.py\n@@ -6,1 +6,1 @@\n-def flagAllNeighbors(b, row, col): \n+def flagAllNeighbors(board, row, col): \n\n<|/edit_diff_history|>' }
        ],
        max_tokens: 1000,
      });
      console.log(completion.choices[0]?.message.content);
      ```
    </CodeGroup>
  </Tab>
</Tabs>

## More Mercury Models

<CardGroup cols={2}>
  <Card title="Mercury Voice" icon="microphone" href="https://www.inceptionlabs.ai/blog/introducing-mercury-voice">
    Built for responsive, real-time voice experiences.
  </Card>

  <Card title="Mercury Router" icon="route">
    Match each request with the right Mercury model.
  </Card>
</CardGroup>

<Card title="Explore all models" icon="arrow-right" href="https://www.inceptionlabs.ai/models" horizontal cta="View models" arrow="true">
  Learn more about the Mercury model family.
</Card>


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.