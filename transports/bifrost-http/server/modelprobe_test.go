package server

import (
	"context"
	"testing"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
)

func TestPersistModelProbeResultRejectsNilVirtualKey(t *testing.T) {
	server := &BifrostHTTPServer{}
	if err := server.persistModelProbeResult(context.Background(), nil, nil, nil, nil, ""); err == nil {
		t.Fatal("expected error for nil virtual key")
	}
}

func TestNextModelProbeTime(t *testing.T) {
	loc := time.FixedZone("test", 8*60*60)
	cases := []struct {
		name string
		now  time.Time
		want time.Time
	}{
		{
			name: "before one am returns same day",
			now:  time.Date(2026, 11, 17, 0, 30, 0, 0, loc),
			want: time.Date(2026, 11, 17, 1, 0, 0, 0, loc),
		},
		{
			name: "after one am returns next day",
			now:  time.Date(2026, 11, 17, 9, 0, 0, 0, loc),
			want: time.Date(2026, 11, 18, 1, 0, 0, 0, loc),
		},
		{
			name: "exactly one am returns next day",
			now:  time.Date(2026, 11, 17, 1, 0, 0, 0, loc),
			want: time.Date(2026, 11, 18, 1, 0, 0, 0, loc),
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := nextModelProbeTime(tc.now); !got.Equal(tc.want) {
				t.Fatalf("nextModelProbeTime(%s) = %s, want %s", tc.now, got, tc.want)
			}
		})
	}
}

func TestModelProbeResponseContainsOK(t *testing.T) {
	text := func(s string) *string { return &s }
	response := func(content *schemas.ChatMessageContent) *schemas.BifrostChatResponse {
		return &schemas.BifrostChatResponse{Choices: []schemas.BifrostResponseChoice{{ChatNonStreamResponseChoice: &schemas.ChatNonStreamResponseChoice{Message: &schemas.ChatMessage{Content: content}}}}}
	}
	tests := []struct {
		name     string
		response *schemas.BifrostChatResponse
		want     bool
	}{
		{"nil", nil, false}, {"empty", &schemas.BifrostChatResponse{}, false},
		{"missing content", response(nil), false}, {"no OK", response(&schemas.ChatMessageContent{ContentStr: text("hello")}), false},
		{"uppercase", response(&schemas.ChatMessageContent{ContentStr: text("OK")}), true},
		{"mixed case substring", response(&schemas.ChatMessageContent{ContentStr: text("looks oKay")}), true},
		{"text block", response(&schemas.ChatMessageContent{ContentBlocks: []schemas.ChatContentBlock{{Text: text("ok!")}}}), true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := modelProbeResponseContainsOK(tc.response); got != tc.want {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
}
