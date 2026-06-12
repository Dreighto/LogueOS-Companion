<script lang="ts">
	// Header model picker — compact chip + mobile sheet / desktop dropdown.
	// Extracted from Composer.svelte (Phase B flagship pass).

	import PickerIcon from './PickerIcon.svelte';
	import { humanizeModelId } from '$lib/chat/model-registry';
	import type { ModelChoice, ProviderPref } from '$lib/types/chat-ui';
	import { Check, ChevronDown, X } from 'lucide-svelte';
	import { fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { TransitionConfig } from 'svelte/transition';
	import type { ActionReturn } from 'svelte/action';
	import { createSheetDrag } from '$lib/utils/sheetDrag.svelte';

	let {
		open = $bindable(false),
		selectedModelChoice,
		modelChoices,
		pickerProvider,
		lastModelUsed,
		onsetModelChoice,
		oncloseAllPopovers
	}: {
		open?: boolean;
		selectedModelChoice: ModelChoice;
		modelChoices: ModelChoice[];
		pickerProvider: ProviderPref;
		lastModelUsed: string;
		onsetModelChoice: (choice: ModelChoice) => void;
		oncloseAllPopovers: () => void;
	} = $props();

	const modelDrag = createSheetDrag({
		onDismiss: () => (open = false),
		isEnabled: () => typeof window !== 'undefined' && window.innerWidth < 1024,
		externalExit: true
	});

	function mobilePortal(node: HTMLElement): ActionReturn | void {
		if (typeof window === 'undefined') return;
		if (window.innerWidth >= 1024) return;
		document.body.appendChild(node);
		return {
			destroy() {
				if (node.parentNode === document.body) node.remove();
			}
		};
	}

	function sheetTransition(_node: Element): TransitionConfig {
		const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;
		if (isDesktop) {
			return {
				duration: 220,
				easing: cubicOut,
				css: (t) => {
					const scaleVal = 0.94 + 0.06 * t;
					return `opacity: ${t}; transform: scale(${scaleVal}); transform-origin: top center;`;
				}
			};
		}
		return {
			duration: 280,
			easing: cubicOut,
			css: (t) => {
				const y = (1 - t) * 100;
				return `opacity: ${t}; transform: translateY(${y}%);`;
			}
		};
	}

	function toggleOpen() {
		const next = !open;
		oncloseAllPopovers();
		open = next;
	}
</script>

<div class="relative min-w-0 max-w-[11rem] shrink-0">
	<button
		type="button"
		data-popover-trigger
		data-testid="model-picker-chip"
		onclick={toggleOpen}
		class="model-picker-chip flex h-9 max-w-full min-w-0 items-center gap-1.5 rounded-[var(--r-pill)] border px-2.5 font-sans transition-all active:scale-[0.96] {open
			? 'border-[var(--live-line)] bg-[var(--live-bg)] text-white'
			: 'border-[var(--glass-border)] bg-white/[0.04] text-zinc-300 hover:bg-white/[0.06] hover:text-zinc-100'}"
		aria-label={selectedModelChoice.id === 'auto' && lastModelUsed
			? `Auto — currently ${humanizeModelId(lastModelUsed)} — Model picker`
			: `${selectedModelChoice.label} — Model picker`}
		aria-expanded={open}
		title="Pick a specific model or leave on Auto"
	>
		<span class="h-1.5 w-1.5 shrink-0 rounded-[var(--r-pill)] bg-[var(--accent)]" aria-hidden="true"></span>
		<PickerIcon provider={pickerProvider} size={14} />
		<span class="flex min-w-0 flex-col items-start leading-[1.1]">
			<span class="truncate text-[11px] font-medium tracking-wide">
				{selectedModelChoice.id === 'auto' ? 'Auto' : selectedModelChoice.label}
			</span>
			{#if selectedModelChoice.id === 'auto' && lastModelUsed}
				<span class="truncate text-[9px] tracking-normal text-zinc-500">
					{humanizeModelId(lastModelUsed)}
				</span>
			{/if}
		</span>
		<ChevronDown
			size={10}
			class="shrink-0 transition-transform duration-[var(--dur-med)] {open
				? 'rotate-180 text-zinc-200'
				: 'text-zinc-500'}"
		/>
	</button>

	{#if open}
		<div
			use:mobilePortal
			class="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
			transition:fade={{ duration: 200, easing: cubicOut }}
			aria-hidden="true"
		></div>

		<div
			use:mobilePortal
			data-sheet
			data-popover
			role="dialog"
			aria-modal="true"
			aria-label="Choose a model"
			transition:sheetTransition
			class="sully-glass-popover fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col overflow-hidden rounded-t-[var(--r-lg)] border-b-0 pt-2 pb-[max(env(safe-area-inset-bottom,0px),0.5rem)] lg:absolute lg:inset-x-auto lg:top-full lg:bottom-auto lg:left-1/2 lg:mt-2 lg:max-h-[calc(100dvh-6rem)] lg:w-64 lg:max-w-[calc(100vw-2rem)] lg:-translate-x-1/2 lg:rounded-[var(--r-lg)] lg:border-b lg:pt-1 lg:pb-1"
		>
			<div class="shrink-0" style="touch-action: none;" {...modelDrag.handleProps}>
				<div
					class="mx-auto mt-1 mb-2 h-1.5 w-10 shrink-0 rounded-[var(--r-pill)] bg-white/20 lg:hidden"
					aria-hidden="true"
				></div>
				<div class="flex items-center justify-between px-3 pt-1.5 pb-0.5 font-sans select-none">
					<span class="text-[9px] tracking-wider text-zinc-600 uppercase">Model</span>
					<button
						type="button"
						onclick={() => (open = false)}
						class="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-pill)] text-zinc-500 transition-all hover:bg-white/[0.06] hover:text-zinc-200 active:scale-90"
						aria-label="Close model picker"
						title="Close"
					>
						<X size={14} />
					</button>
				</div>
			</div>
			<div
				class="overflow-y-auto overscroll-contain"
				style="touch-action: pan-y;"
				use:modelDrag.bodyAction
				{...modelDrag.bodyProps}
			>
				{#each modelChoices as choice (choice.id)}
					<button
						type="button"
						onclick={() => onsetModelChoice(choice)}
						class="flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-1.5 text-left transition-all hover:bg-white/[0.04] active:scale-[0.985] active:bg-white/[0.07]
							{selectedModelChoice.id === choice.id ? 'font-medium text-white' : 'text-zinc-200'}"
					>
						<span class="flex min-w-0 items-center gap-2.5">
							<span
								class="flex h-6 w-6 shrink-0 items-center justify-center {selectedModelChoice.id ===
								choice.id
									? 'text-white'
									: 'text-zinc-400'}"
							>
								<PickerIcon provider={choice.provider} size={16} />
							</span>
							<span class="flex min-w-0 flex-col leading-[1.15]">
								<span class="truncate text-[13px]">{choice.label}</span>
								<span class="truncate font-sans text-[10px] text-zinc-500">{choice.sublabel}</span>
							</span>
						</span>
						{#if selectedModelChoice.id === choice.id}
							<Check size={12} class="shrink-0" />
						{/if}
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>
