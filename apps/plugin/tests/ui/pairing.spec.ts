import { expect, test, type Page } from '@playwright/test';

const sheetUrl =
  'https://docs.google.com/spreadsheets/d/1abcDEFghiJKLmnopQRS/edit#gid=123&range=D18';

async function fetchReview(page: Page) {
  await page.getByLabel('Google Sheets starting cell link').fill(sheetUrl);
  await page.getByRole('button', { name: 'Fetch copy' }).click();
  await expect(page.getByRole('heading', { name: 'UX Copy Sync' })).toBeVisible();
  await expect(page.getByText('CURRENT IN FIGMA', { exact: true })).toBeVisible();
}

async function expectPreviewLayer(page: Page, layerId: string | null) {
  await expect.poll(() => page.locator('body').getAttribute('data-preview-layer-id')).toBe(layerId);
}

test('reviews fixed destination rows and applies the changed cards', async ({ page }) => {
  await page.goto('/');
  await fetchReview(page);
  await expect(page.getByText('Review your order', { exact: true })).toBeVisible();
  await expect(page.getByText('Order title', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Skip row 1' }).click();
  await expect(page.getByText('Skipped', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Include row 1 again' })).toBeVisible();
  await page.getByRole('button', { name: 'Apply 5 changes' }).click();
  await expect(page.locator('.footer-status.success')).toHaveText('Updated 5 layers.');
});

test('renders one comparison header and keeps layer names out of review', async ({ page }) => {
  await page.goto('/');
  await fetchReview(page);
  await expect(page.getByText('CURRENT IN FIGMA', { exact: true })).toHaveCount(1);
  await expect(page.getByText('FROM SHEET', { exact: true })).toHaveCount(1);
  await expect(page.getByText('CURRENT', { exact: true })).toHaveCount(0);
  await expect(page.getByText('SHEET', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Order title', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Review your order', { exact: true })).toBeVisible();
  await expect(page.getByText('Check your order', { exact: true })).toBeVisible();
  await expect(page.getByText('D18', { exact: true })).toBeVisible();
  await expect(page.getByText('Checkout · D18 · 6 of 6 mapped', { exact: true })).toBeVisible();
  await expect(page.getByText('D18 will become the first copy candidate.')).toHaveCount(0);
});

test('moves a Sheet candidate between fixed destinations with insertion semantics', async ({
  page,
}) => {
  await page.goto('/');
  await fetchReview(page);
  const rowOrderBefore = await page
    .locator('.pairing-list > .pairing-row')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-testid')));

  const source = page.getByTestId('copy-card-D21').locator('.drag-handle');
  await source.scrollIntoViewIfNeeded();
  await source.dragTo(page.getByTestId('sheet-destination-text-2'), { steps: 20 });

  await expect(page.getByTestId('pairing-row-text-2')).toContainText('D21');
  await expect(page.getByTestId('pairing-row-text-3')).toContainText('D19');
  await expect(page.getByTestId('pairing-row-text-4')).toContainText('D20');
  await expect(
    page
      .locator('.pairing-list > .pairing-row')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-testid'))),
  ).resolves.toEqual(rowOrderBefore);
});

test('shows a floating drag preview while the destination stays fixed', async ({ page }) => {
  await page.goto('/');
  await fetchReview(page);
  const source = page.getByTestId('copy-card-D21').locator('.drag-handle');
  await source.scrollIntoViewIfNeeded();
  const box = await source.boundingBox();
  if (!box) throw new Error('Could not measure the Sheet drag handle.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 15, box.y + box.height / 2 + 15, { steps: 5 });
  await expect(page.locator('.drag-overlay-card')).toBeVisible();
  await expect(page.getByTestId('pairing-row-text-4')).toHaveAttribute('data-row-number', '04');
  await page.mouse.up();
});

test('previews the current copy on hover and keyboard focus, then clears on exit', async ({
  page,
}) => {
  await page.goto('/');
  await fetchReview(page);
  const region = page.getByTestId('current-preview-region-text-2');

  await region.hover();
  await expectPreviewLayer(page, 'text-2');
  await expect(page.locator('body')).toHaveAttribute('data-preview-target-events', '1');
  await expect(page.getByTestId('pairing-preview-hint')).toContainText(
    'Hover current copy to highlight it on canvas.',
  );

  await page.getByTestId('pairing-preview-hint').hover();
  await expectPreviewLayer(page, null);

  await region.focus();
  await expectPreviewLayer(page, 'text-2');
  await page.getByRole('button', { name: /Apply \d+ changes/ }).focus();
  await expectPreviewLayer(page, null);
});

test('keeps Sheet cards non-previewing and does not make the current region locate on click', async ({
  page,
}) => {
  await page.goto('/');
  await fetchReview(page);

  await page.getByTestId('copy-card-D19').hover();
  await expectPreviewLayer(page, null);
  await page.getByTestId('current-preview-region-text-2').click();
  await expectPreviewLayer(page, 'text-2');
  await expect(page.locator('body')).not.toHaveAttribute('data-locate-layer-id', 'text-2');
});

test('previews the active drag destination and clears when the drag ends or is cancelled', async ({
  page,
}) => {
  await page.goto('/');
  await fetchReview(page);
  const source = page.getByTestId('copy-card-D21').locator('.drag-handle');
  const destinationTwo = page.getByTestId('sheet-destination-text-2');
  const destinationFive = page.getByTestId('sheet-destination-text-5');
  await source.scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox();
  const destinationTwoBox = await destinationTwo.boundingBox();
  const destinationFiveBox = await destinationFive.boundingBox();
  if (!sourceBox || !destinationTwoBox || !destinationFiveBox)
    throw new Error('Could not measure the drag preview targets.');

  const sourceX = sourceBox.x + sourceBox.width / 2;
  const sourceY = sourceBox.y + sourceBox.height / 2;
  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();
  await page.mouse.move(sourceX + 20, sourceY + 20, { steps: 5 });
  await page.mouse.move(
    destinationTwoBox.x + destinationTwoBox.width / 2,
    destinationTwoBox.y + destinationTwoBox.height / 2,
    { steps: 15 },
  );
  await expectPreviewLayer(page, 'text-2');
  await page.mouse.move(
    destinationFiveBox.x + destinationFiveBox.width / 2,
    destinationFiveBox.y + destinationFiveBox.height / 2,
    { steps: 15 },
  );
  await expectPreviewLayer(page, 'text-5');
  await page.mouse.up();
  await expectPreviewLayer(page, null);

  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();
  await page.mouse.move(sourceX + 20, sourceY + 20, { steps: 5 });
  await page.mouse.move(
    destinationTwoBox.x + destinationTwoBox.width / 2,
    destinationTwoBox.y + destinationTwoBox.height / 2,
    { steps: 15 },
  );
  await expectPreviewLayer(page, 'text-2');
  await page.keyboard.press('Escape');
  await expectPreviewLayer(page, null);
  await page.mouse.up();
});

test('allows skipped current previews but never previews a skipped destination', async ({
  page,
}) => {
  await page.goto('/');
  await fetchReview(page);
  await page.getByRole('button', { name: 'Skip row 2' }).click();

  await page.getByTestId('current-preview-region-text-2').hover();
  await expectPreviewLayer(page, 'text-2');
  await page.getByTestId('sheet-destination-text-2').hover();
  await expectPreviewLayer(page, null);
});

test('clears a canvas preview when the source becomes dirty or the review becomes stale', async ({
  page,
}) => {
  await page.goto('/');
  await fetchReview(page);
  await page.getByTestId('current-preview-region-text-2').hover();
  await expectPreviewLayer(page, 'text-2');
  await page
    .getByLabel('Google Sheets starting cell link')
    .fill('https://docs.google.com/spreadsheets/d/1abcDEFghiJKLmnopQRS/edit#gid=123&range=D19');
  await expectPreviewLayer(page, null);

  await page.goto('/?fixture=stale-figma');
  await fetchReview(page);
  await expect(
    page.locator('.notice').filter({ hasText: 'The design changed after this review.' }),
  ).toBeVisible();
  await page.getByTestId('current-preview-region-text-2').hover();
  await expectPreviewLayer(page, null);
});

test('skipped rows remain fixed and skipped destinations are not droppable', async ({ page }) => {
  await page.goto('/');
  await fetchReview(page);
  await page.getByRole('button', { name: 'Skip row 2' }).click();
  await expect(page.getByTestId('sheet-destination-text-2')).toHaveAttribute(
    'data-droppable',
    'false',
  );
  await expect(page.getByTestId('sheet-destination-text-2')).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(page.getByTestId('pairing-row-text-1')).toContainText('D18');
  await expect(page.getByTestId('pairing-row-text-3')).toContainText('D19');
  await expect(page.getByTestId('pairing-row-text-4')).toContainText('D20');
});

test('keeps empty active destinations droppable for short Sheet sources', async ({ page }) => {
  await page.goto('/?fixture=partial');
  await fetchReview(page);
  await expect(page.getByTestId('sheet-destination-text-5')).toHaveAttribute(
    'data-droppable',
    'true',
  );
  await expect(page.getByTestId('sheet-destination-text-6')).toHaveAttribute(
    'data-droppable',
    'true',
  );
  await expect(page.locator('.unassigned-placeholder')).toHaveCount(2);
});

test('moves an unassigned candidate back into an active destination', async ({ page }) => {
  await page.goto('/');
  await fetchReview(page);
  await page.getByRole('button', { name: 'Skip row 1' }).click();
  await expect(page.getByText('UNASSIGNED COPY', { exact: false })).toContainText('1');
  const source = page.getByTestId('copy-card-D23').locator('.drag-handle');
  await source.scrollIntoViewIfNeeded();
  await source.dragTo(page.getByTestId('sheet-destination-text-2'), { steps: 20 });
  await expect(page.getByTestId('pairing-row-text-2')).toContainText('D23');
  await expect(page.getByText('UNASSIGNED COPY', { exact: false })).toContainText('1');
  await expect(page.getByTestId('copy-card-D22')).toBeVisible();
});

test('keeps keyboard movement available while hiding arrow clutter by default', async ({
  page,
}) => {
  await page.goto('/');
  await fetchReview(page);
  await expect(page.locator('.move-actions').first()).toHaveCSS('opacity', '0');
  const dragHandle = page.getByTestId('copy-card-D19').locator('.drag-handle');
  await dragHandle.focus();
  await expect(page.getByRole('button', { name: 'Move D19 copy up' })).toBeVisible();
  await page.getByRole('button', { name: 'Move D19 copy up' }).click();
  await expect(page.getByTestId('pairing-row-text-1')).toContainText('D19');
  await expect(page.getByTestId('pairing-row-text-2')).toContainText('D18');
});

test('keeps boundary movement actions disabled', async ({ page }) => {
  await page.goto('/');
  await fetchReview(page);
  await expect(page.getByRole('button', { name: 'Move D18 copy up' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Move D23 copy down' })).toBeDisabled();
});

test('expands long copy without changing the review value', async ({ page }) => {
  await page.goto('/?fixture=long');
  await fetchReview(page);
  await expect(page.getByRole('button', { name: /Show more for D18/ })).toBeVisible();
  await page.getByRole('button', { name: /Show more for D18/ }).click();
  await expect(page.getByRole('button', { name: /Show less for D18/ })).toBeVisible();
});

test('marks synced rows without changing the table identity', async ({ page }) => {
  await page.goto('/?fixture=synced');
  await fetchReview(page);
  await expect(page.getByTestId('pairing-row-text-1')).toHaveClass(/is-synced/);
  await expect(page.getByText('synced', { exact: true })).toBeVisible();
  await expect(page.getByText('0 changes', { exact: true })).toHaveCount(0);
});

test('keeps a 100-target review usable', async ({ page }) => {
  await page.goto('/?targets=100');
  await fetchReview(page);
  await expect(page.getByText('Current copy 100', { exact: true })).toBeVisible();
  await expect(page.getByText('Copy layer 100', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Checkout · D18 · 100 of 100 mapped', { exact: true })).toBeVisible();
  await expect(page.getByTestId('pairing-row-text-100')).toBeVisible();
});

test('supports dark mode and reduced motion without blank step markers', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await fetchReview(page);
  await expect(page.locator('.step').first()).toHaveCSS('background-color', 'rgb(13, 153, 255)');
});

test('public test entry is available in the development harness', async ({ page }) => {
  await page.goto('/?fixture=entry');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test with a public Sheet' })).toBeVisible();
  await page.getByRole('button', { name: 'Test with a public Sheet' }).click();
  await expect(page.getByText('TEST MODE', { exact: true })).toBeVisible();
});

test('offers a way to reopen the browser sign-in flow', async ({ page }) => {
  await page.goto('/?fixture=entry');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('button', { name: 'Open sign-in again' })).toBeVisible();
});

test('blocks apply when the Figma preview becomes stale', async ({ page }) => {
  await page.goto('/?fixture=stale-figma');
  await fetchReview(page);
  await expect(
    page.locator('.notice').filter({ hasText: 'The design changed after this review.' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh review' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Apply/ })).toBeDisabled();
});

test('disables Fetch when the selected design is invalid', async ({ page }) => {
  await page.goto('/?selection=invalid');
  await page.getByLabel('Google Sheets starting cell link').fill(sheetUrl);
  await expect(page.getByRole('button', { name: 'Fetch copy' })).toBeDisabled();
  await expect(page.getByText('Select one Frame, Component, or Instance first.')).toBeVisible();
});

test('refreshes a stale review against the pinned design', async ({ page }) => {
  await page.goto('/?fixture=stale-figma');
  await fetchReview(page);
  await page.getByRole('button', { name: 'Refresh review' }).click();
  await expect(page.getByRole('button', { name: 'Refresh review' })).not.toBeVisible();
  await expect(page.getByText('Review your order', { exact: true })).toBeVisible();
});

test('marks a changed source and offers Fetch new source', async ({ page }) => {
  await page.goto('/');
  await fetchReview(page);
  await page
    .getByLabel('Google Sheets starting cell link')
    .fill('https://docs.google.com/spreadsheets/d/1abcDEFghiJKLmnopQRS/edit#gid=123&range=D19');
  await expect(page.getByRole('button', { name: 'Fetch new source' })).toBeEnabled();
  await expect(page.getByText('This Sheet link changed after the review.')).toBeVisible();
});

test('shows explicit feedback during the first Fetch', async ({ page }) => {
  await page.goto('/?fixture=slow');
  await page.getByLabel('Google Sheets starting cell link').fill(sheetUrl);
  await page.getByRole('button', { name: 'Fetch copy' }).click();
  await expect(page.getByRole('button', { name: 'Fetching…' })).toBeVisible();
  await expect(page.getByText('Reading Sheet copy…')).toBeVisible();
  await expect(page.getByText('Review your order', { exact: true })).toBeVisible();
});
