// Tiny single-operator key/value settings store. Self-creating (mirrors the
// lazy `CREATE TABLE IF NOT EXISTS` pattern the other chat tables use), so it
// needs no entry in bootstrap.ts. Used for small persisted UI preferences like
// the active voice — survives reloads + device switches, same as last_thread.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import { serverConfig } from './config';

function openDb(): Database.Database {
	const db = new Database(serverConfig.memoryDbPath);
	db.exec(
		`CREATE TABLE IF NOT EXISTS companion_settings (
			key TEXT PRIMARY KEY,
			value TEXT,
			updated_at TEXT DEFAULT CURRENT_TIMESTAMP
		);`
	);
	return db;
}

export function getSetting(key: string): string | null {
	if (!fs.existsSync(serverConfig.memoryDbPath)) return null;
	const db = openDb();
	try {
		const row = db.prepare('SELECT value FROM companion_settings WHERE key = ?').get(key) as
			| { value?: string }
			| undefined;
		return row?.value ?? null;
	} catch (e) {
		console.error('getSetting error:', e);
		return null;
	} finally {
		db.close();
	}
}

export function setSetting(key: string, value: string): void {
	const db = openDb();
	try {
		db.prepare(
			`INSERT INTO companion_settings (key, value, updated_at)
			 VALUES (?, ?, CURRENT_TIMESTAMP)
			 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
		).run(key, value);
	} catch (e) {
		console.error('setSetting error:', e);
	} finally {
		db.close();
	}
}
