// Native APNs push registration (Capacitor). Runs ONLY inside the native iOS
// app — a no-op on web / the home-screen PWA. After the operator grants
// permission, iOS hands us an APNs device token which we POST to the server so
// it can deliver task-completion pushes. Tapping a push navigates to chat.
//
// All Capacitor imports are dynamic so the web bundle never pulls native code
// and SSR doesn't choke on `window`. Guarded by Capacitor.isNativePlatform().

import { resolve } from '$app/paths';

let _started = false;

export async function initNativePush(): Promise<void> {
	if (_started || typeof window === 'undefined') return;
	_started = true;

	// Dynamic import so non-native builds don't bundle the plugin.
	let Capacitor: typeof import('@capacitor/core').Capacitor;
	try {
		({ Capacitor } = await import('@capacitor/core'));
	} catch {
		return; // @capacitor/core absent (pure web build) — nothing to do
	}
	if (!Capacitor.isNativePlatform()) return;

	let PushNotifications: typeof import('@capacitor/push-notifications').PushNotifications;
	try {
		({ PushNotifications } = await import('@capacitor/push-notifications'));
	} catch {
		return;
	}

	// 1. Permission. requestPermissions() shows the iOS prompt the first time.
	try {
		const perm = await PushNotifications.requestPermissions();
		if (perm.receive !== 'granted') return; // operator declined — respect it
	} catch {
		return;
	}

	// 2. Listeners BEFORE register() so we don't miss the token event.
	await PushNotifications.addListener('registration', (token) => {
		// token.value is the APNs device token. Send it to the server.
		void fetch(resolve('/api/chat/push/apns-register'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token: token.value, device_id: 'ios-app' })
		}).catch(() => {
			/* offline / tailnet down — iOS will re-fire registration next launch */
		});
	});

	await PushNotifications.addListener('registrationError', (err) => {
		console.error('[push] APNs registration error', err);
	});

	// Tap on a delivered notification → jump to the chat (the push carries a url).
	await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
		const url = (action.notification?.data as { url?: string } | undefined)?.url;
		if (url) {
			try {
				window.location.assign(url);
			} catch {
				/* navigation best-effort */
			}
		}
	});

	// 3. Register with APNs — fires the 'registration' listener with the token.
	try {
		await PushNotifications.register();
	} catch (e) {
		console.error('[push] register() failed', e);
	}
}
