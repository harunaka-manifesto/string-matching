import { expect, test } from '@playwright/test';

test('reviews fixed destination slots and applies the changed cards', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'UX Copy Sync' })).toBeVisible();
  await page
    .getByLabel('Google Sheets starting cell link')
    .fill('https://docs.google.com/spreadsheets/d/1abcDEFghiJKLmnopQRS/edit#gid=123&range=D18');
  await page.getByRole('button', { name: 'Fetch copy' }).click();
  await expect(page.getByText('Order title')).toBeVisible();
  await page.getByRole('button', { name: 'Skip this layer' }).first().click();
  await expect(page.getByText('Skipped · Figma copy will stay unchanged')).toBeVisible();
  await page.getByRole('button', { name: 'Apply 5 changes' }).click();
  await expect(page.getByText('Updated 5 layers.')).toBeVisible();
});

test('public test entry is available in the development harness', async ({ page }) => {
  await page.goto('/?fixture=entry');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test with a public Sheet' })).toBeVisible();
  await page.getByRole('button', { name: 'Test with a public Sheet' }).click();
  await expect(page.getByText('TEST MODE', { exact: true })).toBeVisible();
});

test('blocks apply when the Figma preview becomes stale', async ({ page }) => {
  await page.goto('/?fixture=stale-figma');
  await page
    .getByLabel('Google Sheets starting cell link')
    .fill('https://docs.google.com/spreadsheets/d/1abcDEFghiJKLmnopQRS/edit#gid=123&range=D18');
  await page.getByRole('button', { name: 'Fetch copy' }).click();
  await expect(
    page.getByText('The design changed after this review. Refresh before applying.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Apply/ })).toBeDisabled();
});
