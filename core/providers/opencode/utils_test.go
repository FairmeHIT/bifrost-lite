package opencode

import (
	"context"
	"regexp"
	"strings"
	"sync"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
)

// newTestOpencodeCtx builds a BifrostContext carrying the request headers the
// HTTP transport would have captured.
func newTestOpencodeCtx(t *testing.T, requestHeaders map[string]string) *schemas.BifrostContext {
	t.Helper()
	ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	if len(requestHeaders) > 0 {
		ctx.SetValue(schemas.BifrostContextKeyRequestHeaders, requestHeaders)
	}
	return ctx
}

// setOpencodeVirtualKey marks the context as attributed to the given virtual
// key ID, the way the governance plugin does when it resolves a virtual key.
func setOpencodeVirtualKey(ctx *schemas.BifrostContext, id string) {
	ctx.SetValue(schemas.BifrostContextKeyGovernanceVirtualKeyID, id)
}

var uuidValueRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// TestIsSafeOpencodeSessionValue verifies header-injection protection: CR, LF,
// and other control bytes are rejected while ordinary printable and unicode
// values are accepted.
func TestIsSafeOpencodeSessionValue(t *testing.T) {
	tests := []struct {
		name  string
		value string
		want  bool
	}{
		{name: "plain value", value: "session-abc-123", want: true},
		{name: "value with spaces", value: "a b c", want: true},
		{name: "value with colon", value: "vk-1:session-1", want: true},
		{name: "value with unicode", value: "séance-☃", want: true},
		{name: "carriage return rejected", value: "abc\r\nInjected: x", want: false},
		{name: "line feed rejected", value: "abc\nInjected", want: false},
		{name: "control byte rejected", value: "abc\x01def", want: false},
		{name: "tab rejected", value: "abc\tdef", want: false},
		{name: "DEL rejected", value: "abc\x7fdef", want: false},
		{name: "NUL rejected", value: "abc\x00def", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isSafeOpencodeSessionValue(tt.value); got != tt.want {
				t.Errorf("isSafeOpencodeSessionValue(%q) = %v, want %v", tt.value, got, tt.want)
			}
		})
	}
}

// TestResolveOpencodeSessionClientHeaderWins verifies the client-sent
// x-opencode-session header is forwarded (namespaced per virtual key ID)
// and takes precedence over the Bifrost session id.
func TestResolveOpencodeSessionClientHeaderWins(t *testing.T) {
	t.Run("forwarded and namespaced per virtual key ID", func(t *testing.T) {
		ctx := newTestOpencodeCtx(t, map[string]string{
			OpencodeSessionHeader: "client-sess-abc",
		})
		setOpencodeVirtualKey(ctx, "vk-1")

		if got := ResolveOpencodeSession(ctx); got != "vk-1:client-sess-abc" {
			t.Errorf("ResolveOpencodeSession() = %q, want %q", got, "vk-1:client-sess-abc")
		}
	})

	t.Run("forwarded unqualified without a virtual key", func(t *testing.T) {
		ctx := newTestOpencodeCtx(t, map[string]string{
			OpencodeSessionHeader: "client-sess-abc",
		})
		if got := ResolveOpencodeSession(ctx); got != "client-sess-abc" {
			t.Errorf("ResolveOpencodeSession() = %q, want %q", got, "client-sess-abc")
		}
	})

	t.Run("client header beats x-bf-session-id", func(t *testing.T) {
		ctx := newTestOpencodeCtx(t, map[string]string{
			OpencodeSessionHeader: "client-sess-abc",
		})
		ctx.SetValue(schemas.BifrostContextKeySessionID, "bf-sess-123")
		if got := ResolveOpencodeSession(ctx); got != "client-sess-abc" {
			t.Errorf("ResolveOpencodeSession() = %q, want client header to win over %q", got, "bf-sess-123")
		}
	})
}

// TestResolveOpencodeSessionClientHeaderLengthBound verifies the client header
// goes through the shared max-session-length bound: at the limit it is used,
// one rune over it is treated as absent and the fallback chain applies.
func TestResolveOpencodeSessionClientHeaderLengthBound(t *testing.T) {
	atLimit := strings.Repeat("a", maxOpencodeSessionLength)
	ctx := newTestOpencodeCtx(t, map[string]string{OpencodeSessionHeader: atLimit})
	ctx.SetValue(schemas.BifrostContextKeySessionID, "bf-sess-123")
	if got := ResolveOpencodeSession(ctx); got != atLimit {
		t.Errorf("ResolveOpencodeSession() at the limit = %q, want the client header", got)
	}

	ctx = newTestOpencodeCtx(t, map[string]string{OpencodeSessionHeader: atLimit + "a"})
	ctx.SetValue(schemas.BifrostContextKeySessionID, "bf-sess-123")
	if got := ResolveOpencodeSession(ctx); got != "bf-sess-123" {
		t.Errorf("ResolveOpencodeSession() over the limit = %q, want fallback %q", got, "bf-sess-123")
	}

	ctx = newTestOpencodeCtx(t, map[string]string{OpencodeSessionHeader: "  client-sess-abc  "})
	if got := ResolveOpencodeSession(ctx); got != "client-sess-abc" {
		t.Errorf("ResolveOpencodeSession() = %q, want the trimmed client header", got)
	}
}

// TestResolveOpencodeSessionFallbackChain verifies the resolution order when the
// client header is absent, empty, poisoned, or whitespace-only: the Bifrost
// session id is used, otherwise a UUID is synthesized.
func TestResolveOpencodeSessionFallbackChain(t *testing.T) {
	t.Run("session id used when client header absent", func(t *testing.T) {
		ctx := newTestOpencodeCtx(t, nil)
		ctx.SetValue(schemas.BifrostContextKeySessionID, "bf-sess-123")
		setOpencodeVirtualKey(ctx, "vk-1")
		if got := ResolveOpencodeSession(ctx); got != "vk-1:bf-sess-123" {
			t.Errorf("ResolveOpencodeSession() = %q, want %q", got, "vk-1:bf-sess-123")
		}
	})

	t.Run("session id used when client header is empty", func(t *testing.T) {
		ctx := newTestOpencodeCtx(t, map[string]string{OpencodeSessionHeader: ""})
		ctx.SetValue(schemas.BifrostContextKeySessionID, "bf-sess-123")
		if got := ResolveOpencodeSession(ctx); got != "bf-sess-123" {
			t.Errorf("ResolveOpencodeSession() = %q, want %q", got, "bf-sess-123")
		}
	})

	t.Run("poisoned client header falls back to session id", func(t *testing.T) {
		ctx := newTestOpencodeCtx(t, map[string]string{
			OpencodeSessionHeader: "evil\r\nInjected: x",
		})
		ctx.SetValue(schemas.BifrostContextKeySessionID, "bf-sess-123")
		if got := ResolveOpencodeSession(ctx); got != "bf-sess-123" {
			t.Errorf("ResolveOpencodeSession() = %q, want fallback %q", got, "bf-sess-123")
		}
	})

	t.Run("poisoned client header falls back to synthesized UUID", func(t *testing.T) {
		ctx := newTestOpencodeCtx(t, map[string]string{
			OpencodeSessionHeader: "abc\x01def",
		})
		got := ResolveOpencodeSession(ctx)
		if !uuidValueRe.MatchString(got) {
			t.Errorf("ResolveOpencodeSession() = %q, want synthesized UUID", got)
		}
	})

	t.Run("whitespace-only client header is treated as absent", func(t *testing.T) {
		ctx := newTestOpencodeCtx(t, map[string]string{
			OpencodeSessionHeader: "   ",
		})
		ctx.SetValue(schemas.BifrostContextKeySessionID, "bf-sess-123")
		if got := ResolveOpencodeSession(ctx); got != "bf-sess-123" {
			t.Errorf("ResolveOpencodeSession() = %q, want fallback %q", got, "bf-sess-123")
		}
	})

	t.Run("session id with control bytes falls back to synthesized UUID", func(t *testing.T) {
		ctx := newTestOpencodeCtx(t, nil)
		ctx.SetValue(schemas.BifrostContextKeySessionID, "abc\x01def")
		got := ResolveOpencodeSession(ctx)
		if !uuidValueRe.MatchString(got) {
			t.Errorf("ResolveOpencodeSession() = %q, want synthesized UUID for poisoned session id", got)
		}
	})
}

// TestResolveOpencodeSessionSynthesizesUUID verifies that with no session signal
// at all a fresh, per-request UUID is produced and still survives namespacing.
func TestResolveOpencodeSessionSynthesizesUUID(t *testing.T) {
	t.Run("valid UUID when no signal at all", func(t *testing.T) {
		ctx := newTestOpencodeCtx(t, nil)
		got := ResolveOpencodeSession(ctx)
		if !uuidValueRe.MatchString(got) {
			t.Errorf("ResolveOpencodeSession() = %q, want a UUID", got)
		}
	})

	t.Run("UUIDs differ across requests", func(t *testing.T) {
		first := ResolveOpencodeSession(newTestOpencodeCtx(t, nil))
		second := ResolveOpencodeSession(newTestOpencodeCtx(t, nil))
		if first == second {
			t.Errorf("ResolveOpencodeSession() returned the same synthesized UUID for two requests: %q", first)
		}
	})

	t.Run("namespaced UUID is still a UUID after the prefix", func(t *testing.T) {
		ctx := newTestOpencodeCtx(t, nil)
		setOpencodeVirtualKey(ctx, "vk-1")
		got := ResolveOpencodeSession(ctx)
		prefix := "vk-1:"
		if len(got) <= len(prefix) || got[:len(prefix)] != prefix {
			t.Fatalf("ResolveOpencodeSession() = %q, want %q prefix", got, prefix)
		}
		if !uuidValueRe.MatchString(got[len(prefix):]) {
			t.Errorf("ResolveOpencodeSession() = %q, want UUID after namespace prefix", got)
		}
	})
}

// TestResolveOpencodeSessionNamespacesPerVirtualKey verifies sessions are scoped
// per virtual key — the same session under two keys yields distinct values,
// the same key stays stable, and an unsafe key leaves the value unqualified.
func TestResolveOpencodeSessionNamespacesPerVirtualKey(t *testing.T) {
	build := func(vk string) *schemas.BifrostContext {
		ctx := newTestOpencodeCtx(t, map[string]string{OpencodeSessionHeader: "shared-session"})
		if vk != "" {
			setOpencodeVirtualKey(ctx, vk)
		}
		return ctx
	}

	vk1 := ResolveOpencodeSession(build("vk-1"))
	vk2 := ResolveOpencodeSession(build("vk-2"))
	if vk1 == vk2 {
		t.Errorf("ResolveOpencodeSession() produced the same value for two virtual keys: %q", vk1)
	}
	if vk1 != "vk-1:shared-session" || vk2 != "vk-2:shared-session" {
		t.Errorf("ResolveOpencodeSession() = %q and %q, want vk-scoped values", vk1, vk2)
	}
	if again := ResolveOpencodeSession(build("vk-1")); again != vk1 {
		t.Errorf("ResolveOpencodeSession() not stable for the same virtual key: %q vs %q", again, vk1)
	}

	t.Run("virtual key value is never used as the namespace", func(t *testing.T) {
		// Without governance only the virtual key secret is on the context. It
		// is a Bifrost credential, so it must not be sent to the gateway.
		ctx := newTestOpencodeCtx(t, map[string]string{OpencodeSessionHeader: "shared-session"})
		ctx.SetValue(schemas.BifrostContextKeyVirtualKey, "sk-bf-secret-vk-1")
		if got := ResolveOpencodeSession(ctx); got != "shared-session" {
			t.Errorf("ResolveOpencodeSession() = %q, want unqualified value without a governance virtual key ID", got)
		}
	})

	t.Run("governance ID is used, not the virtual key value", func(t *testing.T) {
		ctx := newTestOpencodeCtx(t, map[string]string{OpencodeSessionHeader: "shared-session"})
		setOpencodeVirtualKey(ctx, "vk-1")
		got := ResolveOpencodeSession(ctx)
		if got != "vk-1:shared-session" {
			t.Errorf("ResolveOpencodeSession() = %q, want %q", got, "vk-1:shared-session")
		}
		if strings.Contains(got, "sk-bf-secret-vk-1") {
			t.Errorf("ResolveOpencodeSession() = %q leaks the virtual key value", got)
		}
	})

	t.Run("unsafe virtual key leaves value unqualified", func(t *testing.T) {
		ctx := newTestOpencodeCtx(t, map[string]string{OpencodeSessionHeader: "shared-session"})
		setOpencodeVirtualKey(ctx, "evil\r\nvk")
		if got := ResolveOpencodeSession(ctx); got != "shared-session" {
			t.Errorf("ResolveOpencodeSession() = %q, want unqualified value with unsafe virtual key", got)
		}
	})
}

// TestResolveOpencodeSessionResolvesOncePerRequest verifies the resolved value is
// cached on the context so repeated calls for one request return the same
// namespaced value instead of re-synthesizing.
func TestResolveOpencodeSessionResolvesOncePerRequest(t *testing.T) {
	ctx := newTestOpencodeCtx(t, nil)
	first := ResolveOpencodeSession(ctx)
	second := ResolveOpencodeSession(ctx)
	if first != second {
		t.Errorf("ResolveOpencodeSession() resolved twice: %q then %q, want a single cached value", first, second)
	}
	// The cached value must be the namespaced, final form.
	if !uuidValueRe.MatchString(first) {
		t.Errorf("ResolveOpencodeSession() = %q, want a UUID", first)
	}
}

// TestNamespaceOpencodeSessionNoCollision is a regression test for the naive
// "vk:value" concatenation alias: component escaping keeps the mapping
// injective so ("a","b:c") and ("a:b","c") map to distinct values.
func TestNamespaceOpencodeSessionNoCollision(t *testing.T) {
	mk := func(vk string) *schemas.BifrostContext {
		ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
		setOpencodeVirtualKey(ctx, vk)
		return ctx
	}

	got1 := namespaceOpencodeSession(mk("a"), "b:c")
	got2 := namespaceOpencodeSession(mk("a:b"), "c")

	if got1 != "a:b\\:c" {
		t.Errorf("(\"a\",\"b:c\") = %q, want %q", got1, "a:b\\:c")
	}
	if got2 != "a\\:b:c" {
		t.Errorf("(\"a:b\",\"c\") = %q, want %q", got2, "a\\:b:c")
	}
	if got1 == got2 {
		t.Fatalf("collision: (\"a\",\"b:c\") and (\"a:b\",\"c\") both produced %q", got1)
	}
}

// TestResolveOpencodeSessionNilContext verifies a nil context yields an empty
// session value instead of panicking.
func TestResolveOpencodeSessionNilContext(t *testing.T) {
	if got := ResolveOpencodeSession(nil); got != "" {
		t.Errorf("ResolveOpencodeSession(nil) = %q, want \"\"", got)
	}
}

// TestResolveOpencodeSessionStableUnderBlockRestrictedWrites verifies the cached
// session value survives BlockRestrictedWrites and is returned unchanged on the
// next resolution.
func TestResolveOpencodeSessionStableUnderBlockRestrictedWrites(t *testing.T) {
	ctx := newTestOpencodeCtx(t, nil)
	setOpencodeVirtualKey(ctx, "vk-1")

	first := ResolveOpencodeSession(ctx)
	if !uuidValueRe.MatchString(first[5:]) {
		t.Fatalf("first = %q, want namespaced UUID", first)
	}

	ctx.BlockRestrictedWrites()
	second := ResolveOpencodeSession(ctx)
	if second != first {
		t.Errorf("under blockRestrictedWrites: second = %q, want %q (cached)", second, first)
	}
}

// TestResolveOpencodeSessionConcurrentSameContext verifies resolution is
// single-flight when many goroutines resolve the same context at once.
func TestResolveOpencodeSessionConcurrentSameContext(t *testing.T) {
	ctx := newTestOpencodeCtx(t, nil)
	setOpencodeVirtualKey(ctx, "vk-1")

	const goroutines = 100
	results := make(chan string, goroutines)
	var wg sync.WaitGroup
	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			results <- ResolveOpencodeSession(ctx)
		}()
	}
	wg.Wait()
	close(results)

	first := <-results
	for value := range results {
		if value != first {
			t.Fatalf("concurrent resolution was not single-flight: got %q and %q", first, value)
		}
	}
	if !uuidValueRe.MatchString(first[5:]) {
		t.Fatalf("first = %q, want namespaced UUID", first)
	}
}

// TestWithoutOpencodeSessionHeader verifies the static extra-header map is
// stripped of every case variant of x-opencode-session for ListModels while
// other headers survive untouched.
func TestWithoutOpencodeSessionHeader(t *testing.T) {
	t.Run("map without the header is returned as-is", func(t *testing.T) {
		in := map[string]string{"x-other": "1"}
		if got := withoutOpencodeSessionHeader(in); len(got) != 1 || got["x-other"] != "1" {
			t.Errorf("withoutOpencodeSessionHeader() = %v, want the original map", got)
		}
	})

	t.Run("every case variant is stripped", func(t *testing.T) {
		in := map[string]string{
			"x-other":             "1",
			OpencodeSessionHeader: "static-session",
			"X-Opencode-Session":  "static-session-2",
		}
		got := withoutOpencodeSessionHeader(in)
		if len(got) != 1 {
			t.Fatalf("withoutOpencodeSessionHeader() = %v, want only x-other", got)
		}
		if got["x-other"] != "1" {
			t.Errorf("withoutOpencodeSessionHeader() dropped x-other: %v", got)
		}
	})
}

// TestOpencodeProviderResponsesRouting verifies the constructor flag decides the
// Responses path: Zen falls back to Chat Completions, Go serves /v1/responses
// natively.
func TestOpencodeProviderResponsesRouting(t *testing.T) {
	zenConfig := &schemas.ProviderConfig{}
	zenConfig.CheckAndSetDefaults()
	zen, err := NewOpencodeZenProvider(zenConfig, nil)
	if err != nil {
		t.Fatalf("NewOpencodeZenProvider failed: %v", err)
	}
	if !zen.fallbackResponsesToChat {
		t.Errorf("Zen provider: fallbackResponsesToChat = false, want true")
	}

	goConfig := &schemas.ProviderConfig{}
	goConfig.CheckAndSetDefaults()
	goProvider, err := NewOpencodeGoProvider(goConfig, nil)
	if err != nil {
		t.Fatalf("NewOpencodeGoProvider failed: %v", err)
	}
	if goProvider.fallbackResponsesToChat {
		t.Errorf("Go provider: fallbackResponsesToChat = true, want false")
	}

	// A static x-opencode-session in the config must be stripped from the
	// ListModels header map for both variants.
	cfg := &schemas.ProviderConfig{}
	cfg.CheckAndSetDefaults()
	cfg.NetworkConfig.ExtraHeaders = map[string]string{
		OpencodeSessionHeader: "static-session",
		"x-other":             "1",
	}
	provider, err := NewOpencodeGoProvider(cfg, nil)
	if err != nil {
		t.Fatalf("NewOpencodeGoProvider failed: %v", err)
	}
	if _, ok := provider.listModelsHeaders[OpencodeSessionHeader]; ok {
		t.Errorf("listModelsHeaders still carries x-opencode-session")
	}
	if provider.listModelsHeaders["x-other"] != "1" {
		t.Errorf("listModelsHeaders dropped x-other: %v", provider.listModelsHeaders)
	}
	if provider.networkConfig.ExtraHeaders[OpencodeSessionHeader] != "static-session" {
		t.Errorf("ExtraHeaders lost the static session value: %v", provider.networkConfig.ExtraHeaders)
	}
}

// TestOpencodeInferenceAuthHeaders verifies the auth-header map carries the
// bearer token plus the resolved session, and that the session header is absent
// when resolution yields nothing (nil context).
func TestOpencodeInferenceAuthHeaders(t *testing.T) {
	cfg := &schemas.ProviderConfig{}
	cfg.CheckAndSetDefaults()
	provider, err := NewOpencodeGoProvider(cfg, nil)
	if err != nil {
		t.Fatalf("NewOpencodeGoProvider failed: %v", err)
	}

	key := schemas.Key{ID: "key-1", Name: "k", Value: *schemas.NewSecretVar("sk-test"), Models: schemas.WhiteList{}}
	ctx := newTestOpencodeCtx(t, map[string]string{OpencodeSessionHeader: "sess-1"})
	headers := provider.inferenceAuthHeaders(ctx, key)
	if headers["Authorization"] != "Bearer sk-test" {
		t.Errorf("inferenceAuthHeaders() Authorization = %q, want Bearer sk-test", headers["Authorization"])
	}
	if headers[OpencodeSessionHeader] != "sess-1" {
		t.Errorf("inferenceAuthHeaders()[x-opencode-session] = %q, want sess-1", headers[OpencodeSessionHeader])
	}
}
