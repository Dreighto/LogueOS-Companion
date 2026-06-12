<script lang="ts">
	import { onMount } from 'svelte';
	import { RefreshCw, X } from 'lucide-svelte';
	import { fly } from 'svelte/transition';

	let waitingWorker = $state<ServiceWorker | null>(null);
	let showPrompt = $state(false);
	let minimized = $state(false);
	let refreshing = false;

	function applyUpdate() {
		if (!waitingWorker) return;
		waitingWorker.postMessage({ type: 'SKIP_WAITING' });
	}

	onMount(() => {
		if (!('serviceWorker' in navigator)) return;

		let registration: ServiceWorkerRegistration | undefined;

		const onControllerChange = () => {
			if (refreshing) return;
			refreshing = true;
			window.location.reload();
		};

		const watchRegistration = (reg: ServiceWorkerRegistration) => {
			registration = reg;
			if (reg.waiting) {
				waitingWorker = reg.waiting;
				showPrompt = true;
				minimized = false;
			}

			reg.addEventListener('updatefound', () => {
				const worker = reg.installing;
				if (!worker) return;

				worker.addEventListener('statechange', () => {
					if (worker.state === 'installed' && navigator.serviceWorker.controller) {
						waitingWorker = worker;
						showPrompt = true;
						minimized = false;
					}
				});
			});
		};

		navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
		navigator.serviceWorker.ready.then(watchRegistration).catch(() => {
			/* no-op: PWA update prompt is progressive enhancement */
		});

		return () => {
			navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
			registration?.update().catch(() => {
				/* best-effort stale check before teardown */
			});
		};
	});
</script>

{#if showPrompt && !minimized}
	<div
		class="pwa-update-toast"
		style="bottom: max(5.5rem, calc(env(safe-area-inset-bottom, 0px) + 4.75rem));"
		data-testid="pwa-update-prompt"
		transition:fly={{ y: 16, duration: 220, easing: (t) => t * (2 - t) }}
	>
		<RefreshCw size={14} class="shrink-0 text-[var(--accent)]" aria-hidden="true" />
		<span class="min-w-0 flex-1 text-[11px] leading-snug font-medium text-zinc-200"
			>Update ready</span
		>
		<button
			type="button"
			class="pwa-update-toast-btn"
			onclick={applyUpdate}
		>
			Update
		</button>
		<button
			type="button"
			class="pwa-update-toast-dismiss"
			aria-label="Minimize update prompt"
			title="Minimize"
			onclick={() => (minimized = true)}
		>
			<X size={12} aria-hidden="true" />
		</button>
	</div>
{:else if showPrompt && minimized}
	<button
		type="button"
		class="pwa-update-badge"
		style="bottom: max(5.5rem, calc(env(safe-area-inset-bottom, 0px) + 4.75rem));"
		data-testid="pwa-update-badge"
		aria-label="Companion update ready — tap to show"
		title="Update ready"
		onclick={() => (minimized = false)}
	>
		<span class="pwa-update-badge-dot" aria-hidden="true"></span>
		<RefreshCw size={12} aria-hidden="true" />
	</button>
{/if}
