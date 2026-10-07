import { test, expect, type Page } from '@playwright/test';

const row = (page: Page, id: string) => page.locator(`[id="row-${id}"]`);
const registry = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('mock:registry')!));

/** Opens the Title row (1:1) and starts new copy for it. */
async function draftTitle(page: Page, en: string, id = 'Judul') {
  // An empty row opens search straight away; new copy starts from there.
  await row(page, '1:1').locator('.row__main').click();
  await page
    .getByRole('dialog', { name: 'Choose a string' })
    .getByRole('button', { name: 'Write new copy' })
    .click();
  await row(page, '1:1').getByPlaceholder('English copy').fill(en);
  await row(page, '1:1').getByPlaceholder('Bahasa Indonesia copy').fill(id);
}

/** Opens a bound row's details; clicking an already open row would open search instead. */
async function expandRow(page: Page, id: string) {
  const main = row(page, id).locator('.row__main');
  if ((await main.getAttribute('aria-expanded')) !== 'true') await main.click();
}

async function saveAndApply(page: Page) {
  await page.getByRole('button', { name: /^Review and apply/ }).click();
  const review = page.getByRole('dialog', { name: 'Review and apply' });
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: 'Save and apply', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/src/ui/index.html?fresh');
  await expect(page.getByRole('heading', { name: 'Investment – Landing page' })).toBeVisible();
});

test('guesses the page product once, remembers a change, and keeps search inside it', async ({
  page,
}) => {
  const chip = page.getByRole('button', { name: /Product for/ });
  await expect(chip).toContainText('Investment');
  await page.waitForFunction(() => localStorage.getItem('mock:scopes')?.includes('investment'));

  // Only Investment + Shared: Transfer's and Savings' "Got it" stay out until asked for.
  await row(page, '1:1').locator('.row__main').click();
  const search = page.getByRole('dialog', { name: 'Choose a string' });
  await search.getByRole('combobox').fill('got it');
  await expect(search.locator('.result__key', { hasText: 'gopay_transfer_' })).toHaveCount(0);
  await expect(
    search.locator('.result__key', { hasText: 'gopay_investment_onboarding_gotit_cta' }).first(),
  ).toBeVisible();
  await search.getByRole('button', { name: 'Not here? Search all products' }).click();
  await expect(search.getByText('All products').first()).toBeVisible();
  await expect(search.getByText(/identical copies/).first()).toBeVisible();
  await search.getByRole('button', { name: 'Back to layers' }).click();

  await chip.click();
  await page.getByRole('option', { name: /Transfer/ }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: /Product for/ })).toContainText('Transfer');
  await row(page, '1:1').locator('.row__main').click();
  await page.getByRole('button', { name: 'Write new copy' }).click();
  await expect(row(page, '1:1').getByText(/^gopay_transfer_/)).toBeVisible();
});

test('writes new copy inline, survives a reload, and saves and binds in one go', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await draftTitle(page, '  New title\n{first_name} 🚀 ', '  Judul baru\n{first_name} 🚀 ');
  await page.waitForTimeout(400);
  await page.reload();
  // Drafted rows open their editor instead of search.
  await row(page, '1:1').locator('.row__main').click();
  await expect(row(page, '1:1').getByPlaceholder('English copy')).toHaveValue(
    '  New title\n{first_name} 🚀 ',
  );
  await saveAndApply(page);
  await expect(page.getByRole('heading', { name: 'Copy saved and applied' })).toBeVisible();
  await expect(page.getByText('gopay_investment_landingpage_title').first()).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  // Apply renamed the layer after its key; that must not read as a canvas change.
  await expect(page.getByText('Canvas text changed')).toHaveCount(0);
  await expect(row(page, '1:1')).toHaveClass(/row--bound/);

  const state = await registry(page);
  expect(state.catalog.records).toHaveLength(2);
  expect(state.bindings['1:1']).toMatch(/^cp_/);
  expect(Object.keys(state.requests)).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('missing translation blocks apply and points at the row', async ({ page }) => {
  await draftTitle(page, 'Only English', '');
  await page.keyboard.press('Escape');
  await page.locator('.rows').click({ position: { x: 4, y: 4 } });
  await page.getByRole('button', { name: /^Review and apply/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'ID is required' }).first()).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Review and apply' })).toHaveCount(0);
});

test('a save interrupted while binding resumes without another identity', async ({ page }) => {
  await page.goto('/src/ui/index.html?fresh&failBinding');
  await draftTitle(page, 'Recovery test');
  await saveAndApply(page);
  await expect(page.getByRole('heading', { name: 'Applied, with exceptions' })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('saved but not fully applied')).toBeVisible();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Copy saved and applied' })).toBeVisible();
  const state = await registry(page);
  expect(state.catalog.records).toHaveLength(2);
  expect(Object.keys(state.requests)).toHaveLength(1);
  expect(state.bindings['1:1']).toMatch(/^cp_/);
});

test('editing everywhere keeps the key; a variant gets its own identity', async ({ page }) => {
  await draftTitle(page, 'Original');
  await saveAndApply(page);
  await page.getByRole('button', { name: 'Done' }).click();
  let state = await registry(page);
  const id = state.bindings['1:1'];
  const key = state.catalog.records.find((r: any) => r.copyId === id).platformKey;

  await expandRow(page, '1:1');
  await row(page, '1:1').getByRole('button', { name: 'Change the bound copy' }).click();
  await page.getByRole('option', { name: 'Edit wording everywhere' }).click();
  await row(page, '1:1').getByPlaceholder('English copy').fill('Changed globally');
  await page.getByRole('button', { name: /^Review and apply/ }).click();
  await expect(page.getByText(/Changes 1 known use in this file/)).toBeVisible();
  await page.getByRole('button', { name: 'Save and apply', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Copy saved and applied' })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  state = await registry(page);
  expect(state.catalog.records.find((r: any) => r.copyId === id)).toMatchObject({
    revision: 2,
    platformKey: key,
    en: 'Changed globally',
  });

  await expandRow(page, '1:1');
  await row(page, '1:1').getByRole('button', { name: 'Change the bound copy' }).click();
  await page.getByRole('option', { name: 'Make a variant for this screen' }).click();
  await row(page, '1:1').getByPlaceholder('English copy').fill('Only on this screen');
  await saveAndApply(page);
  await expect(page.getByRole('heading', { name: 'Copy saved and applied' })).toBeVisible();
  state = await registry(page);
  expect(state.bindings['1:1']).not.toBe(id);
  expect(state.catalog.records).toHaveLength(3);
  expect(state.catalog.records.find((r: any) => r.copyId === state.bindings['1:1'])).toMatchObject({
    forkedFrom: id,
  });
});

test('picking existing strings applies directly without a review step', async ({ page }) => {
  await row(page, '1:1').locator('.row__main').click();
  const search = page.getByRole('dialog', { name: 'Choose a string' });
  await search.getByRole('combobox').fill('continue');
  await search.getByRole('combobox').press('Enter');
  await expect(row(page, '1:1')).toContainText('Continue');
  await page.getByRole('button', { name: /^Apply/ }).click();
  await expect(page.getByRole('dialog', { name: 'Review and apply' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Strings applied' })).toBeVisible();
});

test('keyboard: S skips, F flags, N starts new copy', async ({ page }) => {
  // Arrow keys move the active row without opening search.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('s');
  await expect(row(page, '1:2')).toHaveClass(/row--skip/);
  await page.keyboard.press('s');
  await page.keyboard.press('f');
  await expect(row(page, '1:2')).toHaveClass(/row--flag/);
  await page.keyboard.press('f');
  await page.keyboard.press('n');
  await expect(row(page, '1:2')).toHaveClass(/row--create/);
});

async function openLibrary(page: Page) {
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('option', { name: 'Library sync (maintainers)' }).click();
}

test('pulls saved copy into the library and verifies publication', async ({ page }) => {
  await draftTitle(page, 'Library title');
  await saveAndApply(page);
  await page.getByRole('button', { name: 'Done' }).click();
  await openLibrary(page);
  await page.getByLabel('Publisher token').fill('local-demo');
  await page.getByRole('button', { name: 'Save on this device' }).click();
  await page.getByRole('button', { name: 'Check changes' }).click();
  const rows = page
    .locator('section.copy-card')
    .filter({ has: page.getByText('Remote changes · not in Figma', { exact: true }) });
  await expect(rows).toHaveCount(2);
  await rows.first().locator('select').selectOption('pull');
  await rows.nth(1).locator('select').selectOption('pull');
  await page.getByRole('button', { name: 'Review changes' }).click();
  await page.getByRole('button', { name: 'Confirm Push / Pull' }).click();
  await expect(
    page.getByRole('heading', { name: 'Library draft updated · needs publish' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Check changes' }).click();
  await expect(page.getByRole('group', { name: 'Show' }).getByText('Needs publish · 2')).toBeVisible();
  await page.getByRole('button', { name: 'Verify publication' }).click();
  await expect(page.getByRole('heading', { name: 'Publication verified' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to text layers' }).click();
  await expect(page.getByRole('heading', { name: 'Investment – Landing page' })).toBeVisible();
});

test('initial library reconciliation adopts every matching variable in one choice', async ({
  page,
}) => {
  await openLibrary(page);
  await page.getByLabel('Publisher token').fill('local-demo');
  await page.getByRole('button', { name: 'Save on this device' }).click();
  await expect(page.getByRole('button', { name: 'Check changes' })).toBeVisible();
  // An imported library: the variable exists and matches, but carries no saved baseline.
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('mock:registry')!);
    const r = state.catalog.records[0];
    state.locals = [
      {
        variableId: 'v:1',
        variableKey: 'k:1',
        name: r.platformKey,
        collection: 'Investment',
        copyId: r.copyId,
        baseline: null,
        context: null,
        en: r.en,
        id: r.id,
      },
    ];
    localStorage.setItem('mock:registry', JSON.stringify(state));
  });
  await page.reload();
  await openLibrary(page);
  await page.getByRole('button', { name: 'Check changes' }).click();
  await expect(page.getByText('Needs initial reconciliation', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Select Adopt for all 1' }).click();
  await page.getByRole('button', { name: 'Review changes' }).click();
  await expect(page.getByRole('heading', { name: 'Review 1 changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm Push / Pull' }).click();
  await expect(
    page.getByRole('heading', { name: 'Library draft updated · needs publish' }),
  ).toBeVisible();
  const state = await registry(page);
  expect(state.locals).toHaveLength(1);
  expect(state.locals[0].baseline.revision).toBe(1);
});
