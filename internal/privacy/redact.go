package privacy

import "regexp"

const replacement = "[REDACTED]"

var secretPatterns = []struct {
	pattern     *regexp.Regexp
	replacement string
}{
	{
		pattern: regexp.MustCompile(`(?s)-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?-----END [A-Z0-9 ]*PRIVATE KEY-----`),
	},
	{
		pattern: regexp.MustCompile(`\bsk-(?:or-v1-)?[A-Za-z0-9_-]{16,}\b`),
	},
	{
		pattern: regexp.MustCompile(`\bgh[pousr]_[A-Za-z0-9]{20,}\b`),
	},
	{
		pattern: regexp.MustCompile(`\bAKIA[0-9A-Z]{16}\b`),
	},
	{
		pattern:     regexp.MustCompile(`(?im)\b(api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*["']?[^\s"']{8,}["']?`),
		replacement: `${1}=` + replacement,
	},
}

// RedactKnownSecrets removes common credential forms before content leaves
// the local process. It is a final safety net and does not replace file-level
// exclude rules or the send-preview UI.
func RedactKnownSecrets(value string) string {
	for _, secret := range secretPatterns {
		replaceWith := secret.replacement
		if replaceWith == "" {
			replaceWith = replacement
		}
		value = secret.pattern.ReplaceAllString(value, replaceWith)
	}
	return value
}
