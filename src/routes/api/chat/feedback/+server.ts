// POST /api/chat/feedback — operator's explicit thumbs-up/down on an
// assistant reply. Persists to chat_messages.quality_signal so the
// fine-tune extractor can harvest explicit positives alongside the
// implicit-from-correction-absence signal it already uses.
//
// Body: { message_id: number, signal: 1 | -1 | 0 }
//   signal === 0 clears any prior signal.
//
// Returns 200 { ok: true, message_id, signal } on success.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setMessageQualitySignal } from '$lib/server/chat';

export const POST: RequestHandler = async ({ request }) => {
	let body: { message_id?: unknown; signal?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'invalid JSON body' }, { status: 400 });
	}

	const messageId = Number(body.message_id);
	if (!Number.isInteger(messageId) || messageId <= 0) {
		return json({ error: 'message_id must be a positive integer' }, { status: 400 });
	}

	const raw = Number(body.signal);
	if (raw !== 1 && raw !== -1 && raw !== 0) {
		return json({ error: 'signal must be 1, -1, or 0' }, { status: 400 });
	}

	const stored: 1 | -1 | null = raw === 0 ? null : (raw as 1 | -1);
	const updated = setMessageQualitySignal(messageId, stored);
	if (!updated) {
		return json({ error: 'message not found' }, { status: 404 });
	}

	return json({ ok: true, message_id: messageId, signal: stored });
};
