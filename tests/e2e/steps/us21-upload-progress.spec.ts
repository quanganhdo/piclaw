import { test, expect } from '../support/world';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test.describe('US21 — attachment upload progress and failure recovery', () => {
  test('compose shows upload progress and sends only after every upload succeeds', async ({ authedPage: page }) => {
    const uploadStarted = deferred();
    const releaseUpload = deferred();
    const releaseMessage = deferred();
    const messagePayloads: any[] = [];

    await page.route('**/media/upload', async (route) => {
      uploadStarted.resolve();
      await releaseUpload.promise;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 701 }),
      });
    });
    await page.route(/\/agent\/default\/message(?:\?|$)/, async (route) => {
      messagePayloads.push(route.request().postDataJSON());
      await releaseMessage.promise;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user_message: null }),
      });
    });

    const compose = page.getByTestId('compose-box');
    const input = compose.getByTestId('compose-input');
    const send = compose.getByTestId('send-button');
    await input.fill('upload progress check');
    await compose.locator('input[type="file"][multiple]').setInputFiles({
      name: 'alpha.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('alpha payload'),
    });
    await expect(compose.locator('.compose-file-pill')).toContainText('alpha.txt');

    await send.click();
    await uploadStarted.promise;

    const status = compose.getByTestId('compose-upload-status');
    await expect(status).toBeVisible();
    await expect(status).toContainText('Uploading 1/1: alpha.txt');
    await expect(status.getByRole('progressbar')).toHaveAttribute('aria-valuenow', /\d+/);
    await expect(send).toBeDisabled();
    await expect(send).toHaveAttribute('title', 'Uploading attachments…');
    expect(messagePayloads).toHaveLength(0);

    releaseUpload.resolve();
    await expect.poll(() => messagePayloads.length).toBe(1);
    expect(messagePayloads[0].media_ids).toEqual([701]);
    expect(messagePayloads[0].content).toContain('attachment:701 (alpha.txt)');
    // Upload progress must not represent the separate message POST.
    await expect(status).toBeHidden();
    await expect(send).toBeDisabled();
    await expect(send).toHaveAttribute('title', 'Sending…');
    releaseMessage.resolve();
    await expect(input).toHaveValue('');
    await expect(compose.locator('.compose-file-pill')).toHaveCount(0);
  });

  test('compose separates a completed upload from message submission failure', async ({ authedPage: page }) => {
    let messageRequests = 0;
    await page.route('**/media/upload', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 702 }),
      });
    });
    await page.route(/\/agent\/default\/message(?:\?|$)/, async (route) => {
      messageRequests += 1;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Synthetic message failure' }),
      });
    });

    const compose = page.getByTestId('compose-box');
    const input = compose.getByTestId('compose-input');
    await input.fill('message retry draft');
    await compose.locator('input[type="file"][multiple]').setInputFiles({
      name: 'already-uploaded.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('uploaded payload'),
    });

    await compose.getByTestId('send-button').click();

    const error = compose.locator('.compose-submit-error');
    await expect(error).toContainText('Synthetic message failure');
    expect(messageRequests).toBe(1);
    await expect(compose.getByTestId('compose-upload-status')).toBeHidden();
    await expect(input).toHaveValue('message retry draft');
    await expect(compose.locator('.compose-file-pill')).toContainText('already-uploaded.txt');
  });

  test('compose does not post and restores the exact draft and attachment after upload failure', async ({ authedPage: page }) => {
    let messageRequests = 0;
    await page.route('**/media/upload', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Synthetic upload failure' }),
      });
    });
    await page.route(/\/agent\/default\/message(?:\?|$)/, async (route) => {
      messageRequests += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    const compose = page.getByTestId('compose-box');
    const input = compose.getByTestId('compose-input');
    await input.fill('draft must survive');
    await compose.locator('input[type="file"][multiple]').setInputFiles({
      name: 'retry-me.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('retry payload'),
    });

    await compose.getByTestId('send-button').click();

    const error = compose.locator('.compose-submit-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('Synthetic upload failure');
    await expect(input).toHaveValue('draft must survive');
    await expect(compose.locator('.compose-file-pill')).toHaveCount(1);
    await expect(compose.locator('.compose-file-pill')).toContainText('retry-me.txt');
    await expect(compose.getByTestId('compose-upload-status')).toBeHidden();
    await page.waitForTimeout(100);
    expect(messageRequests).toBe(0);
  });
});
