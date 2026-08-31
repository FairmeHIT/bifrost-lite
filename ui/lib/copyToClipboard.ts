/**
 * Copy `text` to the system clipboard, degrading gracefully when the modern
 * Clipboard API is unavailable.
 *
 * `navigator.clipboard.writeText()` is only exposed in secure contexts
 * (HTTPS, or http://localhost / loopback addresses). When the UI is served over
 * plain HTTP from a LAN IP or a domain — a common Bifrost deployment shape —
 * `navigator.clipboard` is `undefined` and the async call throws, surfacing as
 * "copy failed" toasts on every copy button in the app. This helper falls back
 * to the hidden-textarea + `document.execCommand("copy")` technique, which
 * still works on insecure origins, and only rejects when every path failed.
 */
export async function copyToClipboard(text: string): Promise<void> {
	if (navigator?.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return;
		} catch {
			// The async API can also reject at runtime (permission denied,
			// missing user activation, iframe without `allow="clipboard-write"`).
			// Try the legacy path before giving up.
		}
	}
	if (!legacyCopy(text)) {
		throw new Error("clipboard write failed");
	}
}

function legacyCopy(text: string): boolean {
	let textarea: HTMLTextAreaElement | null = null;
	try {
		textarea = document.createElement("textarea");
		textarea.value = text;
		textarea.setAttribute("readonly", "");
		textarea.style.position = "fixed";
		textarea.style.top = "-9999px";
		textarea.style.left = "-9999px";
		textarea.style.opacity = "0";
		document.body.appendChild(textarea);
		textarea.focus();
		textarea.select();
		textarea.setSelectionRange(0, textarea.value.length);
		return document.execCommand("copy");
	} catch {
		return false;
	} finally {
		textarea?.remove();
	}
}