package privacy

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestRedactKnownSecrets(t *testing.T) {
	privateKey := "-----BEGIN PRIVATE KEY-----\nvery-secret-material\n-----END PRIVATE KEY-----"
	tests := []string{
		"sk-or-v1-1234567890abcdefghijklmnop",
		"ghp_1234567890abcdefghijklmnop",
		"AKIA1234567890ABCDEF",
		"API_KEY=super-secret-value",
		privateKey,
	}
	for _, secret := range tests {
		redacted := RedactKnownSecrets("before " + secret + " after")
		assert.NotContains(t, redacted, secret)
		assert.Contains(t, redacted, replacement)
	}
}

func TestRedactKnownSecretsPreservesOrdinaryReadingContext(t *testing.T) {
	context := "A token budget limits the context passed to a language model."
	assert.Equal(t, context, RedactKnownSecrets(context))
}
