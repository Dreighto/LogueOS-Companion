export type Autonomy = 'ask' | 'auto-safe' | 'full-auto';
export const AUTONOMY_DEFAULT: Autonomy = 'ask';
const VALID: Autonomy[] = ['ask', 'auto-safe', 'full-auto'];

export function normalizeAutonomy(raw: string | null | undefined): Autonomy {
	return VALID.includes((raw || '') as Autonomy) ? (raw as Autonomy) : AUTONOMY_DEFAULT;
}
