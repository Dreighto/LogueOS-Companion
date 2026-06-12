<script lang="ts">
	// Scrolling message-list region — extracted from chat/+page.svelte.
	// Renders the entire `{#each messages}` block (operator pills + assistant
	// flat replies via <Markdown> + the per-message action footer + timestamps
	// + the collapsed WorkerPill for system sully-* dispatch rows), the
	// thinking-dots indicator, the live tool-call rows, the scroll sentinel,
	// and the "{n} new messages ↓" chip.
	//
	// Phase A (flagship pass): quiet conversation — actions hidden until focus;
	// long-press opens SullySheet; glass user bubbles; msg-enter motion.

	import { base } from '$app/paths';
	import WorkerPill from '$lib/work-surface/pill/WorkerPill.svelte';
	import SullyAvatar from '$lib/components/SullyAvatar.svelte';
	import SullyNameTag from '$lib/components/SullyNameTag.svelte';
	import SullySheet from '$lib/components/SullySheet.svelte';
	import Markdown from '$lib/components/Markdown.svelte';
	import {
		Sparkles,
		Check,
		Copy,
		RefreshCw,
		Volume2,
		Square,
		Loader2,
		ThumbsUp,
		ThumbsDown,
		MoreHorizontal
	} from 'lucide-svelte';
	import type { ChatMessage } from '$lib/types/chat-ui';
	import type { Chat } from '@ai-sdk/svelte';

	type StreamState = { placeholderId: number; threadId: string } | null;
	type AppIdentity = { coreLabel?: string } | null | undefined;

	let {
		messages,
		streamState,
		sdkChat,
		hasActiveToolCalls,
		appIdentity,
		copiedIds,
		regeneratingIds,
		speakingId,
		speakLoadingId,
		sending,
		scrollSentinel = $bindable(null),
		oncopy,
		onregenerate,
		onspeak,
		onfeedback,
		onproposal,
		openCanvas,
		onimagepreview,
		ensureDispatchStream,
		fmtTime,
		onstarterprompt,
		onstarteraction
	}: {
		messages: ChatMessage[];
		streamState: StreamState;
		sdkChat: Chat;
		hasActiveToolCalls: boolean;
		appIdentity: AppIdentity;
		copiedIds: Set<number>;
		regeneratingIds: Set<number>;
		speakingId: number | null;
		speakLoadingId: number | null;
		sending: boolean;
		scrollSentinel?: HTMLDivElement | null;
		oncopy: (m: ChatMessage) => void;
		onregenerate: (m: ChatMessage) => void;
		onspeak: (m: ChatMessage) => void;
		onfeedback: (m: ChatMessage, signal: 1 | -1 | 0) => void;
		onproposal: (m: ChatMessage, decision: 'run' | 'dismiss') => void;
		openCanvas: (code: string, language: string) => void;
		onimagepreview: (src: string, alt: string) => void;
		ensureDispatchStream: (
			traceId: string
		) => ReturnType<typeof import('$lib/chat/dispatchStream.svelte').createDispatchStream>;
		fmtTime: (iso: string) => string;
		onstarterprompt: (text: string) => void;
		onstarteraction: (action: 'new-thread' | 'voice-mode') => void;
	} = $props();

	let focusedMessageId = $state<number | null>(null);
	let sheetOpen = $state(false);
	let sheetMessage = $state<ChatMessage | null>(null);

	function toolLabel(type: string): string {
		const name = (type || '').replace(/^tool-/, '');
		const map: Record<string, string> = {
			web_search: 'Searching the web',
			web_fetch: 'Reading a page',
			read_file: 'Reading a file',
			list_directory: 'Browsing files',
			deep_think: 'Thinking it through',
			consult_claude: 'Consulting Claude',
			list_chat_threads: 'Checking your threads',
			read_thread_messages: 'Recalling the conversation',
			get_server_status: 'Checking the system'
		};
		return map[name] ?? name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
	}

	function focusMessage(id: number) {
		focusedMessageId = focusedMessageId === id ? null : id;
	}

	function openActionSheet(m: ChatMessage) {
		sheetMessage = m;
		focusedMessageId = m.id;
		sheetOpen = true;
	}

	function closeActionSheet() {
		sheetOpen = false;
		sheetMessage = null;
	}

	function longPressAction(node: HTMLElement, onLongPress: () => void) {
		const delayMs = 480;
		const moveThreshold = 10;
		let timer: ReturnType<typeof setTimeout> | null = null;
		let startX = 0;
		let startY = 0;

		function clearTimer() {
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
		}

		function onPointerDown(e: PointerEvent) {
			if (e.button !== 0) return;
			startX = e.clientX;
			startY = e.clientY;
			clearTimer();
			timer = setTimeout(onLongPress, delayMs);
		}

		function onPointerMove(e: PointerEvent) {
			if (!timer) return;
			if (Math.hypot(e.clientX - startX, e.clientY - startY) > moveThreshold) clearTimer();
		}

		function onPointerUp() {
			clearTimer();
		}

		node.addEventListener('pointerdown', onPointerDown);
		node.addEventListener('pointermove', onPointerMove);
		node.addEventListener('pointerup', onPointerUp);
		node.addEventListener('pointercancel', onPointerUp);

		return {
			destroy() {
				clearTimer();
				node.removeEventListener('pointerdown', onPointerDown);
				node.removeEventListener('pointermove', onPointerMove);
				node.removeEventListener('pointerup', onPointerUp);
				node.removeEventListener('pointercancel', onPointerUp);
			}
		};
	}

	function sheetAction(fn: () => void) {
		return () => {
			fn();
			closeActionSheet();
		};
	}

	const STARTER_CHIPS: Array<
		| { kind: 'prompt'; label: string; text: string }
		| { kind: 'action'; label: string; action: 'new-thread' | 'voice-mode' }
	> = [
		{ kind: 'prompt', label: "What's running?", text: "What's running on the machine right now?" },
		{ kind: 'prompt', label: 'Summarize today', text: 'Summarize what we shipped today.' },
		{ kind: 'action', label: 'New thread', action: 'new-thread' },
		{ kind: 'action', label: 'Voice mode', action: 'voice-mode' }
	];
</script>

<svelte:window
	onclick={() => {
		if (!sheetOpen) focusedMessageId = null;
	}}
/>

{#if messages.length === 0}
	<div class="empty-hero flex flex-1 select-none">
		<img
			src="{base}/sully-mark.png"
			alt="Sully"
			class="empty-hero-orb h-16 w-16 drop-shadow-[0_0_22px_var(--accent-glow)]"
		/>
		<h2 class="empty-hero-title">Hey Captain — what's on your mind?</h2>
		<p class="empty-hero-sub">Sully's here. Think out loud.</p>
		<div class="starter-chips">
			{#each STARTER_CHIPS as chip (chip.label)}
				<button
					type="button"
					class="starter-chip"
					onclick={() => {
						if (chip.kind === 'prompt') onstarterprompt(chip.text);
						else onstarteraction(chip.action);
					}}
				>
					{chip.label}
				</button>
			{/each}
		</div>
	</div>
{:else}
	{#each messages as m (m.id)}
		{#if !(streamState?.placeholderId === m.id && m.message === '')}
			{#if m.sender === 'system' && m.trace_id?.startsWith('sully-')}
				{@const ctrl = ensureDispatchStream(m.trace_id)}
				<div class="msg-enter w-full max-w-full min-w-0">
					<WorkerPill
						traceId={m.trace_id}
						rows={ctrl.rows}
						status={ctrl.status}
						worker={ctrl.worker}
						brief={ctrl.brief}
						startedAtIso={ctrl.startedAtIso}
						durationLabel={ctrl.durationLabel}
						reconciled={ctrl.reconciled}
						onstalereconcile={() => void ctrl.reconcile()}
					/>
				</div>
			{:else if m.sender === 'operator'}
				<div class="msg-enter flex flex-col items-end gap-1">
					<div class="msg-user-bubble msg-body-text font-sans antialiased selection:bg-brand/40 selection:text-white">
						<span class="whitespace-pre-wrap">{m.message}</span>
					</div>
					<div class="msg-meta px-1">{fmtTime(m.timestamp)}</div>
				</div>
			{:else}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
				<div
					class="msg-block msg-enter flex flex-col gap-1"
					class:msg-block--focused={focusedMessageId === m.id}
					tabindex="0"
					role="group"
					aria-label="Assistant reply"
					use:longPressAction={() => openActionSheet(m)}
					onclick={(e) => {
						e.stopPropagation();
						focusMessage(m.id);
					}}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							openActionSheet(m);
						}
					}}
				>
					<SullyNameTag
						label={m.sender === 'system' ? 'LOGUEOS' : (appIdentity?.coreLabel ?? 'Sully')}
					/>

					<div class="msg-assistant-body msg-body-text font-sans antialiased selection:bg-brand/40 selection:text-white">
						<Markdown
							content={m.message}
							streaming={streamState?.placeholderId === m.id}
							oncanvas={openCanvas}
							{onimagepreview}
						/>
					</div>

					{#if m.message}
						<div class="msg-actions select-none" data-testid="msg-actions">
							<button
								type="button"
								class="msg-act"
								onclick={(e) => {
									e.stopPropagation();
									oncopy(m);
								}}
								aria-label="Copy reply"
								title={copiedIds.has(m.id) ? 'Copied' : 'Copy reply'}
							>
								{#if copiedIds.has(m.id)}
									<Check size={14} class="text-emerald-400" />
								{:else}
									<Copy size={14} />
								{/if}
							</button>
							<button
								type="button"
								class="msg-act"
								onclick={(e) => {
									e.stopPropagation();
									onregenerate(m);
								}}
								disabled={sending || regeneratingIds.has(m.id)}
								aria-label={regeneratingIds.has(m.id)
									? 'Regen… — Regenerate reply'
									: 'Regen — Regenerate reply'}
								title={regeneratingIds.has(m.id) ? 'Regenerating…' : 'Regenerate reply'}
							>
								<RefreshCw size={14} class={regeneratingIds.has(m.id) ? 'animate-spin' : ''} />
							</button>
							<button
								type="button"
								class="msg-act"
								onclick={(e) => {
									e.stopPropagation();
									onspeak(m);
								}}
								aria-label={speakLoadingId === m.id
									? '… — Read aloud (loading)'
									: speakingId === m.id
										? 'Stop — Read aloud'
										: 'Play — Read aloud'}
								title={speakingId === m.id
									? 'Stop'
									: speakLoadingId === m.id
										? 'Loading…'
										: 'Read aloud'}
							>
								{#if speakLoadingId === m.id}
									<Loader2 size={14} class="animate-spin" />
								{:else if speakingId === m.id}
									<Square size={14} class="text-brand-soft" />
								{:else}
									<Volume2 size={14} />
								{/if}
							</button>
							<button
								type="button"
								class="msg-act"
								onclick={(e) => {
									e.stopPropagation();
									openActionSheet(m);
								}}
								aria-label="More actions"
								title="More actions"
							>
								<MoreHorizontal size={14} />
							</button>
						</div>
					{/if}

					<div class="msg-meta px-1">{fmtTime(m.timestamp)}</div>

					{#if m.status === 'pending_approval'}
						<div class="mt-1 flex items-center gap-2 px-1" data-testid="proposal-actions">
							<button
								type="button"
								onclick={(e) => {
									e.stopPropagation();
									onproposal(m, 'run');
								}}
								class="min-h-[44px] rounded-[var(--r-pill)] bg-brand px-4 py-1.5 text-[12px] font-semibold text-white shadow-[var(--shadow-accent)] transition-all hover:bg-brand-bright active:scale-95 sm:min-h-0"
							>
								Run it
							</button>
							<button
								type="button"
								onclick={(e) => {
									e.stopPropagation();
									onproposal(m, 'dismiss');
								}}
								class="min-h-[44px] rounded-[var(--r-pill)] border border-brand/30 px-4 py-1.5 text-[12px] font-medium text-brand-soft transition-all hover:border-brand/50 hover:bg-brand/10 active:scale-95 sm:min-h-0"
							>
								Not now
							</button>
						</div>
					{/if}
				</div>
			{/if}
		{/if}
	{/each}

	{#if streamState && !hasActiveToolCalls && messages.find((m) => m.id === streamState!.placeholderId)?.message === ''}
		<div class="msg-enter flex flex-col items-start gap-1">
			<SullyNameTag label={appIdentity?.coreLabel ?? 'Sully'} />
			<div
				class="flex items-center gap-2.5 rounded-[var(--r-lg)] border border-[var(--live-line)] bg-[var(--live-bg)] py-2 pr-4 pl-2.5"
				aria-label="Sully is thinking"
				role="status"
			>
				<SullyAvatar state="thinking" size={34} glow={false} />
				<div class="flex items-center gap-1.5">
					<span
						class="h-1.5 w-1.5 animate-bounce rounded-[var(--r-pill)] bg-[var(--live)]"
						style="animation-delay: 0ms"
					></span>
					<span
						class="h-1.5 w-1.5 animate-bounce rounded-[var(--r-pill)] bg-[var(--live)]"
						style="animation-delay: 150ms"
					></span>
					<span
						class="h-1.5 w-1.5 animate-bounce rounded-[var(--r-pill)] bg-[var(--live)]"
						style="animation-delay: 300ms"
					></span>
				</div>
			</div>
		</div>
	{/if}
{/if}

{#if streamState}
	{#each sdkChat.messages as sdkMsg (sdkMsg.id)}
		{#if sdkMsg.role === 'assistant' && (sdkMsg.parts || []).some( (p) => p.type?.startsWith('tool-') )}
			<div class="msg-enter flex flex-col items-start gap-1" data-testid="sdk-tool-row">
				<SullyNameTag label={appIdentity?.coreLabel ?? 'Sully'} />
				<div class="flex items-start gap-2.5">
					<SullyAvatar state="working" size={34} glow={false} />
					<div class="flex flex-col gap-1">
						{#each sdkMsg.parts as part, i (i)}
							{#if part.type?.startsWith('tool-')}
								<div
									class="flex flex-col gap-0.5 rounded-[var(--r-sm)] border border-brand/25 bg-brand/[0.05] px-2.5 py-1.5 font-sans text-[11px]"
								>
									<div class="flex items-center gap-1.5 text-brand-soft">
										<Sparkles size={11} aria-hidden="true" />
										<span class="font-semibold tracking-wide">
											{toolLabel(part.type)}
										</span>
										<span class="ml-auto text-[9px] tracking-wider text-brand-soft/60 uppercase">
											{(part as { state?: string }).state ?? 'pending'}
										</span>
									</div>
									{#if (part as { state?: string }).state === 'output-error'}
										<div class="text-[10px] text-red-400">
											{(part as { errorText?: string }).errorText ?? 'tool error'}
										</div>
									{/if}
								</div>
							{/if}
						{/each}
					</div>
				</div>
			</div>
		{/if}
	{/each}
{/if}

<SullySheet bind:open={sheetOpen} ariaLabel="Message actions" onclose={() => (sheetMessage = null)}>
	{#if sheetMessage}
		<div class="ss-sheet-list">
			<button
				type="button"
				class="ss-sheet-item"
				onclick={sheetAction(() => oncopy(sheetMessage!))}
			>
				<span class="ss-sheet-item-icon"><Copy size={15} /></span>
				<span>{copiedIds.has(sheetMessage.id) ? 'Copied' : 'Copy'}</span>
			</button>
			<button
				type="button"
				class="ss-sheet-item"
				disabled={sending || regeneratingIds.has(sheetMessage.id)}
				onclick={sheetAction(() => onregenerate(sheetMessage!))}
			>
				<span class="ss-sheet-item-icon"><RefreshCw size={15} /></span>
				<span>{regeneratingIds.has(sheetMessage.id) ? 'Regenerating…' : 'Regenerate'}</span>
			</button>
			<button
				type="button"
				class="ss-sheet-item"
				onclick={sheetAction(() => onspeak(sheetMessage!))}
			>
				<span class="ss-sheet-item-icon">
					{#if speakingId === sheetMessage.id}
						<Square size={15} />
					{:else}
						<Volume2 size={15} />
					{/if}
				</span>
				<span>{speakingId === sheetMessage.id ? 'Stop read-aloud' : 'Read aloud'}</span>
			</button>
			<button
				type="button"
				class="ss-sheet-item"
				data-testid="feedback-up"
				onclick={sheetAction(() =>
					onfeedback(sheetMessage!, sheetMessage!.quality_signal === 1 ? 0 : 1))}
			>
				<span class="ss-sheet-item-icon"><ThumbsUp size={15} /></span>
				<span>{sheetMessage.quality_signal === 1 ? 'Remove thumbs-up' : 'Good reply'}</span>
			</button>
			<button
				type="button"
				class="ss-sheet-item"
				data-testid="feedback-down"
				onclick={sheetAction(() =>
					onfeedback(sheetMessage!, sheetMessage!.quality_signal === -1 ? 0 : -1))}
			>
				<span class="ss-sheet-item-icon"><ThumbsDown size={15} /></span>
				<span>{sheetMessage.quality_signal === -1 ? 'Remove thumbs-down' : 'Bad reply'}</span>
			</button>
		</div>
		<button type="button" class="ss-sheet-cancel" onclick={closeActionSheet}>Cancel</button>
	{/if}
</SullySheet>

<div bind:this={scrollSentinel} class="h-px shrink-0" aria-hidden="true"></div>
