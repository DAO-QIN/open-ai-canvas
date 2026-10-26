package handler

import (
	"net/http"
	"testing"
)

func TestStorageReadOnlyPreservesPromotionTransfer(t *testing.T) {
	if !storageReadOnlyExempt(http.MethodPost, "/api/promotion/transfers") {
		t.Fatal("existing promotion balance must remain transferable while storage is read-only")
	}
	if storageReadOnlyExempt(http.MethodPost, "/api/promotion/code") {
		t.Fatal("promotion code creation must not inherit the transfer exemption")
	}
	if storageReadOnlyExempt(http.MethodPost, "/api/dramas") {
		t.Fatal("content writes must remain blocked while storage is read-only")
	}
}
