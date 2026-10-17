package outbound

import (
	"context"
	"errors"
	"net"
	"sync"
	"testing"
	"time"
)

func TestResolvedAddressFallbackDoesNotWaitForBlackholedFirstAddress(t *testing.T) {
	firstCancelled := make(chan struct{})
	client, peer := net.Pipe()
	defer peer.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	conn, err := dialResolvedAddresses(ctx, "tcp", "443", []net.IP{net.ParseIP("192.0.2.1"), net.ParseIP("2001:db8::2")}, 5*time.Millisecond, func(ctx context.Context, network, address string) (net.Conn, error) {
		switch address {
		case "192.0.2.1:443":
			<-ctx.Done()
			close(firstCancelled)
			return nil, ctx.Err()
		case "[2001:db8::2]:443":
			return client, nil
		default:
			t.Errorf("dialed an address outside the resolved set: %s", address)
			return nil, errors.New("unexpected address")
		}
	})
	if err != nil || conn != client {
		t.Fatalf("fallback connection = %v, error = %v", conn, err)
	}
	defer conn.Close()
	select {
	case <-firstCancelled:
	case <-ctx.Done():
		t.Fatal("losing dial was not cancelled")
	}
}

func TestResolvedAddressFallbackPreservesAllFailures(t *testing.T) {
	first, second := errors.New("first connection failed"), errors.New("second connection failed")
	var mu sync.Mutex
	var attempted []string
	conn, err := dialResolvedAddresses(context.Background(), "tcp", "443", []net.IP{net.ParseIP("192.0.2.1"), net.ParseIP("192.0.2.2")}, time.Hour, func(_ context.Context, _, address string) (net.Conn, error) {
		mu.Lock()
		attempted = append(attempted, address)
		mu.Unlock()
		if address == "192.0.2.1:443" {
			return nil, first
		}
		return nil, second
	})
	if conn != nil || !errors.Is(err, first) || !errors.Is(err, second) || len(attempted) != 2 {
		t.Fatalf("attempts = %v, connection = %v, error = %v", attempted, conn, err)
	}
}

func TestResolvedAddressFallbackHonorsCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	started := make(chan struct{})
	finished := make(chan struct{})
	go func() {
		<-started
		cancel()
	}()
	conn, err := dialResolvedAddresses(ctx, "tcp", "443", []net.IP{net.ParseIP("192.0.2.1")}, time.Hour, func(ctx context.Context, _, _ string) (net.Conn, error) {
		close(started)
		defer close(finished)
		<-ctx.Done()
		return nil, ctx.Err()
	})
	if conn != nil || !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled dial = %v, error = %v", conn, err)
	}
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("cancelled dial did not finish")
	}
}

func TestOutboundTransportRejectsResolutionBeforeConnecting(t *testing.T) {
	t.Setenv("HTTPS_PROXY", "")
	t.Setenv("https_proxy", "")
	rejected := errors.New("mixed public/private DNS rejected")
	transport := newOutboundTransport(func(context.Context, string) ([]net.IP, error) {
		return []net.IP{net.ParseIP("192.0.2.1"), net.ParseIP("127.0.0.1")}, rejected
	})
	conn, err := transport.DialContext(context.Background(), "tcp", "example.invalid:443")
	if conn != nil || !errors.Is(err, rejected) {
		t.Fatalf("resolver policy failure was ignored: %v, %v", conn, err)
	}
}
