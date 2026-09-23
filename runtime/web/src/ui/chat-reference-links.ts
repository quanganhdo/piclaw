import { normalizeProjectRepository } from '../../../src/core/project-repository.js';

/** Shared DOM-text linking. Anchors and code are never rewritten. Numeric tokens
 * are project references only, even when no repository has been configured. */
export function linkifyChatReferences(html: string, repositoryUrl: string | null = null, linkNamedHashtags = true): string {
  if (typeof DOMParser === 'undefined') return html;
  let repository: string | null = null;
  if (repositoryUrl) {
    try { repository = normalizeProjectRepository(repositoryUrl); } catch { repository = null; }
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    if (node.parentElement?.closest('a, code, pre, script, style, svg, math, .katex')) continue;
    const text = node.nodeValue || '';
    const matches = [...text.matchAll(/#(\w+)/g)];
    if (!matches.length) continue;
    const fragment = doc.createDocumentFragment();
    let offset = 0;
    for (const match of matches) {
      const start = match.index!, end = start + match[0].length, token = match[1];
      fragment.append(doc.createTextNode(text.slice(offset, start)));
      offset = end;
      if (/^\d+$/.test(token)) {
        // Exclude URL fragments, qualified refs, escaped hashes and larger word
        // tokens. #0 is not a valid issue number.
        const before = text[start - 1] || '', after = text[end] || '';
        const boundary = !before || /[\s([{>,;:!?]/.test(before);
        if (!repository || !/^[1-9]\d*$/.test(token) || !boundary || /[\p{L}\p{N}_/\-]/u.test(after)) {
          fragment.append(doc.createTextNode(match[0])); continue;
        }
        const link = doc.createElement('a');
        link.href = `${repository}/issues/${token}`;
        link.className = 'project-reference';
        link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.title = `${repository} #${token}`; link.textContent = match[0];
        fragment.append(link);
      } else {
        if (!linkNamedHashtags) { fragment.append(doc.createTextNode(match[0])); continue; }
        const link = doc.createElement('a');
        link.href = '#'; link.className = 'hashtag';
        link.setAttribute('data-hashtag', token); link.textContent = match[0];
        fragment.append(link);
      }
    }
    fragment.append(doc.createTextNode(text.slice(offset)));
    node.replaceWith(fragment);
  }
  return doc.body.innerHTML;
}
