// PR E2: slash-commands.ts is a plain TS controller — easy to unit-test by
// passing fake deps and asserting which deps got called.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createSlashCommandsController } from '../src/lib/chat/slash-commands';

// $app/paths.resolve and $lib/utils/toasts are imported by the module — stub
// them. vi.mock factories are hoisted to the top of the file, so the toasts
// stub uses vi.hoisted() to expose the spy back to the test body.
const { toastsAdd } = vi.hoisted(() => ({ toastsAdd: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (s: string) => s }));
vi.mock('$lib/utils/toasts', () => ({ toasts: { add: toastsAdd } }));

function makeDeps(over: Partial<Parameters<typeof createSlashCommandsController>[0]> = {}) {
	return {
		getActiveThread: () => 'thread-1',
		getMessages: () => [
			{ id: 1, sender: 'operator', message: 'hi', timestamp: '' },
			{ id: 2, sender: 'cc', message: 'hello!', timestamp: '' }
		],
		setTextDraft: vi.fn(),
		clearAttachments: vi.fn(),
		focusComposer: vi.fn(),
		appendSystemMessage: vi.fn(),
		pollMessages: vi.fn(async () => undefined),
		setToolsKey: vi.fn(),
		regenerateReply: vi.fn(async () => undefined),
		createThread: vi.fn(async () => undefined),
		...over
	};
}

beforeEach(() => {
	toastsAdd.mockReset();
	const ls = {
		store: new Map<string, string>(),
		setItem(k: string, v: string) {
			this.store.set(k, v);
		},
		removeItem(k: string) {
			this.store.delete(k);
		},
		getItem(k: string) {
			return this.store.get(k) ?? null;
		}
	};
	vi.stubGlobal('localStorage', ls);
	vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
});

describe('runFromDraft', () => {
	it('returns false for non-slash input', async () => {
		const deps = makeDeps();
		const ctrl = createSlashCommandsController(deps);
		expect(await ctrl.runFromDraft('hi there')).toBe(false);
		expect(deps.setTextDraft).not.toHaveBeenCalled();
	});

	it('returns false for an unknown slash key (caller sends literal text)', async () => {
		const deps = makeDeps();
		const ctrl = createSlashCommandsController(deps);
		expect(await ctrl.runFromDraft('/notacommand')).toBe(false);
	});

	it('clears the composer BEFORE the handler runs', async () => {
		const order: string[] = [];
		const deps = makeDeps({
			setTextDraft: vi.fn(() => order.push('setTextDraft')),
			clearAttachments: vi.fn(() => order.push('clearAttachments')),
			pollMessages: vi.fn(async () => {
				order.push('pollMessages');
			})
		});
		const ctrl = createSlashCommandsController(deps);
		await ctrl.runFromDraft('/clear');
		expect(order).toEqual(['setTextDraft', 'clearAttachments', 'pollMessages']);
	});

	it('/clear posts the system marker + reconciles', async () => {
		const deps = makeDeps();
		const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
		const ctrl = createSlashCommandsController(deps);
		expect(await ctrl.runFromDraft('/clear')).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [, init] = fetchMock.mock.calls[0];
		const body = JSON.parse(init.body as string);
		expect(body.message).toBe('--- NEW CONVERSATION ---');
		expect(body.thread).toBe('thread-1');
		expect(deps.pollMessages).toHaveBeenCalledOnce();
	});

	it('/new delegates to threads.createThread with the rest', async () => {
		const deps = makeDeps();
		const ctrl = createSlashCommandsController(deps);
		await ctrl.runFromDraft('/new my-feature plans');
		expect(deps.createThread).toHaveBeenCalledWith('my-feature plans');
	});

	it('/regen targets the last non-operator non-system reply', async () => {
		const deps = makeDeps();
		const ctrl = createSlashCommandsController(deps);
		await ctrl.runFromDraft('/regen');
		expect(deps.regenerateReply).toHaveBeenCalledOnce();
		expect(deps.regenerateReply).toHaveBeenCalledWith(
			expect.objectContaining({ id: 2, sender: 'cc' })
		);
	});

	it('/regen no-ops + toasts when no assistant reply exists', async () => {
		const deps = makeDeps({
			getMessages: () => [{ id: 1, sender: 'operator', message: 'first', timestamp: '' }]
		});
		const ctrl = createSlashCommandsController(deps);
		await ctrl.runFromDraft('/regen');
		expect(deps.regenerateReply).not.toHaveBeenCalled();
		expect(toastsAdd).toHaveBeenCalledWith('No assistant reply to regenerate', 'error');
	});

	it('/unlock writes toolsKey + localStorage + emits the confirmation', async () => {
		const deps = makeDeps();
		const ctrl = createSlashCommandsController(deps);
		await ctrl.runFromDraft('/unlock abc123');
		expect(deps.setToolsKey).toHaveBeenCalledWith('abc123');
		expect(localStorage.getItem('companion-tools-key')).toBe('abc123');
		expect(deps.appendSystemMessage).toHaveBeenCalledWith(expect.stringContaining('🔓 Tools unlocked'));
	});

	it('/unlock with no code toasts an error + does NOT set the key', async () => {
		const deps = makeDeps();
		const ctrl = createSlashCommandsController(deps);
		await ctrl.runFromDraft('/unlock');
		expect(deps.setToolsKey).not.toHaveBeenCalled();
		expect(toastsAdd).toHaveBeenCalledWith(expect.stringMatching(/Paste the code/), 'error');
	});

	it('/lock clears toolsKey + localStorage', async () => {
		const deps = makeDeps();
		localStorage.setItem('companion-tools-key', 'old');
		const ctrl = createSlashCommandsController(deps);
		await ctrl.runFromDraft('/lock');
		expect(deps.setToolsKey).toHaveBeenCalledWith('');
		expect(localStorage.getItem('companion-tools-key')).toBeNull();
	});

	it('/help lists every command', async () => {
		const deps = makeDeps();
		const ctrl = createSlashCommandsController(deps);
		await ctrl.runFromDraft('/help');
		expect(deps.appendSystemMessage).toHaveBeenCalledOnce();
		const body = (deps.appendSystemMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
		for (const cmd of ctrl.commands) {
			expect(body).toContain(cmd.usage);
		}
	});

	it('catches handler exceptions + toasts (does NOT propagate)', async () => {
		const deps = makeDeps({
			createThread: vi.fn(async () => {
				throw new Error('boom');
			})
		});
		const ctrl = createSlashCommandsController(deps);
		await expect(ctrl.runFromDraft('/new x')).resolves.toBe(true);
		expect(toastsAdd).toHaveBeenCalledWith(expect.stringMatching(/boom/), 'error');
	});
});

describe('pick', () => {
	it('arg-taking command prefills the composer + focuses (does NOT run)', async () => {
		const deps = makeDeps();
		const ctrl = createSlashCommandsController(deps);
		const newCmd = ctrl.commands.find((c) => c.key === 'new')!;
		await ctrl.pick(newCmd, '');
		expect(deps.setTextDraft).toHaveBeenCalledWith('/new ');
		expect(deps.focusComposer).toHaveBeenCalledOnce();
		expect(deps.createThread).not.toHaveBeenCalled();
	});

	it('flag-only command runs immediately', async () => {
		const deps = makeDeps();
		const ctrl = createSlashCommandsController(deps);
		const helpCmd = ctrl.commands.find((c) => c.key === 'help')!;
		await ctrl.pick(helpCmd, '');
		expect(deps.appendSystemMessage).toHaveBeenCalledOnce();
	});
});
