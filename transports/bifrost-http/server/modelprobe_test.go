package server

import (
	"testing"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
)

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

func TestModelProbeErrorIsSkippable(t *testing.T) {
	status := func(code int, message string) *schemas.BifrostError {
		return &schemas.BifrostError{StatusCode: &code, Error: &schemas.ErrorField{Message: message}}
	}
	tests := []struct {
		name string
		err  *schemas.BifrostError
		want bool
	}{
		{name: "nil", err: nil, want: false},
		{name: "server error", err: status(500, "internal error"), want: true},
		{name: "bad gateway", err: status(502, "bad gateway"), want: true},
		{name: "rate limited", err: status(429, "too many requests"), want: true},
		{name: "request timeout", err: status(408, "timeout"), want: true},
		{name: "not a chat model", err: status(400, "this model is not a chat model"), want: true},
		{name: "unsupported operation", err: status(400, "unsupported operation"), want: true},
		{name: "unknown model", err: status(404, "model not found"), want: true},
		{name: "plain bad request", err: status(400, "messages must not be empty"), want: false},
		{name: "unauthorized", err: status(401, "invalid api key"), want: false},
		{name: "deadline without status", err: &schemas.BifrostError{Error: &schemas.ErrorField{Message: "context deadline exceeded"}}, want: true},
		{name: "connection refused without status", err: &schemas.BifrostError{Error: &schemas.ErrorField{Message: "connection refused"}}, want: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := modelProbeErrorIsSkippable(tc.err); got != tc.want {
				t.Fatalf("modelProbeErrorIsSkippable() = %v, want %v", got, tc.want)
			}
		})
	}
}
