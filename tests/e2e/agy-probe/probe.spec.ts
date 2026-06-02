import { test, expect, type Page } from '@playwright/test';

test.describe('AGY Deep Probe', () => {
	// Helper for screenshot capture. Waits for networkidle + a small font-
	// settle frame to avoid the intermittent "Unable to capture screenshot"
	// race we hit during the original audit run.
	async function takeScreenshot(page: Page, name: string, project: string) {
		await page.waitForLoadState('networkidle');
		await page.waitForTimeout(100);
		try {
			await page.screenshot({ path: `docs/agy-audit-shots/${project}-${name}.png` });
		} catch {
			await page.waitForTimeout(500);
			await page.screenshot({ path: `docs/agy-audit-shots/${project}-${name}.png` });
		}
	}

	test('Empty thread state, sidebar, greeting', async ({ page }, testInfo) => {
		await page.goto('/companion/chat');
		await expect(
			page.getByText("Hey Captain — what's on your mind?", { exact: false })
		).toBeVisible();
		await takeScreenshot(page, 'empty-state', testInfo.project.name);
	});

	test('Model picker overflow test', async ({ page }, testInfo) => {
		await page.goto('/companion/chat');
		await page.waitForTimeout(500);
		await takeScreenshot(page, 'model-picker-closed', testInfo.project.name);

		// Open the model picker via the header-scoped data-popover-trigger
		// attribute. The bare [data-popover-trigger] selector also matches
		// the sidebar's "Session options" button which is off-viewport on
		// the iphone-webkit project, so scope to <header>.
		const picker = page.locator('header [data-popover-trigger]');
		if ((await picker.count()) > 0) {
			await picker.first().click();
			await page.waitForTimeout(500);
			await takeScreenshot(page, 'model-picker-open', testInfo.project.name);
		}
	});

	test('Composer focus, autosize, send gating', async ({ page }, testInfo) => {
		await page.goto('/companion/chat');
		const textarea = page.locator('textarea');
		if ((await textarea.count()) > 0) {
			await textarea.first().focus();
			await takeScreenshot(page, 'composer-focused', testInfo.project.name);
			await textarea.first().fill('Test multi-line\nmessage for autosize check');
			await page.waitForTimeout(200);
			await takeScreenshot(page, 'composer-filled', testInfo.project.name);
		}
	});
});
