// Single-axis mass-spring-damper — one transform value as source of truth.
// Velocity is injected on release (px/s). Unmount on onRest, never setTimeout.
//
// HOT-PATH CONTRACT (120Hz): the per-frame position is a PLAIN number, not
// $state. Each frame delivers the value through `onFrame(value)` so the
// consumer writes el.style directly — no $derived recompute, no Svelte
// scheduler flush inside the rAF loop. The ONLY reactive surface is
// `isAnimating`, which flips twice per interaction (start/rest) and gates
// mount/unmount.

export type SpringConfig = {
	stiffness?: number;
	damping?: number;
	mass?: number;
	/** Position epsilon for "at rest" */
	restEpsilon?: number;
	/** Velocity epsilon for "at rest" (px/s) */
	velocityEpsilon?: number;
};

export type SpringValue = {
	readonly value: number;
	readonly target: number;
	readonly isAnimating: boolean;
	/**
	 * Per-frame sink — called with the new position from every tick(), set()
	 * (drag path), and reduced-motion snap. Write el.style here; do NOT route
	 * the value back into $state.
	 */
	setOnFrame: (cb: ((value: number) => void) | null) => void;
	/** Direct position during drag — stops physics, no interpolation */
	set: (position: number) => void;
	/** Animate toward target; velocity in px/s */
	animateTo: (target: number, velocityPxPerSec?: number, onRest?: () => void) => void;
	snapTo: (target: number) => void;
	stop: () => void;
};

function prefersReducedMotion(): boolean {
	return (
		typeof window !== 'undefined' &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches
	);
}

export function createSpringValue(initial: number, config: SpringConfig = {}): SpringValue {
	const stiffness = config.stiffness ?? 170;
	const damping = config.damping ?? 26;
	const mass = config.mass ?? 1;
	const restEpsilon = config.restEpsilon ?? 0.5;
	const velocityEpsilon = config.velocityEpsilon ?? 3;

	const maxDtSec = 1 / 30;

	// Plain number on purpose — see hot-path contract above.
	let pos = initial;
	let target = initial;
	let vel = 0;
	let rafId = 0;
	let lastTs: number | null = null;
	let onRestCb: (() => void) | null = null;
	let onFrame: ((value: number) => void) | null = null;
	let animating = $state(false);

	function emitFrame() {
		onFrame?.(pos);
	}

	function finishAtRest() {
		pos = target;
		vel = 0;
		rafId = 0;
		emitFrame();
		animating = false;
		const cb = onRestCb;
		onRestCb = null;
		cb?.();
	}

	function tick(now: number) {
		const dt =
			lastTs === null
				? 1 / 60
				: Math.min(Math.max((now - lastTs) / 1000, 1 / 1000), maxDtSec);
		lastTs = now;

		const f = -stiffness * (pos - target) - damping * vel;
		vel += (f / mass) * dt;
		pos += vel * dt;

		if (Math.abs(vel) < velocityEpsilon && Math.abs(pos - target) < restEpsilon) {
			finishAtRest();
			return;
		}
		emitFrame();
		rafId = requestAnimationFrame(tick);
	}

	function startLoop() {
		animating = true;
		lastTs = null;
		if (!rafId) rafId = requestAnimationFrame(tick);
	}

	return {
		get value() {
			return pos;
		},
		get target() {
			return target;
		},
		get isAnimating() {
			return animating;
		},
		setOnFrame(cb: ((value: number) => void) | null) {
			onFrame = cb;
		},
		set(position: number) {
			if (rafId) {
				cancelAnimationFrame(rafId);
				rafId = 0;
			}
			animating = false;
			onRestCb = null;
			lastTs = null;
			pos = position;
			target = position;
			vel = 0;
			emitFrame();
		},
		animateTo(nextTarget: number, velocityPxPerSec = 0, onRest?: () => void) {
			if (prefersReducedMotion()) {
				pos = nextTarget;
				target = nextTarget;
				vel = 0;
				animating = false;
				emitFrame();
				onRest?.();
				return;
			}
			target = nextTarget;
			vel = velocityPxPerSec;
			onRestCb = onRest ?? null;
			startLoop();
		},
		snapTo(nextTarget: number) {
			this.set(nextTarget);
		},
		stop() {
			if (rafId) cancelAnimationFrame(rafId);
			rafId = 0;
			animating = false;
			onRestCb = null;
			lastTs = null;
		}
	};
}
