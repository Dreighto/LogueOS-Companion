/**
 * Motion engine verification — instrumented transform sampling.
 * Proves spring-driven sheets continue from finger position (no snap-to-0)
 * and stay mounted until spring rest.
 */
import { test, expect } from '@playwright/test';

function parseTranslateX(transform: string): number {
	if (transform === 'none') return 0;
	const m = transform.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,\s*([^,]+),/);
	return m ? parseFloat(m[1]) : 0;
}

function parseTranslateY(transform: string): number {
	if (transform === 'none') return 0;
	const m = transform.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,[^,]+,\s*([^)]+)\)/);
	return m ? parseFloat(m[1]) : 0;
}

async function openModelPickerMobile(page: import('@playwright/test').Page) {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.goto('/companion/chat');
	await page.getByTestId('model-picker-chip').click();
	await expect(page.getByTestId('model-picker-sheet')).toBeVisible({ timeout: 5000 });
}

/** Dispatch real pointer events on the sheet handle (page.mouse does not hit pointer handlers). */
async function dragModelPickerHandle(
	page: import('@playwright/test').Page,
	deltaY: number
): Promise<{ midY: number; afterReleaseY: number; mountedAfterRelease: boolean }> {
	const midY = await page.evaluate((dy) => {
		const sheet = document.querySelector('[data-testid="model-picker-sheet"]') as HTMLElement | null;
		if (!sheet) throw new Error('model-picker-sheet missing');
		const handle = sheet.querySelector('[style*="touch-action: none"]') as HTMLElement | null;
		if (!handle) throw new Error('sheet handle missing');

		const rect = handle.getBoundingClientRect();
		const cx = rect.left + rect.width / 2;
		const cy = rect.top + 6;
		const pointerId = 42;

		const readY = () => {
			const t = getComputedStyle(sheet).transform;
			if (t === 'none') return 0;
			const m = t.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,[^,]+,\s*([^)]+)\)/);
			return m ? parseFloat(m[1]) : 0;
		};

		handle.dispatchEvent(
			new PointerEvent('pointerdown', {
				bubbles: true,
				cancelable: true,
				clientX: cx,
				clientY: cy,
				pointerId,
				pointerType: 'touch',
				isPrimary: true
			})
		);

		let ySample = 0;
		for (let i = 1; i <= 8; i++) {
			const y = cy + (dy * i) / 8;
			handle.dispatchEvent(
				new PointerEvent('pointermove', {
					bubbles: true,
					cancelable: true,
					clientX: cx,
					clientY: y,
					pointerId,
					pointerType: 'touch',
					isPrimary: true
				})
			);
			ySample = readY();
		}

		handle.dispatchEvent(
			new PointerEvent('pointerup', {
				bubbles: true,
				cancelable: true,
				clientX: cx,
				clientY: cy + dy,
				pointerId,
				pointerType: 'touch',
				isPrimary: true
			})
		);
		return ySample;
	}, deltaY);

	await page.waitForTimeout(48);

	const afterReleaseY = await page.evaluate(() => {
		const sheet = document.querySelector('[data-testid="model-picker-sheet"]') as HTMLElement | null;
		if (!sheet) return 0;
		const t = getComputedStyle(sheet).transform;
		if (t === 'none') return 0;
		const m = t.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,[^,]+,\s*([^)]+)\)/);
		return m ? parseFloat(m[1]) : 0;
	});

	const mountedAfterRelease = await page.evaluate(
		() => !!document.querySelector('[data-testid="model-picker-sheet"]')
	);

	return { midY, afterReleaseY, mountedAfterRelease };
}

test.describe('spring motion engine', () => {
	test('model picker tracks finger during drag and does not snap to 0 on release', async ({
		page
	}) => {
		await openModelPickerMobile(page);

		// Sub-threshold drag (~80px) — should rubber-band back toward open, not dismiss.
		const { midY, afterReleaseY, mountedAfterRelease } = await dragModelPickerHandle(page, 80);

		expect(midY).toBeGreaterThan(30);
		expect(afterReleaseY).toBeGreaterThan(15);
		expect(mountedAfterRelease).toBe(true);
	});

	test('model picker tap-away animates closed without instant unmount', async ({ page }) => {
		await openModelPickerMobile(page);

		await page.getByTestId('model-picker-scrim').click({ force: true });

		// Next animation frame: sheet must still be mounted (spring close in flight, not timeout-unmount).
		const mountedNextFrame = await page.evaluate(async () => {
			await new Promise((r) => requestAnimationFrame(r));
			return !!document.querySelector('[data-testid="model-picker-sheet"]');
		});
		expect(mountedNextFrame).toBe(true);

		// Transform should be moving toward closed (positive Y), not snapped to 0 then gone.
		const ty = await page.evaluate(() => {
			const el = document.querySelector('[data-testid="model-picker-sheet"]') as HTMLElement | null;
			if (!el) return 0;
			const t = getComputedStyle(el).transform;
			const m = t.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,[^,]+,\s*([^)]+)\)/);
			return m ? parseFloat(m[1]) : 0;
		});
		expect(ty).toBeGreaterThan(0);
	});

	test('sidebar uses spring transform when opened on mobile', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.goto('/companion/chat');

		const panel = page.getByTestId('threads-sidebar-panel');
		const menuBtn = page.getByRole('button', { name: 'Toggle Sessions Sidebar' });

		// Ensure closed, then open.
		const closedTx = await panel.evaluate((el) => {
			const t = getComputedStyle(el).transform;
			if (t === 'none') return 0;
			const m = t.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,\s*([^,]+),/);
			return m ? Math.abs(parseFloat(m[1])) : 0;
		});
		if (Math.abs(closedTx) < 40) {
			await menuBtn.click();
			await page.waitForTimeout(400);
			await menuBtn.click();
			await page.waitForTimeout(400);
		}

		await menuBtn.click();

		await expect
			.poll(
				async () => {
					const transform = await panel.evaluate((el) => getComputedStyle(el).transform);
					return Math.abs(parseTranslateX(transform));
				},
				{ timeout: 2000 }
			)
			.toBeLessThan(8);
	});
});
