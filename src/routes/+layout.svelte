<script lang="ts">
	import { base } from '$app/paths';
	import '../app.css';
	let { children } = $props();
</script>

<svelte:head>
	<link rel="manifest" href="{base}/manifest.webmanifest" />
</svelte:head>

<!-- Full-bleed immersive shell (companion is chat-only, no Console chrome). -->
<div class="flex min-h-[100dvh] flex-col bg-background text-foreground">
	{@render children()}
</div>
