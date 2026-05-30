// Shared voice-mode runtime tuning. Lives outside the route files so the
// pre-warm endpoint (/api/chat/voice-warm) and the reply stream
// (/api/chat/voice-reply) agree on a single value.

// Holds the voice model resident across conversational pauses — longer than
// Ollama's 5-minute default — without pinning it forever: it still unloads after
// the session so the GPU frees for the operator's other models. Ollama also
// evicts under VRAM pressure, so other models continue to load on demand.
export const VOICE_KEEP_ALIVE = '10m';
