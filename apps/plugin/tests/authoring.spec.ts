import { test, expect } from '@playwright/test';
test('create bilingual canvas copy, preserve skipped text, reopen draft, pull library', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/src/ui/index.html?fresh');
  await expect(page.getByRole('heading', { name: 'Work with copy' })).toBeVisible();
  await page.getByRole('button', { name: 'Create new copies Review' }).click();
  await page
    .getByRole('combobox', { name: 'Action for Title', exact: true })
    .selectOption('create');
  const title = page
    .locator('section.copy-card')
    .filter({ has: page.getByRole('button', { name: 'Title', exact: true }) });
  await title
    .getByRole('textbox', { name: 'EN', exact: true })
    .fill('  New title\n{first_name} 🚀 ');
  await title
    .getByRole('textbox', { name: 'ID', exact: true })
    .fill('  Judul baru\n{first_name} 🚀 ');
  // Leave and reopen immediately to exercise draft persistence on mode switch.
  await page.getByRole('button', { name: 'String Binder', exact: true }).click();
  await page.getByRole('button', { name: 'Create new', exact: true }).click();
  await expect(title.getByRole('textbox', { name: 'EN', exact: true })).toHaveValue(
    '  New title\n{first_name} 🚀 ',
  );
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review 1 selected rows' })).toBeVisible();
  await page.getByRole('button', { name: 'Save and apply', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Copy saved and applied' })).toBeVisible();
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('mock:registry')!));
  expect(state.catalog.records).toHaveLength(2);
  expect(state.bindings['1:1']).toMatch(/^cp_/);
  expect(state.bindings['1:3']).toBeUndefined();
  await page.getByRole('button', { name: 'Library sync', exact: true }).click();
  await page.getByLabel('Publisher token').fill('local-demo');
  await page.getByRole('button', { name: 'Save on this device' }).click();
  await page.getByRole('button', { name: 'Check changes' }).click();
  const rows = page
    .locator('section.copy-card')
    .filter({ has: page.getByText('missing ·', { exact: false }) });
  await expect(rows).toHaveCount(2);
  await rows.first().locator('select').selectOption('pull');
  await rows.nth(1).locator('select').selectOption('pull');
  await page.getByRole('button', { name: 'Review changes' }).click();
  await page.getByRole('button', { name: 'Confirm Push / Pull' }).click();
  await expect(
    page.getByRole('heading', { name: 'Library draft updated · needs publish' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Verify publication' }).click();
  await expect(page.getByRole('heading', { name: 'Publication verified' })).toBeVisible();
  expect(errors).toEqual([]);
});
test('missing translation blocks review; Apply remains available', async ({ page }) => {
  await page.goto('/src/ui/index.html?fresh');
  await page.getByRole('button', { name: 'Create new', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Action for Title', exact: true })
    .selectOption('create');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('EN is required');
  await page.getByRole('button', { name: 'Apply existing', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply to frame & page' })).toBeVisible();
});

test('saved copy resumes after a binding interruption without creating another identity', async ({
  page,
}) => {
  await page.goto('/src/ui/index.html?fresh&failBinding');
  await page.getByRole('button', { name: 'Create new', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Action for Title', exact: true })
    .selectOption('create');
  const title = page
    .locator('section.copy-card')
    .filter({ has: page.getByRole('button', { name: 'Title', exact: true }) });
  await title.getByRole('textbox', { name: 'EN', exact: true }).fill('Recovery test');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Save and apply', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Saved, with outstanding Figma work' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Recover / retry saved operation' }).click();
  await expect(page.getByRole('heading', { name: 'Copy saved and applied' })).toBeVisible();
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('mock:registry')!));
  expect(state.catalog.records).toHaveLength(2);
  expect(Object.keys(state.requests)).toHaveLength(1);
});
test('Apply shows reviewed page targets before confirmation', async ({ page }) => {
  await page.goto('/src/ui/index.html?fresh');
  await page.getByRole('button', { name: 'Apply existing', exact: true }).click();
  await page.getByRole('button', { name: 'Apply to frame & page' }).click();
  await expect(page.getByRole('dialog', { name: 'Review Apply' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm Apply' }).click();
  await expect(page.getByRole('dialog', { name: 'Review Apply' })).toBeHidden();
});

test('existing identity edits retain its key and explicit new copy allocates another identity', async ({
  page,
}) => {
  await page.goto('/src/ui/index.html?fresh');
  await page.getByRole('button', { name: 'Create new', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Action for Title', exact: true })
    .selectOption('create');
  const title = page.locator('section.copy-card').first();
  await title.getByRole('textbox', { name: 'EN', exact: true }).fill('Original');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Save and apply', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Copy saved and applied' })).toBeVisible();
  let state = await page.evaluate(() => JSON.parse(localStorage.getItem('mock:registry')!));
  const id = state.bindings['1:1'];
  const key = state.catalog.records.find((r: any) => r.copyId === id).platformKey;
  await page.getByRole('button', { name: 'String Binder', exact: true }).click();
  await page.getByRole('button', { name: 'Create new', exact: true }).click();
  await title.locator('select').first().selectOption('edit');
  await title.getByRole('textbox', { name: 'EN', exact: true }).fill('Changed globally');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Save and apply', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Copy saved and applied' })).toBeVisible();
  state = await page.evaluate(() => JSON.parse(localStorage.getItem('mock:registry')!));
  expect(state.catalog.records.find((r: any) => r.copyId === id)).toMatchObject({
    revision: 2,
    platformKey: key,
    en: 'Changed globally',
  });
  await page.getByRole('button', { name: 'String Binder', exact: true }).click();
  await page.getByRole('button', { name: 'Create new', exact: true }).click();
  await title.locator('select').first().selectOption('create');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Save and apply', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Copy saved and applied' })).toBeVisible();
  state = await page.evaluate(() => JSON.parse(localStorage.getItem('mock:registry')!));
  expect(state.bindings['1:1']).not.toBe(id);
  expect(state.catalog.records).toHaveLength(3);
  expect(state.catalog.records.find((r: any) => r.copyId === id).revision).toBe(2);
});
test('keeping an occurrence during saved-operation recovery retains canvas text and leaves no false baseline', async ({
  page,
}) => {
  await page.goto('/src/ui/index.html?fresh&failBinding');
  await page.getByRole('button', { name: 'Create new', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Action for Title', exact: true })
    .selectOption('create');
  const title = page.locator('section.copy-card').first();
  await title.getByRole('textbox', { name: 'EN', exact: true }).fill('Saved but kept');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Save and apply', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Saved, with outstanding Figma work' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Review remaining bindings on the current canvas' })
    .click();
  await page.getByRole('button', { name: 'Keep this occurrence' }).click();
  await page.getByRole('button', { name: 'Apply reviewed saved copy' }).click();
  await expect(
    page.getByRole('heading', { name: 'Copy saved; no bindings applied' }),
  ).toBeVisible();
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('mock:registry')!));
  expect(state.bindings['1:1']).toBeUndefined();
  const row = state.drafts['1:0'].rows.find((r: any) => r.layerId === '1:1');
  expect(row.baseline).toBeUndefined();
  expect(state.catalog.records.some((r: any) => r.copyId === row.copyId)).toBe(false);
});
