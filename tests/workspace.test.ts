// Phase 5 / 5a — workspace service: confinement + create + place + commit.
// Runs against a TEMP workspace (SULLY_WORKSPACE_ROOT) + temp uploads dir so the
// real ~/dev/sully-workspace is never touched. The security tests (traversal,
// symlink, source-outside-uploads) are the load-bearing ones.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

let WS = '';
let UPLOADS = '';

vi.mock('$lib/server/config', () => ({
	serverConfig: {
		get chatUploadsDir() {
			return UPLOADS;
		}
	}
}));

beforeEach(() => {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sully-ws-'));
	WS = path.join(base, 'workspace');
	UPLOADS = path.join(base, 'uploads');
	fs.mkdirSync(WS, { recursive: true });
	fs.mkdirSync(UPLOADS, { recursive: true });
	execFileSync('git', ['-C', WS, 'init', '-q', '-b', 'main']);
	fs.writeFileSync(path.join(WS, 'README.md'), '# ws\n');
	execFileSync('git', ['-C', WS, '-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A']);
	execFileSync('git', [
		'-C',
		WS,
		'-c',
		'user.name=t',
		'-c',
		'user.email=t@t',
		'commit',
		'-q',
		'-m',
		'init'
	]);
	process.env.SULLY_WORKSPACE_ROOT = WS;
	vi.resetModules();
});
afterEach(() => {
	delete process.env.SULLY_WORKSPACE_ROOT;
	if (WS) fs.rmSync(path.dirname(WS), { recursive: true, force: true });
});

describe('workspace — slugify', () => {
	it('normalizes + rejects empty', async () => {
		const { slugify } = await import('$lib/server/workspace');
		expect(slugify("Today's Ops!")).toBe('today-s-ops');
		expect(slugify('  Frontend  Ideas  ')).toBe('frontend-ideas');
		expect(() => slugify('!!!')).toThrow();
	});
});

describe('workspace — ensureProject', () => {
	it('creates <project>/refs/ idempotently', async () => {
		const { ensureProject, WORKSPACE_ROOT } = await import('$lib/server/workspace');
		const r1 = await ensureProject('todays-ops');
		expect(r1.dir).toBe(path.join(WORKSPACE_ROOT, 'todays-ops'));
		expect(fs.existsSync(path.join(r1.dir, 'refs'))).toBe(true);
		const r2 = await ensureProject('todays-ops'); // idempotent
		expect(r2.dir).toBe(r1.dir);
	});
	it('rejects a traversal project name (slug strips it, but cannot escape)', async () => {
		const { ensureProject, WORKSPACE_ROOT } = await import('$lib/server/workspace');
		const r = await ensureProject('../../etc/evil');
		// slugify turns ".." into hyphens → stays inside the workspace
		expect(r.dir.startsWith(WORKSPACE_ROOT + path.sep)).toBe(true);
		expect(r.dir.includes('..')).toBe(false);
	});
});

describe('workspace — placeReference (confinement)', () => {
	it('copies an upload into <project>/refs/', async () => {
		fs.writeFileSync(path.join(UPLOADS, 'mockup.png'), 'PNGDATA');
		const { placeReference, WORKSPACE_ROOT } = await import('$lib/server/workspace');
		const r = await placeReference(
			'frontend-ideas',
			path.join(UPLOADS, 'mockup.png'),
			'mockup.png'
		);
		expect(r.path).toBe(path.join(WORKSPACE_ROOT, 'frontend-ideas', 'refs', 'mockup.png'));
		expect(fs.readFileSync(r.path, 'utf8')).toBe('PNGDATA');
	});
	it('strips directory components from the name (no traversal in dest)', async () => {
		fs.writeFileSync(path.join(UPLOADS, 'a.txt'), 'x');
		const { placeReference, WORKSPACE_ROOT } = await import('$lib/server/workspace');
		// a "../../escape.txt" name must be rejected outright
		await expect(
			placeReference('p', path.join(UPLOADS, 'a.txt'), '../../escape.txt')
		).rejects.toThrow(/invalid reference name/);
	});
	it('rejects a source OUTSIDE the uploads dir', async () => {
		const outside = path.join(os.tmpdir(), 'sully-outside-' + process.pid + '.txt');
		fs.writeFileSync(outside, 'secret');
		const { placeReference } = await import('$lib/server/workspace');
		await expect(placeReference('p', outside, 'x.txt')).rejects.toThrow(/outside the uploads dir/);
		fs.rmSync(outside, { force: true });
	});
});

describe('workspace — commitWorkspace', () => {
	it('returns a sha after a change, null when nothing staged', async () => {
		const { ensureProject, commitWorkspace, WORKSPACE_ROOT } =
			await import('$lib/server/workspace');
		await ensureProject('p');
		fs.writeFileSync(path.join(WORKSPACE_ROOT, 'p', 'hello.md'), 'hi\n');
		const r = await commitWorkspace('add hello');
		expect(r.sha).toMatch(/^[0-9a-f]{7,}$/); // a real short SHA, NOT the branch name
		expect(r.sha).not.toBe('main');
		const r2 = await commitWorkspace('noop'); // nothing staged
		expect(r2.sha).toBeNull();
	});
});
