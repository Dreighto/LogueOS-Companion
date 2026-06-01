// Thin re-export — the canonical picker catalog now lives in model-registry.ts
// (the single source of truth shared with the server's model_catalog.ts). This
// alias keeps the existing `import { MODEL_CHOICES } from '$lib/chat/model-choices'`
// in chat/+page.svelte working unchanged.
export { MODEL_REGISTRY as MODEL_CHOICES } from './model-registry';
