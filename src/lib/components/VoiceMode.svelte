<script lang="ts">
	// Immersive full-screen Voice Mode overlay. Renders the realtime voice
	// controller's state: a phase-reactive orb, the operator's live transcript,
	// the companion's streaming reply (toggleable), and the turn controls.
	// Two modes:
	//   • continuous (hands-free) — mic always live, server VAD endpoints the turn;
	//     the big button is MUTE, tap the orb to interrupt a reply.
	//   • ptt — press-and-hold the big button to talk.
	// All audio/STT/TTS logic lives in the controller
	// ($lib/chat/realtime-voice.svelte.ts); this component is presentation +
	// gesture wiring.

	import { dev } from '$app/environment';
	import {
		Mic,
		MicOff,
		X,
		Captions,
		CaptionsOff,
		Loader2,
		AudioLines,
		AlertCircle,
		Hand,
		Info,
		Drama,
		ChevronDown,
		Check,
		Infinity as InfinityIcon,
		MoreHorizontal
	} from 'lucide-svelte';
	import SullyAvatar from './SullyAvatar.svelte';
	import type { RealtimeVoiceController } from '$lib/chat/realtime-voice.svelte';
	import { mapVoicePhase } from '$lib/chat/voice-mode.svelte';

	let { voice }: { voice: RealtimeVoiceController } = $props();

	const VOICE_STARTERS = [
		{ label: "What's running?", text: "What's currently running on the system?" },
		{ label: 'Summarize today', text: 'Summarize what happened today.' },
		{ label: 'Check tasks', text: 'What tasks are active right now?' },
		{ label: 'Quick status', text: 'Give me a quick status update.' }
	] as const;

	// ── Diagnostic: mic permission + PWA install state ──────────────────
	type MicProbe = {
		permission: 'granted' | 'prompt' | 'denied' | 'unsupported' | 'pending';
		standalone: boolean;
		displayMode: string;
		secureContext: boolean;
		hostname: string;
		userAgent: string;
	};
	let probe = $state<MicProbe>({
		permission: 'pending',
		standalone: false,
		displayMode: '',
		secureContext: false,
		hostname: '',
		userAgent: ''
	});
	let showProbe = $state(false);
	let showVoicePicker = $state(false);
	let showSettings = $state(false);

	const debugUnlocked = $derived(
		dev ||
			(typeof window !== 'undefined' &&
				new URLSearchParams(window.location.search).get('debug') === '1')
	);

	async function runProbe(): Promise<void> {
		const result: MicProbe = {
			permission: 'unsupported',
			standalone: false,
			displayMode: 'unknown',
			secureContext: false,
			hostname: '',
			userAgent: ''
		};
		if (typeof window === 'undefined') {
			probe = result;
			return;
		}
		result.hostname = location.hostname;
		result.userAgent = navigator.userAgent.slice(0, 80);
		result.secureContext = window.isSecureContext;
		const std = (navigator as Navigator & { standalone?: boolean }).standalone;
		result.standalone = std === true;
		const modes = ['standalone', 'fullscreen', 'minimal-ui', 'browser'];
		for (const m of modes) {
			if (window.matchMedia?.(`(display-mode: ${m})`).matches) {
				result.displayMode = m;
				break;
			}
		}
		try {
			if (navigator.permissions?.query) {
				const status = await navigator.permissions.query({
					name: 'microphone' as PermissionName
				});
				result.permission = status.state as MicProbe['permission'];
			}
		} catch {
			result.permission = 'unsupported';
		}
		probe = result;
	}

	$effect(() => {
		if (voice.open) void runProbe();
	});

	$effect(() => {
		const onVisible = () => {
			if (document.visibilityState === 'visible') {
				voice.resumeAudio();
				void runProbe();
			}
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => document.removeEventListener('visibilitychange', onVisible);
	});

	$effect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') void voice.exit();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	function onPressDown(e: PointerEvent) {
		e.preventDefault();
		void voice.pressStart();
	}
	function onPressUp(e: PointerEvent) {
		e.preventDefault();
		voice.pressEnd();
	}

	const isError = $derived(voice.phase === 'error');
	const isConnecting = $derived(voice.phase === 'connecting');
	const isContinuous = $derived(voice.mode === 'continuous');
	const interruptible = $derived(voice.phase === 'thinking' || voice.phase === 'speaking');
	const activeVoiceLabel = $derived(
		voice.voices.find((v) => v.id === voice.voiceId)?.label ?? voice.voiceId
	);

	const statusLabel = $derived.by(() => {
		if (voice.phase === 'error') return 'Something went wrong';
		if (voice.phase === 'connecting') return 'Waking the voice…';
		if (isContinuous && voice.muted) return 'Muted — tap the mic to talk';
		if (voice.phase === 'listening') return 'Listening…';
		if (voice.phase === 'thinking') return 'Thinking…';
		if (voice.phase === 'speaking')
			return isContinuous ? 'Speaking — tap to interrupt' : 'Speaking — hold to interrupt';
		return isContinuous ? 'Paused' : 'Hold to talk';
	});

	const voiceAvatarState = $derived(
		voice.phase === 'speaking'
			? 'speaking'
			: voice.phase === 'thinking' || isConnecting
				? 'thinking'
				: voice.phase === 'listening' && !voice.muted
					? 'listening'
					: 'idle'
	);

	const uiState = $derived(mapVoicePhase(voice.phase));

	const operatorCaption = $derived(voice.partial || voice.userText);
	const operatorCaptionVisible = $derived(uiState === 'LISTENING' && operatorCaption.length > 0);

	const showIdleStarters = $derived(
		uiState === 'IDLE' &&
			!isConnecting &&
			!isError &&
			!voice.replyText &&
			!operatorCaptionVisible
	);

	function closeMenus() {
		showSettings = false;
		showVoicePicker = false;
	}
</script>

{#if voice.open}
	<div
		class="voice-mode-overlay fixed inset-0 z-[100] flex flex-col text-[var(--t1)]"
		role="dialog"
		aria-modal="true"
		aria-label="Voice mode"
	>
		<!-- Header — quiet chrome, close always visible -->
		<div
			class="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2"
		>
			<div class="flex items-center gap-2 text-sm font-medium text-[var(--t3)]">
				<AudioLines size={16} class="text-brand" />
				<span>Voice</span>
			</div>
			<div class="flex items-center gap-1">
				<div class="relative">
					<button
						type="button"
						onclick={() => {
							showSettings = !showSettings;
							showVoicePicker = false;
						}}
						disabled={isConnecting || isError}
						class="icon-btn text-[var(--t3)] disabled:opacity-40"
						aria-label="Voice settings"
						aria-expanded={showSettings}
						title="Settings"
					>
						<MoreHorizontal size={20} />
					</button>
					{#if showSettings}
						<div
							class="popover-panel absolute top-12 right-0 z-20 w-56 p-1"
							role="menu"
						>
							{#if voice.voices.length > 1}
								<button
									type="button"
									role="menuitem"
									onclick={() => {
										showVoicePicker = !showVoicePicker;
									}}
									class="flex w-full items-center gap-2 rounded-[var(--r-sm)] px-3 py-2 text-left text-sm text-[var(--t2)] transition hover:bg-[var(--bg3)]"
								>
									<Drama size={16} class="text-brand" />
									<span class="flex-1 truncate">{activeVoiceLabel}</span>
									<ChevronDown size={14} class={showVoicePicker ? 'rotate-180' : ''} />
								</button>
								{#if showVoicePicker}
									<div class="mb-1 border-t border-[var(--line)] pt-1">
										{#each voice.voices as v (v.id)}
											<button
												type="button"
												role="menuitemradio"
												aria-checked={v.id === voice.voiceId}
												onclick={() => {
													void voice.setVoice(v.id);
													showVoicePicker = false;
												}}
												class="flex w-full items-start gap-2 rounded-[var(--r-sm)] px-3 py-2 text-left transition hover:bg-[var(--bg3)]"
											>
												<Check
													size={16}
													class={v.id === voice.voiceId
														? 'mt-0.5 shrink-0 text-[var(--green)]'
														: 'mt-0.5 shrink-0 text-transparent'}
												/>
												<span class="flex flex-col">
													<span class="text-sm text-[var(--t1)]">{v.label}</span>
													<span class="text-[11px] text-[var(--t4)]">{v.blurb}</span>
												</span>
											</button>
										{/each}
									</div>
								{/if}
							{/if}
							<button
								type="button"
								role="menuitem"
								onclick={() => voice.toggleMode()}
								disabled={isConnecting || isError}
								class="flex w-full items-center gap-2 rounded-[var(--r-sm)] px-3 py-2 text-left text-sm text-[var(--t2)] transition hover:bg-[var(--bg3)] disabled:opacity-40"
							>
								{#if isContinuous}
									<InfinityIcon size={16} class="text-brand" />
									<span>Hands-free</span>
								{:else}
									<Hand size={16} class="text-brand" />
									<span>Push to talk</span>
								{/if}
							</button>
							<button
								type="button"
								role="menuitem"
								onclick={() => voice.toggleCaptions()}
								class="flex w-full items-center gap-2 rounded-[var(--r-sm)] px-3 py-2 text-left text-sm text-[var(--t2)] transition hover:bg-[var(--bg3)]"
							>
								{#if voice.captions}
									<Captions size={16} class="text-brand" />
									<span>Captions on</span>
								{:else}
									<CaptionsOff size={16} class="text-brand" />
									<span>Captions off</span>
								{/if}
							</button>
							{#if debugUnlocked}
								<button
									type="button"
									role="menuitem"
									onclick={() => {
										showProbe = !showProbe;
										closeMenus();
									}}
									class="flex w-full items-center gap-2 rounded-[var(--r-sm)] px-3 py-2 text-left text-sm text-[var(--t2)] transition hover:bg-[var(--bg3)]"
								>
									<Info size={16} class="text-brand" />
									<span>Mic diagnostic</span>
								</button>
							{/if}
						</div>
					{/if}
				</div>
				<button
					type="button"
					onclick={() => void voice.exit()}
					class="icon-btn text-[var(--t3)]"
					aria-label="Close voice mode"
					title="Close voice mode"
				>
					<X size={22} />
				</button>
			</div>
		</div>

		{#if showProbe && debugUnlocked}
			<div
				class="mx-4 mb-2 rounded-[var(--r-sm)] border border-[var(--line2)] bg-[var(--glass-bg)] px-3 py-2 font-sans text-[11px] text-[var(--t2)] backdrop-blur"
			>
				<div class="mb-1 flex items-center justify-between text-[var(--t3)]">
					<span>diagnostic</span>
					<button
						type="button"
						onclick={() => void runProbe()}
						class="rounded px-2 py-0.5 text-[var(--t4)] transition hover:bg-[var(--bg3)] hover:text-[var(--t1)]"
						>refresh</button
					>
				</div>
				<div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
					<span class="text-[var(--t4)]">mic permission:</span>
					<span
						class={probe.permission === 'granted'
							? 'text-[var(--green)]'
							: probe.permission === 'denied'
								? 'text-[var(--red)]'
								: probe.permission === 'prompt'
									? 'text-[var(--amber)]'
									: 'text-[var(--t4)]'}>{probe.permission}</span
					>
					<span class="text-[var(--t4)]">standalone PWA:</span>
					<span class={probe.standalone ? 'text-[var(--green)]' : 'text-[var(--amber)]'}>
						{probe.standalone ? 'yes' : 'no (in Safari?)'}
					</span>
					<span class="text-[var(--t4)]">display mode:</span>
					<span>{probe.displayMode}</span>
					<span class="text-[var(--t4)]">secure context:</span>
					<span class={probe.secureContext ? 'text-[var(--green)]' : 'text-[var(--red)]'}>
						{probe.secureContext ? 'yes' : 'NO'}
					</span>
					<span class="text-[var(--t4)]">hostname:</span>
					<span class="break-all">{probe.hostname}</span>
				</div>
			</div>
		{/if}

		<!-- Transcript region -->
		<div class="flex flex-1 flex-col items-center justify-center gap-5 overflow-y-auto px-6 py-4">
			{#if isError}
				<div class="flex max-w-md flex-col items-center gap-3 text-center">
					<AlertCircle size={40} class="text-[var(--red)]" />
					<p class="text-base text-[var(--t2)]">{voice.errorMsg ?? 'Voice mode error.'}</p>
					<button
						type="button"
						onclick={() => void voice.exit()}
						class="btn-tactile mt-1 px-5 py-2 text-sm font-medium text-[var(--t1)]"
					>
						Close
					</button>
				</div>
			{:else}
				<button
					type="button"
					onclick={() => voice.interrupt()}
					disabled={!interruptible}
					class="relative flex h-32 w-32 items-center justify-center rounded-[var(--r-pill)] {interruptible
						? 'cursor-pointer'
						: 'cursor-default'}"
					aria-label={interruptible ? 'Interrupt' : 'Voice status'}
					title={interruptible ? 'Tap to interrupt' : ''}
				>
					<SullyAvatar state={voiceAvatarState} size={128} />
				</button>

				{#if showIdleStarters}
					<div class="flex max-w-sm flex-col items-center gap-3 text-center">
						<h2 class="font-display text-xl font-semibold tracking-[var(--disp-track)] text-[var(--t1)]">
							Hey Captain — what's on your mind?
						</h2>
						<p class="text-sm text-[var(--t3)]">Talk out loud, or tap a starter.</p>
						<div class="voice-starter-chips">
							{#each VOICE_STARTERS as chip (chip.label)}
								<button
									type="button"
									class="voice-starter-chip"
									onclick={() => voice.submitPrompt(chip.text)}
								>
									{chip.label}
								</button>
							{/each}
						</div>
					</div>
				{/if}

				{#if voice.captions && voice.replyText}
					<div
						class="max-h-[40vh] max-w-2xl overflow-y-auto text-center font-display text-xl leading-relaxed font-medium whitespace-pre-wrap text-[var(--t1)]"
						aria-live="polite"
					>
						{voice.replyText}
					</div>
				{/if}

				<div
					class="min-h-[1.75rem] max-w-xl text-center text-sm text-[var(--t4)] transition-opacity duration-[var(--dur-long)] ease-out motion-reduce:transition-none {operatorCaptionVisible
						? 'opacity-100'
						: 'opacity-0'}"
					aria-hidden={!operatorCaptionVisible}
				>
					{operatorCaption}
				</div>
			{/if}
		</div>

		{#if !isError}
			<div
				class="flex flex-col items-center gap-3 px-6 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
			>
				<p class="text-sm text-[var(--t3)]">{statusLabel}</p>
				{#if isContinuous}
					<button
						type="button"
						onclick={() => voice.toggleMute()}
						disabled={isConnecting}
						class="btn-tactile-brand flex h-20 w-20 select-none disabled:opacity-40
							{voice.muted ? '!bg-[var(--bg3)] !shadow-none ring-1 ring-[var(--line2)]' : ''}"
						aria-label={voice.muted ? 'Unmute microphone' : 'Mute microphone'}
						aria-pressed={voice.muted}
					>
						{#if isConnecting}
							<Loader2 size={30} class="animate-spin text-[var(--t2)]" />
						{:else if voice.muted}
							<MicOff size={30} class="text-[var(--t3)]" />
						{:else}
							<Mic size={30} />
						{/if}
					</button>
				{:else}
					<button
						type="button"
						disabled={isConnecting}
						onpointerdown={onPressDown}
						onpointerup={onPressUp}
						onpointerleave={onPressUp}
						onpointercancel={onPressUp}
						oncontextmenu={(e) => e.preventDefault()}
						class="flex h-20 w-20 select-none items-center justify-center rounded-[var(--r-pill)] transition-all duration-[var(--dur-fast)]
							{voice.holding ? 'btn-tactile-brand scale-105' : 'btn-tactile'}"
						style="touch-action: none;"
						aria-label="Push to talk"
					>
						{#if isConnecting}
							<Loader2 size={30} class="animate-spin text-[var(--t3)]" />
						{:else}
							<Mic size={30} class={voice.holding ? '' : 'text-[var(--t1)]'} />
						{/if}
					</button>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.voice-mode-overlay {
		background:
			radial-gradient(ellipse 90% 55% at 50% 0%, var(--accent-glow), transparent 62%),
			var(--bg0);
		backdrop-filter: blur(24px);
	}

	.voice-starter-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		justify-content: center;
		margin-top: 4px;
	}

	.voice-starter-chip {
		padding: 10px 16px;
		border-radius: var(--r-pill);
		border: 1px solid var(--line2);
		background: rgba(255, 255, 255, 0.04);
		color: var(--t2);
		font-size: 14px;
		transition:
			background var(--dur-fast) var(--ease-standard),
			border-color var(--dur-fast) var(--ease-standard),
			color var(--dur-fast) var(--ease-standard),
			transform var(--dur-fast) var(--ease-emphasized);
	}

	.voice-starter-chip:active {
		background: rgba(124, 132, 232, 0.12);
		border-color: rgba(124, 132, 232, 0.28);
		color: var(--t1);
		transform: scale(0.97);
	}
</style>
