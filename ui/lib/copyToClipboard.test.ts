import { afterEach, describe, expect, test, vi } from "vitest";
import { copyToClipboard } from "./copyToClipboard";

afterEach(() => {
	vi.unstubAllGlobals();
});

// Minimal stand-in for the textarea the legacy path creates and mutates.
function createTextareaStub() {
	return {
		value: "",
		setAttribute: vi.fn(),
		style: {},
		focus: vi.fn(),
		select: vi.fn(),
		setSelectionRange: vi.fn(),
		remove: vi.fn(),
	};
}

function stubLegacyDom(execResult: boolean) {
	const textarea = createTextareaStub();
	vi.stubGlobal("document", {
		createElement: vi.fn(() => textarea),
		execCommand: vi.fn(() => execResult),
		body: { appendChild: vi.fn() },
	});
	return textarea;
}

describe("copyToClipboard", () => {
	test("uses the async Clipboard API when available (secure context)", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("navigator", { clipboard: { writeText } });

		await expect(copyToClipboard("sk-abc")).resolves.toBeUndefined();
		expect(writeText).toHaveBeenCalledWith("sk-abc");
	});

	test("falls back to execCommand when navigator.clipboard is missing (insecure context)", async () => {
		vi.stubGlobal("navigator", {});
		const textarea = stubLegacyDom(true);

		await expect(copyToClipboard("sk-abc")).resolves.toBeUndefined();
		expect(textarea.value).toBe("sk-abc");
		expect(textarea.setAttribute).toHaveBeenCalledWith("readonly", "");
		expect(document.execCommand).toHaveBeenCalledWith("copy");
		expect(textarea.remove).toHaveBeenCalled();
	});

	test("falls back to execCommand when the async API rejects at runtime", async () => {
		vi.stubGlobal("navigator", {
			clipboard: { writeText: vi.fn().mockRejectedValue(new Error("NotAllowedError")) },
		});
		stubLegacyDom(true);

		await expect(copyToClipboard("sk-abc")).resolves.toBeUndefined();
		expect(document.execCommand).toHaveBeenCalledWith("copy");
	});

	test("rejects when the async API rejects and the legacy path also fails", async () => {
		vi.stubGlobal("navigator", {
			clipboard: { writeText: vi.fn().mockRejectedValue(new Error("NotAllowedError")) },
		});
		stubLegacyDom(false);

		await expect(copyToClipboard("sk-abc")).rejects.toThrow();
	});
});