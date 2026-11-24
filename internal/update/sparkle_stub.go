//go:build !(darwin && sparkle)

package update

const Enabled = false

func Start() {}
