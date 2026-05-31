<script lang="ts">
	import type { StreamRow } from '$lib/chat/dispatchReconcile';

	let {
		worker,
		rows,
		status,
		resultRef,
		startedAt,
		onretry
	}: {
		worker: string;
		rows: StreamRow[];
		status: string;
		resultRef: string | null;
		startedAt: number;
		onretry?: () => void;
	} = $props();

	let elapsed = $state(0);
	$effect(() => {
		if (status !== 'working') return;
		const t = setInterval(() => {
			elapsed = Math.floor((Date.now() - startedAt) / 1000);
		}, 1000);
		return () => clearInterval(t);
	});

	const last = $derived(rows.length ? rows[rows.length - 1] : null);
	const mmss = $derived(`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`);
</script>

{#if status === 'working'}
	<div
		class="rounded-2xl border border-fuchsia-400/25 bg-fuchsia-950/15 px-4 py-3 backdrop-blur-md"
	>
		<div class="flex items-center gap-2">
			<span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-fuchsia-400"></span>
			<span class="font-mono text-[12px] tracking-wide text-fuchsia-300">
				{worker} working · {mmss}
			</span>
		</div>
		{#if last}
			<div class="mt-1.5 font-mono text-[11px] text-fuchsia-200/70">
				{last.target ? `${last.action} ${last.target}` : last.action}
			</div>
		{/if}
	</div>
{:else if status === 'done'}
	<div
		class="rounded-2xl border border-emerald-400/20 bg-emerald-950/10 px-4 py-2 text-[12px] text-emerald-200/80"
	>
		Done{resultRef ? ` — ${resultRef}` : ''}
	</div>
{:else}
	<div
		class="rounded-2xl border border-red-400/25 bg-red-950/15 px-4 py-2 text-[12px] text-red-200/80"
	>
		{status === 'aborted' ? 'Aborted' : 'Failed'}
		{#if onretry}
			<button class="ml-2 underline" onclick={onretry}>Retry</button>
		{/if}
	</div>
{/if}
