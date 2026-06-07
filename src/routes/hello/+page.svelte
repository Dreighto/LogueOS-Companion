<script lang="ts">
	import { base } from '$app/paths';
</script>

<svelte:head>
	<title>Hello World — Sully</title>
</svelte:head>

<div class="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center">
	<h1 class="text-4xl font-bold tracking-tight text-foreground">Hello, World!</h1>
	<p class="text-muted-foreground">Welcome to LogueOS Companion.</p>
	<a
		href="{base}/chat"
		class="mt-4 rounded-full bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-80"
	>
		Go to Chat
	</a>
</div>
