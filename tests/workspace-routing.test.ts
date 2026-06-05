// Phase 5 / 5a — artifact-build routing → sully-workspace + deriveProject.
import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: { LOGUEOS_APP_MODE: 'companion', COMPANION_DISPATCH_ENABLED: 'true' }
}));

describe('detectTargetRepo — artifact builds route to sully-workspace', () => {
	it('routes artifact-creation phrases to sully-workspace', async () => {
		const { detectTargetRepo } = await import('$lib/server/chat/stream_prepare');
		expect(detectTargetRepo('create a todays-ops project and put a hello.md in it')).toBe(
			'sully-workspace'
		);
		expect(detectTargetRepo('build me a sales dashboard')).toBe('sully-workspace');
		expect(detectTargetRepo('make a quick landing page')).toBe('sully-workspace');
		expect(detectTargetRepo('can you put this mockup together in my workspace')).toBe(
			'sully-workspace'
		);
	});
	it('does NOT steal existing-repo work', async () => {
		const { detectTargetRepo } = await import('$lib/server/chat/stream_prepare');
		expect(detectTargetRepo('fix the console build')).not.toBe('sully-workspace');
		expect(detectTargetRepo('audit the orchestrator kernel')).toBe('LogueOS-Orchestrator');
		expect(detectTargetRepo('add a settings page to miru')).toBe('project-miru'); // miru wins
	});
	it('plain chat does not route to the workspace', async () => {
		const { detectTargetRepo } = await import('$lib/server/chat/stream_prepare');
		expect(detectTargetRepo("thanks, that's helpful")).not.toBe('sully-workspace');
		expect(detectTargetRepo('what do you think of the rabbit icon?')).not.toBe('sully-workspace');
	});
	it('an explicit hint always wins', async () => {
		const { detectTargetRepo } = await import('$lib/server/chat/stream_prepare');
		expect(detectTargetRepo('fix the console build', 'sully-workspace')).toBe('sully-workspace');
	});
});

describe('deriveProject', () => {
	it('extracts a named project, else artifact', async () => {
		const { deriveProject } = await import('$lib/server/workspace');
		expect(deriveProject('create a todays-ops project and put a hello.md')).toBe('todays-ops');
		expect(deriveProject('build the ops-board dashboard')).toBe('ops-board');
		expect(deriveProject('just thinking out loud')).toBe('artifact');
	});
});
