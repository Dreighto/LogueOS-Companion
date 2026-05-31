// Thin transport seam for the "teacher" (cloud Opus / Claude Code CLI).
//
// Today this delegates to streamViaClaudeCLI (Claude Code CLI bridge).
// After 2026-06-15, swap the body of callTeacher to the Claude Agent SDK
// in ONE place — all callers (decision gate schema self-assessment, etc.)
// automatically migrate with it.
//
// The gate's schema self-assessment rides this same reply: callers append
// GATE_INSTRUCTION to messages before calling callTeacher, then parse the
// assembled text via extractGateBlock / validateGate from decisionGate.ts.

import { streamViaClaudeCLI } from './claude_cli_stream';

export interface TeacherMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface TeacherResult {
	text: string;
	error?: string;
}

/**
 * Call the cloud teacher (currently: Claude Code CLI bridge) with a message
 * list and return the full assembled text response.
 *
 * Callers are responsible for baking multi-turn context into the message list.
 * The first 'system' message is used as the system prompt; remaining messages
 * are serialised into the user prompt as a plain-text transcript.
 */
export async function callTeacher(messages: TeacherMessage[]): Promise<TeacherResult> {
	const systemMsg = messages.find((m) => m.role === 'system');
	const nonSystem = messages.filter((m) => m.role !== 'system');

	const systemPrompt = systemMsg?.content ?? '';
	// Serialise the conversation into a single user-prompt string.
	const userPrompt =
		nonSystem.length === 1
			? nonSystem[0].content
			: nonSystem.map((m) => `[${m.role}]: ${m.content}`).join('\n\n');

	let assembled = '';
	let errorMsg: string | undefined;

	for await (const chunk of streamViaClaudeCLI({
		model: 'claude-opus-4-5',
		systemPrompt,
		userPrompt
	})) {
		if (chunk.type === 'text-delta') {
			assembled += chunk.delta;
		} else if (chunk.type === 'error') {
			errorMsg = chunk.message;
		}
	}

	if (errorMsg && !assembled) {
		return { text: '', error: errorMsg };
	}
	return { text: assembled };
}
