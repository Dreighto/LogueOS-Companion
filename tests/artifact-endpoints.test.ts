import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-endpoints-'));
const tmpDb = path.join(tmpRoot, 'companion.db');
const workspacePath = path.join(tmpRoot, 'workspace');
const traceId = 'sully-artifact-test';
const unknownTrace = 'sully-unknown-trace';

fs.mkdirSync(path.join(workspacePath, 'data', 'audits'), { recursive: true });
fs.writeFileSync(path.join(workspacePath, 'data', 'audits', 'foo.md'), '# Foo\n');
fs.writeFileSync(path.join(workspacePath, 'data', 'audits', 'bar.json'), '{"ok":true}\n');

vi.mock('$env/dynamic/private', () => ({
	env: {
		LOGUEOS_MEMORY_DB_PATH: tmpDb,
		LOGUEOS_ARTIFACT_WORKSPACE_DEFAULT: workspacePath
	}
}));

process.env.LOGUEOS_ARTIFACT_WORKSPACE_DEFAULT = workspacePath;

function seedDb() {
	const db = new Database(tmpDb);
	db.exec(`
		CREATE TABLE pending_jobs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			trace_id TEXT UNIQUE NOT NULL,
			worker TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'working',
			category TEXT NOT NULL DEFAULT 'general',
			current_activity TEXT,
			seq_cursor INTEGER NOT NULL DEFAULT 0,
			started_at TEXT DEFAULT CURRENT_TIMESTAMP,
			ended_at TEXT,
			predicted_tokens INTEGER NOT NULL DEFAULT 0,
			actual_prompt INTEGER,
			actual_completion INTEGER,
			actual_cache_read INTEGER,
			actual_cache_creation INTEGER,
			actual_total INTEGER,
			result_ref TEXT,
			brief TEXT NOT NULL DEFAULT '',
			fingerprint TEXT NOT NULL DEFAULT '',
			ticket_id TEXT,
			workspace_path TEXT
		);

		CREATE TABLE chat_activity (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			trace_id TEXT NOT NULL,
			action TEXT NOT NULL,
			target TEXT,
			payload TEXT,
			timestamp TEXT DEFAULT CURRENT_TIMESTAMP
		);
	`);

	db.prepare(
		`INSERT INTO pending_jobs (trace_id, worker, status, brief, ticket_id, workspace_path, started_at)
		 VALUES (?, 'claude-code', 'working', 'Artifact test', 'PRO-999', ?, '2026-06-07T20:45:39Z')`
	).run(traceId, workspacePath);

	db.prepare(
		`INSERT INTO chat_activity (trace_id, action, target, timestamp) VALUES
		 (?, 'wrote_file', 'data/audits/foo.md', '2026-06-07T20:45:39Z'),
		 (?, 'wrote_file', 'data/audits/bar.json', '2026-06-07T20:46:10Z')`
	).run(traceId, traceId);

	db.close();
}

function readZipEntries(buf: Buffer): Map<string, Buffer> {
	const entries = new Map<string, Buffer>();
	let i = 0;
	while (i + 4 <= buf.length) {
		if (buf.readUInt32LE(i) !== 0x04034b50) break;
		const nameLen = buf.readUInt16LE(i + 26);
		const extraLen = buf.readUInt16LE(i + 28);
		const compSize = buf.readUInt32LE(i + 18);
		const name = buf.subarray(i + 30, i + 30 + nameLen).toString('utf8');
		const dataStart = i + 30 + nameLen + extraLen;
		entries.set(name, buf.subarray(dataStart, dataStart + compSize));
		i = dataStart + compSize;
	}
	return entries;
}

const META_KEYS = [
	'created_by',
	'task_id',
	'trace_id',
	'timestamp',
	'source_worker',
	'workspace_path',
	'artifact_type',
	'original_path',
	'artifact_url'
] as const;

const HEADER_KEYS = [
	'x-artifact-created-by',
	'x-artifact-task-id',
	'x-artifact-trace-id',
	'x-artifact-timestamp',
	'x-artifact-source-worker',
	'x-artifact-workspace-path',
	'x-artifact-type',
	'x-artifact-original-path',
	'x-artifact-url'
] as const;

beforeAll(() => {
	seedDb();
});

afterAll(() => {
	fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('artifact endpoints', () => {
	it('GET listing for existing trace with 2 wrote_file rows → 2 artifacts with full metadata', async () => {
		const { GET } = await import('../src/routes/api/artifacts/[trace_id]/+server');
		const res = await (GET as (e: { params: { trace_id: string } }) => Promise<Response>)({
			params: { trace_id: traceId }
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.trace_id).toBe(traceId);
		expect(body.task_id).toBe('PRO-999');
		expect(body.count).toBe(2);
		expect(body.bundle_url).toBe(`/companion/api/artifacts/${traceId}/bundle.zip`);
		expect(body.artifacts).toHaveLength(2);
		for (const artifact of body.artifacts) {
			for (const key of META_KEYS) {
				expect(artifact[key]).toBeTruthy();
			}
			expect(artifact.created_by).toBe('CC');
			expect(artifact.source_worker).toBe('claude-code');
			expect(artifact.workspace_path).toBe(workspacePath);
		}
		expect(body.artifacts[0].artifact_type).toBe('doc');
		expect(body.artifacts[1].artifact_type).toBe('data');
	});

	it('GET listing for unknown trace → 404', async () => {
		const { GET } = await import('../src/routes/api/artifacts/[trace_id]/+server');
		const res = await (GET as (e: { params: { trace_id: string } }) => Promise<Response>)({
			params: { trace_id: unknownTrace }
		});
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'trace_not_found' });
	});

	it('GET single file → 200 + correct Content-Type + all 9 X-Artifact headers', async () => {
		const { GET } = await import('../src/routes/api/artifacts/[trace_id]/[...filepath]/+server');
		const res = await (
			GET as (e: {
				params: { trace_id: string; filepath: string };
				url: URL;
				request: Request;
			}) => Promise<Response>
		)({
			params: { trace_id: traceId, filepath: 'data/audits/foo.md' },
			url: new URL(`http://localhost/companion/api/artifacts/${traceId}/data/audits/foo.md`),
			request: new Request('http://localhost/companion/api/artifacts/test')
		});
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
		for (const key of HEADER_KEYS) {
			expect(res.headers.get(key)).toBeTruthy();
		}
		expect(res.headers.get('x-artifact-created-by')).toBe('CC');
		expect(res.headers.get('x-artifact-original-path')).toBe('data/audits/foo.md');
		expect(await res.text()).toContain('# Foo');
	});

	it('GET single file with .. in path → 403/404 (auth boundary holds)', async () => {
		const { GET } = await import('../src/routes/api/artifacts/[trace_id]/[...filepath]/+server');
		const event = {
			params: { trace_id: traceId, filepath: 'data/../../outside.txt' },
			url: new URL(
				`http://localhost/companion/api/artifacts/${traceId}/data/../../outside.txt`
			),
			request: new Request('http://localhost/companion/api/artifacts/test')
		};
		try {
			const res = await (
				GET as (e: typeof event) => Promise<Response>
			)(event);
			expect([403, 404]).toContain(res.status);
		} catch (err: unknown) {
			const status = (err as { status?: number }).status;
			expect([403, 404]).toContain(status);
		}
	});

	it('GET single file with ?meta=1 → JSON sidecar (not the file body)', async () => {
		const { GET } = await import('../src/routes/api/artifacts/[trace_id]/[...filepath]/+server');
		const res = await (
			GET as (e: {
				params: { trace_id: string; filepath: string };
				url: URL;
				request: Request;
			}) => Promise<Response>
		)({
			params: { trace_id: traceId, filepath: 'data/audits/foo.md' },
			url: new URL(
				`http://localhost/companion/api/artifacts/${traceId}/data/audits/foo.md?meta=1`
			),
			request: new Request('http://localhost/companion/api/artifacts/test')
		});
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('application/json');
		for (const key of HEADER_KEYS) {
			expect(res.headers.get(key)).toBeTruthy();
		}
		const meta = await res.json();
		for (const key of META_KEYS) {
			expect(meta[key]).toBeTruthy();
		}
		expect(meta.original_path).toBe('data/audits/foo.md');
	});

	it('GET single file with ?download=1 → Content-Disposition: attachment', async () => {
		const { GET } = await import('../src/routes/api/artifacts/[trace_id]/[...filepath]/+server');
		const res = await (
			GET as (e: {
				params: { trace_id: string; filepath: string };
				url: URL;
				request: Request;
			}) => Promise<Response>
		)({
			params: { trace_id: traceId, filepath: 'data/audits/foo.md' },
			url: new URL(
				`http://localhost/companion/api/artifacts/${traceId}/data/audits/foo.md?download=1`
			),
			request: new Request('http://localhost/companion/api/artifacts/test')
		});
		expect(res.status).toBe(200);
		expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
	});

	it('GET bundle.zip → 200 + ZIP body + manifest.json present + correct files inside', async () => {
		const { GET } = await import('../src/routes/api/artifacts/[trace_id]/bundle.zip/+server');
		const res = await (GET as (e: { params: { trace_id: string } }) => Promise<Response>)({
			params: { trace_id: traceId }
		});
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('application/zip');
		expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="task-/);

		const buf = Buffer.from(await res.arrayBuffer());
		expect(buf.subarray(0, 2).toString('utf8')).toBe('PK');
		const entries = readZipEntries(buf);
		expect(entries.has('manifest.json')).toBe(true);
		expect(entries.has('data/audits/foo.md')).toBe(true);
		expect(entries.has('data/audits/bar.json')).toBe(true);

		const manifest = JSON.parse(entries.get('manifest.json')!.toString('utf8'));
		expect(manifest).toHaveLength(2);
		expect(manifest[0].original_path).toBe('data/audits/foo.md');
		expect(entries.get('data/audits/foo.md')!.toString('utf8')).toContain('# Foo');
	});
});
