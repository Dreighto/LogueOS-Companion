<script lang="ts">
	// Chat header — sidebar-toggle + home-anchor logo + workspace-context
	// chip + model-picker chip, with the model picker's popover.
	// Extracted from /chat as Task #7 PR 3 of the +page.svelte decomposition.
	//
	// Self-contained markup, but state crossing the boundary stays as props +
	// callbacks (no store). The parent owns all $state runes; bindable props
	// are used where the parent's global popover-close $effect needs to read
	// the value by name (`showModelOverrideModal`, `workspaceContextOpen`).
	//
	// The `selectedModelChoice` $derived stays in the parent (it reads
	// `operatorOverride`, `currentTier`, `providerOverride` from parent
	// scope); the resolved value is passed in as a prop. The MODEL_CHOICES
	// table is also owned by the parent and passed in — single source of
	// truth.
	//
	// The workspace-context chip (added 2026-06-01) is a persistent
	// header-level entry point to the Edit Sully's context modal. It REPLACES
	// the old footer item that lived inside the model-picker popover — the
	// chip sits as the first child of the right-side cluster, BEFORE the
	// model picker, so the cluster reads left-to-right as Context | Model.
	// Tap target mirrors the model-picker chip exactly (min-h-[44px] on
	// mobile, h-9 on sm+) for spatial harmony. Active state mirrors the
	// model-picker open state (brand-tinted magenta) so when the modal is
	// open the chip glows in the same idiom. Driven by `workspaceContextOpen`
	// (bindable so the parent's global popover-close effect can null it).
	//
	// ARIA labels (`Toggle Sessions Sidebar`, `Sully — home`), and the
	// `data-popover` / `data-popover-trigger` attributes are load-bearing —
	// the chat e2e suite and the parent's global popover effect select on
	// them. Do not change.
	//
	// The model-picker button's aria-label is dynamic and prefixes the
	// visible text (e.g. `Auto — Model picker`, `Sonnet 4.6 — Model picker`)
	// to satisfy WCAG 2.5.3 (Label in Name); axe / Lighthouse flagged the
	// previous static `Model picker` label as a content-name mismatch.
	// Selectors should target `[data-popover-trigger]` instead of the
	// aria-label.

	import { base, resolve } from '$app/paths';
	import { Menu, ChevronDown, Check, BookOpen } from 'lucide-svelte';
	import { fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { TransitionConfig } from 'svelte/transition';
	import type { ActionReturn } from 'svelte/action';
	import type { ModelChoice } from '$lib/types/chat-ui';

	// Portal action — moves the node to <body> on mount, removes it on
	// destroy. Used ONLY on mobile (< lg) so the model-picker sheet + its
	// backdrop scrim escape the chat-header's backdrop-filter ancestor,
	// which (per CSS spec) creates a containing block for position:fixed
	// descendants and would otherwise crush the sheet into a 64px strip
	// at the top of the header. Desktop (lg+) leaves the popover in place
	// so its `lg:absolute lg:top-full lg:right-0` can anchor against the
	// trigger chip's wrapping `<div class="relative">` — portaling there
	// would break the anchor. Viewport captured ONCE at mount; rotating
	// the device while the picker is open is a known edge case we accept.
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

	let {
		tierEmoji,
		lastModelUsed,
		selectedModelChoice,
		MODEL_CHOICES,
		showModelOverrideModal = $bindable(),
		workspaceContextOpen = $bindable(false),
		ontoggleSidebar,
		onsetModelChoice,
		onopenWorkspaceContext,
		oncloseAllPopovers
	}: {
		tierEmoji: string;
		lastModelUsed: string;
		selectedModelChoice: ModelChoice;
		MODEL_CHOICES: ModelChoice[];
		showModelOverrideModal: boolean;
		// Bindable so the parent's global popover-close $effect can mirror its
		// own `workspaceContextOpen` $state here; drives the chip's brand-tinted
		// active state only. Defaults to false so callers that haven't wired the
		// prop yet still get a functioning (always-resting) chip.
		workspaceContextOpen?: boolean;
		ontoggleSidebar: () => void;
		onsetModelChoice: (choice: ModelChoice) => void;
		onopenWorkspaceContext: () => void;
		oncloseAllPopovers: () => void;
	} = $props();

	// Responsive transition for the model-picker surface.
	//
	// Branches on viewport width ONCE at transition start so the orientation
	// stays consistent if the user rotates mid-animation. Below lg (1024px)
	// the picker is a bottom-anchored sheet that slides up + fades in
	// (sheets feel cheap when they also scale, so we deliberately do NOT
	// scale on mobile). At lg+ the picker is a top-right-anchored dropdown
	// that uses the original scale-from-0.94 + fade recipe with
	// `transform-origin: top right` so it reads as blooming out of the
	// trigger chip. SSR-safe via the `typeof window` guard.
	function sheetTransition(_node: Element): TransitionConfig {
		const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;
		if (isDesktop) {
			return {
				duration: 220,
				easing: cubicOut,
				css: (t) => {
					const scaleVal = 0.94 + 0.06 * t;
					return `opacity: ${t}; transform: scale(${scaleVal}); transform-origin: top right;`;
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
</script>

<header
	class="relative z-50 flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.05] bg-[#0b0b0d]/55 px-4 pt-3 pb-2 backdrop-blur-2xl select-none"
	style="padding-top: max(0.75rem, calc(env(safe-area-inset-top, 0px) + 0.5rem));"
>
	<div class="flex shrink-0 items-center gap-1.5">
		<!-- Sidebar toggle button -->
		<button
			type="button"
			onclick={ontoggleSidebar}
			class="flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.03] text-zinc-400 transition-all hover:bg-white/[0.07] hover:text-white active:scale-90 sm:h-9 sm:w-9 lg:hidden"
			aria-label="Toggle Sessions Sidebar"
			title="Toggle Sessions Sidebar"
		>
			<Menu size={16} />
		</button>

		<!-- Sully identity — her glossy "thought-drop" face + name -->
		<a
			href={resolve('/')}
			aria-label="Sully — home"
			class="ml-0.5 flex items-center gap-2 transition-opacity hover:opacity-80"
		>
			<img
				src="{base}/sully-mark.png"
				alt=""
				class="h-8 w-8 shrink-0 drop-shadow-[0_0_10px_rgba(236,45,120,0.5)]"
			/>
			<span class="font-sans text-sm font-semibold tracking-tight text-zinc-100">Sully</span>
		</a>
	</div>

	<!-- Right-side cluster: workspace-context chip THEN model-picker chip.
	     The two chips share every geometric + material token (border alpha,
	     backdrop-blur, rounded-full, height ladder, motion) so they read as
	     a coherent pair, with `gap-1.5` matching the left cluster rhythm. -->
	<div class="flex min-w-0 shrink-0 items-center gap-1.5">
		<!-- Workspace context chip — persistent header entry point to the
		     Edit Sully's context modal. Replaces the old footer entry that
		     lived inside the model-picker popover. Single-tap to open the
		     modal; the modal IS the editor. Label is state-agnostic
		     ('Context') — the set/unset axis lives behind the tap (modal
		     opens to the current addendum or an empty editor). BookOpen icon
		     reads as 'reference material Sully consults', which is what
		     workspace context IS (a standing addendum injected into every
		     prompt). Active state borrows the model-picker open recipe
		     verbatim so the two chips glow in the same idiom. -->
		<button
			type="button"
			onclick={() => {
				oncloseAllPopovers();
				onopenWorkspaceContext();
			}}
			class="flex min-h-[44px] min-w-0 items-center gap-1.5 rounded-full border px-3 font-sans text-xs backdrop-blur-md transition-all active:scale-95 sm:h-9 sm:min-h-0 {workspaceContextOpen
				? 'border-[#ec2d78]/40 bg-[#ec2d78]/10 text-white shadow-[0_0_18px_rgba(236,45,120,0.15)]'
				: 'border-white/[0.07] bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08] hover:text-white'}"
			aria-label="Sully's workspace context"
			aria-haspopup="dialog"
			aria-expanded={workspaceContextOpen}
			title="Edit the notes Sully sees on every message"
		>
			<BookOpen
				size={12}
				class={workspaceContextOpen ? 'shrink-0 text-[#ff7eb3]' : 'shrink-0 text-zinc-500'}
				aria-hidden="true"
			/>
			<span
				class="font-sans text-[10px] tracking-wide {workspaceContextOpen
					? 'text-zinc-100'
					: 'text-zinc-400'}">Context</span
			>
		</button>

		<!-- Model Picker Badge -->
		<div class="relative min-w-0">
			<button
				type="button"
				data-popover-trigger
				onclick={() => {
					const next = !showModelOverrideModal;
					oncloseAllPopovers();
					showModelOverrideModal = next;
				}}
				class="flex min-h-[44px] max-w-[8.5rem] min-w-0 items-center gap-1.5 rounded-full border px-3 font-sans text-xs backdrop-blur-md transition-all active:scale-95 sm:h-9 sm:min-h-0 {showModelOverrideModal
					? 'border-[#ec2d78]/40 bg-[#ec2d78]/10 text-white shadow-[0_0_18px_rgba(236,45,120,0.15)]'
					: 'border-white/[0.07] bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08] hover:text-white'}"
				aria-label={`${selectedModelChoice.id === 'auto' ? lastModelUsed || 'Auto' : selectedModelChoice.label} — Model picker`}
				title="Pick a specific model or leave on Auto"
			>
				<span class="shrink-0">{tierEmoji}</span>
				<span
					class="min-w-0 truncate font-sans text-[10px] tracking-wide {showModelOverrideModal
						? 'text-zinc-100'
						: 'text-zinc-400'}"
					>{selectedModelChoice.id === 'auto'
						? lastModelUsed || 'Auto'
						: selectedModelChoice.label}</span
				>
				<ChevronDown
					size={10}
					class="shrink-0 transition-transform duration-200 {showModelOverrideModal
						? 'rotate-180 text-[#ff7eb3]'
						: 'text-zinc-500'}"
				/>
			</button>

			{#if showModelOverrideModal}
				<!-- Backdrop scrim — mobile-only visual dim under the bottom
				     sheet. The +page.svelte global popover-close $effect handles
				     tap-to-dismiss because the scrim sits OUTSIDE [data-popover]
				     / [data-popover-trigger]. Intentionally NOT a <button> and
				     intentionally MISSING data-popover — either would defeat
				     the global click-outside path. -->
				<div
					use:mobilePortal
					class="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
					transition:fade={{ duration: 200, easing: cubicOut }}
					aria-hidden="true"
				></div>

				<!-- Below lg: bottom-anchored sheet flush with screen edge
				     (border-b-0, rounded only at the top, padding absorbs the
				     home-indicator inset via env(safe-area-inset-bottom)).
				     At lg+: top-right-anchored dropdown blooming out of the
				     trigger chip via the custom transition. The data-popover
				     attribute is load-bearing for the parent's global
				     click-outside popover-close $effect. -->
				<!-- role="dialog" + aria-modal makes the portaled sheet its own
				     a11y landmark (axe flags portaled-to-body fixed elements as
				     "page content should be contained by landmarks" otherwise).
				     aria-label is the dialog's accessible name. Desktop dropdown
				     ALSO carries these attrs — harmless on a non-portaled popover
				     and keeps the markup branchless. -->
				<div
					use:mobilePortal
					data-popover
					role="dialog"
					aria-modal="true"
					aria-label="Choose a model"
					transition:sheetTransition
					class="fixed inset-x-0 bottom-0 z-50 max-h-[80dvh] overflow-y-auto overscroll-contain rounded-t-2xl border border-b-0 border-white/[0.08] bg-[#0e0e11]/85 pt-2 pb-[max(env(safe-area-inset-bottom,0px),0.5rem)] shadow-2xl backdrop-blur-2xl lg:absolute lg:inset-x-auto lg:top-full lg:right-0 lg:bottom-auto lg:mt-2 lg:max-h-[calc(100dvh-6rem)] lg:w-64 lg:max-w-[calc(100vw-1rem)] lg:rounded-2xl lg:border-b lg:pt-1 lg:pb-1"
				>
					<!-- Drag-handle affordance — purely visual, communicates
					     'this is a dismissable sheet'. The scrim tap / Escape
					     / re-tap-chip paths actually do the dismissal; we are
					     NOT wiring drag-to-dismiss gesture handling. -->
					<div
						class="mx-auto mt-1 mb-2 h-1.5 w-10 shrink-0 rounded-full bg-white/20 lg:hidden"
						aria-hidden="true"
					></div>
					<div
						class="px-3 pt-1.5 pb-0.5 font-sans text-[9px] tracking-wider text-zinc-600 uppercase select-none"
					>
						Model
					</div>
					{#each MODEL_CHOICES as choice (choice.id)}
						<button
							type="button"
							onclick={() => onsetModelChoice(choice)}
							class="flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-1.5 text-left transition-all hover:bg-white/[0.04] active:scale-[0.985] active:bg-white/[0.07]
								{selectedModelChoice.id === choice.id ? 'font-medium text-[#ff7eb3]' : 'text-zinc-200'}"
						>
							<span class="flex min-w-0 flex-col leading-[1.15]">
								<span class="truncate text-[13px]">{choice.label}</span>
								<span class="truncate font-sans text-[10px] text-zinc-500">{choice.sublabel}</span>
							</span>
							{#if selectedModelChoice.id === choice.id}
								<Check size={12} class="shrink-0" />
							{/if}
						</button>
					{/each}
					<!-- (The Edit Sully's context entry that used to live here
					     was relocated 2026-06-01 to a persistent chip in the
					     header itself — see the BookOpen chip above. The model
					     picker is now single-purpose: brain selection only.) -->
				</div>
			{/if}
		</div>
	</div>
</header>
