import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createThreadsController, type ThreadSummary } from '../src/lib/chat/threads.svelte';

const baseThread: ThreadSummary = {
	thread_id: 'default',
	title: 'Default',
	archived: false,
	pinned: false,
	message_count: 1,
	latest_ts: '2026-05-30T00:00:00.000Z'
};

function makeController(overrides: Partial<Parameters<typeof createThreadsController>[0]> = {}) {
	const setMessages = vi.fn();
	const setSidebarOpen = vi.fn();
	const pollMessages = vi.fn().mockResolvedValue(undefined);
	const loadTier = vi.fn().mockResolvedValue(undefined);
	const syncUrlThread = vi.fn();
	const deps = {
		getInitialThreads: () => [baseThread],
		getInitialActiveThread: () => 'default',
		setMessages,
		setSidebarOpen,
		pollMessages,
		loadTier,
		syncUrlThread,
		...overrides
	};
	return {
		ctrl: createThreadsController(deps),
		deps
	};
}

beforeEach(() => {
	vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('createThreadsController', () => {
	it('slugifies names and resolves collisions with local threads plus the DB probe', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ messages: [] })));
		const { ctrl } = makeController({
			getInitialThreads: () => [{ ...baseThread, thread_id: 'my-feature' }]
		});

		expect(ctrl.slugifyThreadName('  My Feature!!  ')).toBe('my-feature');
		expect(ctrl.slugifyThreadName('')).toBe('thread');
		await expect(ctrl.findUniqueSlug('my-feature')).resolves.toBe('my-feature-2');
		expect(fetch).toHaveBeenCalledWith('/companion/api/chat?thread=my-feature-2&limit=1');
	});

	it('syncs the URL through the injected action when switching threads', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ messages: [] })));
		const { ctrl, deps } = makeController();

		await ctrl.switchThread('next-thread');

		expect(deps.syncUrlThread).toHaveBeenCalledWith('next-thread');
	});

	it('switchThread clears messages, closes the sidebar, polls the target thread, and loads its tier', async () => {
		const { ctrl, deps } = makeController();

		await ctrl.switchThread('research');

		expect(ctrl.activeThread).toBe('research');
		expect(deps.setSidebarOpen).toHaveBeenCalledWith(false);
		expect(deps.setMessages).toHaveBeenCalledWith([]);
		expect(deps.pollMessages).toHaveBeenCalledWith('research');
		expect(deps.loadTier).toHaveBeenCalledWith('research');
	});
});
