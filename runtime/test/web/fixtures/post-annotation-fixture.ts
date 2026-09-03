import { html, render } from '../../../web/src/vendor/preact-htm.js';
import { Post } from '../../../web/src/components/post.js';

const post = {
  id: 1,
  chat_jid: 'web:annotation-fixture',
  timestamp: '2026-09-02T22:00:00.000Z',
  data: {
    type: 'agent_response',
    content: 'Select this text for annotation. The remaining sentence keeps the post wide enough for positioning checks.',
    content_blocks: [],
    media_ids: [],
    annotations: [],
  },
};

render(html`
  <main class="annotation-fixture">
    <${Post}
      post=${post}
      agentName="Smith"
      onHashtagClick=${() => undefined}
    />
  </main>
`, document.getElementById('annotation-fixture-root')!);
