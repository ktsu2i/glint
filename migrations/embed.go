// Package migrations exposes the app-wide SQL migration files as an embedded
// filesystem so they ship inside the desktop binary and can be applied by any
// store at startup via golang-migrate's iofs source.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
