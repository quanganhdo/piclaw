import { expect, test } from 'bun:test';
import { parseUserContent } from '../../web/static/visual/frontend/src/utils/attachments';
import { isSafeUploadFilename } from '../../src/core/upload-limits';

test('workspace Files references are rendered separately from database attachment IDs', () => {
  const parsed=parseUserContent('Inspect these.\n\nAttachments:\n- attachment:12 (small.txt)\n\nFiles:\n- uploads/upload-1234567890123456/large.bin');
  expect(parsed.cleanedContent).toBe('Inspect these.');
  expect(parsed.attachments).toEqual([{mediaId:12,filename:'small.txt'}]);
  expect(parsed.workspaceFiles).toEqual(['uploads/upload-1234567890123456/large.bin']);
});

test('unsafe references remain text rather than actionable links', () => {
  for(const path of ['../outside','/absolute','https://outside/file','folder/../file','folder\\file']){
    const text='Files:\n- '+path;
    expect(parseUserContent(text).workspaceFiles).toEqual([]);
    expect(parseUserContent(text).cleanedContent).toBe(text);
  }
});

test('large upload names cannot spoof line-oriented references and remain portable', () => {
  for(const name of ['large file.bin','résumé.pdf','image.png'])expect(isSafeUploadFilename(name)).toBe(true);
  for(const name of ['../a','x\\y',' leading','trailing ','trailing.','CON','nul.txt','a\nb','a\u2028b','a\u202eb','x:stream','x'.repeat(221)])expect(isSafeUploadFilename(name)).toBe(false);
});
