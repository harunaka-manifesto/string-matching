import { expect, test } from '@playwright/test';

test('reviews fixed destination slots and applies the changed cards', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'UX Copy Sync' })).toBeVisible();
  await page
    .getByLabel('Google Sheets starting cell link')
    .fill('https://docs.google.com/spreadsheets/d/1abcDEFghiJKLmnopQRS/edit#gid=123&range=D18');
  await page.getByRole('button', { name: 'Fetch copy' }).click();
  await expect(page.getByText('Order title')).toBeVisible();
  await page.getByRole('button', { name: 'Skip Order title' }).click();
  await expect(page.getByText('Skipped · Figma copy will stay unchanged')).toBeVisible();
  await page.getByRole('button', { name: 'Apply 5 changes' }).click();
  await expect(page.locator('.footer-status.success')).toHaveText('Updated 5 layers.');
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
  await page
    .getByLabel('Google Sheets starting cell link')
    .fill('https://docs.google.com/spreadsheets/d/1abcDEFghiJKLmnopQRS/edit#gid=123&range=D18');
  await page.getByRole('button', { name: 'Fetch copy' }).click();
  await expect(
    page.locator('.notice').filter({ hasText: 'The design changed after this review.' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh review' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Apply/ })).toBeDisabled();
});

test('disables Fetch when the selected design is invalid', async ({ page }) => {
  await page.goto('/?selection=invalid');
  await page
    .getByLabel('Google Sheets starting cell link')
    .fill('https://docs.google.com/spreadsheets/d/1abcDEFghiJKLmnopQRS/edit#gid=123&range=D18');
  await expect(page.getByRole('button', { name: 'Fetch copy' })).toBeDisabled();
  await expect(page.getByText('Select one Frame, Component, or Instance first.')).toBeVisible();
});

test('refreshes a stale review against the pinned design', async ({ page }) => {
  await page.goto('/?fixture=stale-figma');
  await page
    .getByLabel('Google Sheets starting cell link')
    .fill('https://docs.google.com/spreadsheets/d/1abcDEFghiJKLmnopQRS/edit#gid=123&range=D18');
  await page.getByRole('button', { name: 'Fetch copy' }).click();
  await page.getByRole('button', { name: 'Refresh review' }).click();
  await expect(page.getByRole('button', { name: 'Refresh review' })).not.toBeVisible();
  await expect(page.getByText('Order title')).toBeVisible();
});

test('disables impossible boundary reorder actions', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel('Google Sheets starting cell link')
    .fill('https://docs.google.com/spreadsheets/d/1abcDEFghiJKLmnopQRS/edit#gid=123&range=D18');
  await page.getByRole('button', { name: 'Fetch copy' }).click();
  await expect(page.getByRole('button', { name: 'Move D18 copy up' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Move D23 copy down' })).toBeDisabled();
});

test('marks a changed source and offers Fetch new source', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel('Google Sheets starting cell link')
    .fill('https://docs.google.com/spreadsheets/d/1abcDEFghiJKLmnopQRS/edit#gid=123&range=D18');
  await page.getByRole('button', { name: 'Fetch copy' }).click();
  await page
    .getByLabel('Google Sheets starting cell link')
    .fill('https://docs.google.com/spreadsheets/d/1abcDEFghiJKLmnopQRS/edit#gid=123&range=D19');
  await expect(page.getByRole('button', { name: 'Fetch new source' })).toBeEnabled();
  await expect(page.getByText('This Sheet link changed after the review.')).toBeVisible();
});

test('expands long copy without changing the review value', async ({ page }) => {
  await page.goto('/?fixture=long');
  await page
    .getByLabel('Google Sheets starting cell link')
    .fill('https://docs.google.com/spreadsheets/d/1abcDEFghiJKLmnopQRS/edit#gid=123&range=D18');
  await page.getByRole('button', { name: 'Fetch copy' }).click();
  await expect(page.getByRole('button', { name: /Show more for D18/ })).toBeVisible();
  await page.getByRole('button', { name: /Show more for D18/ }).click();
  await expect(page.getByRole('button', { name: /Show less for D18/ })).toBeVisible();
});

test('shows explicit feedback during the first Fetch', async ({ page }) => {
  await page.goto('/?fixture=slow');
  await page
    .getByLabel('Google Sheets starting cell link')
    .fill('https://docs.google.com/spreadsheets/d/1abcDEFghiJKLmnopQRS/edit#gid=123&range=D18');
  await page.getByRole('button', { name: 'Fetch copy' }).click();
  await expect(page.getByRole('button', { name: 'Fetching…' })).toBeVisible();
  await expect(page.getByText('Reading Sheet copy…')).toBeVisible();
  await expect(page.getByText('Order title')).toBeVisible();
});

test('keeps a 100-target review usable', async ({ page }) => {
  await page.goto('/?targets=100');
  await page
    .getByLabel('Google Sheets starting cell link')
    .fill('https://docs.google.com/spreadsheets/d/1abcDEFghiJKLmnopQRS/edit#gid=123&range=D18');
  await page.getByRole('button', { name: 'Fetch copy' }).click();
  await expect(page.getByText('Copy layer 100')).toBeVisible();
  await expect(
    page.getByText('Fetched 100 non-empty strings for 100 detected layers'),
  ).toBeVisible();
});
