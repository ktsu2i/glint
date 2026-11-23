//go:build !(darwin && sparkle)

package update

// Enabled は Sparkle を組み込んだビルドかどうかを返す。
const Enabled = false

// Start は Sparkle を組み込まないビルドでは何もしない。
func Start() {}
