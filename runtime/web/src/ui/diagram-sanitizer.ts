import DOMPurify from 'dompurify';

/** Fail closed if the purifier cannot run; generated SVG still crosses an untrusted DOM boundary. */
export function sanitizeDiagramSvg(svg: string): string {
  if (typeof DOMPurify.sanitize !== 'function') throw new Error('Diagram sanitizer is unavailable');
  const clean = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'style', 'foreignObject', 'a', 'image', 'use', 'animate', 'animateMotion', 'animateTransform', 'set'],
  });
  const doc = new DOMParser().parseFromString(clean, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.localName !== 'svg' || doc.querySelector('parsererror')) throw new Error('Invalid diagram SVG');
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attribute of Array.from(element.attributes)) {
      const value = attribute.value;
      if (attribute.name === 'href' || attribute.name === 'xlink:href' || attribute.name.startsWith('on') ||
          (/(?:https?:|data:|blob:|javascript:|vbscript:|@import|image-set\s*\(|\/\/|\\)/i.test(value) && attribute.name !== 'xmlns') ||
          Array.from(value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)).some((match) => !/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(match[2]?.trim() || ''))) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return new XMLSerializer().serializeToString(root);
}
