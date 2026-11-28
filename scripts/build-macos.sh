#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

version="$(plutil -extract version raw frontend/package.json)"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Invalid application version: $version" >&2
  exit 1
fi

name=Glint
plist=build/darwin/Info.plist
tags=production
flags=(-trimpath -ldflags='-s -w')
if [[ "${GLINT_DEV:-false}" == true ]]; then
  name=Glint.dev
  plist=build/darwin/Info.dev.plist
  tags=dev
  flags=(-gcflags='all=-l' -ldflags="-X main.dataDirectoryName=$name")
fi
if [[ -n "${EXTRA_TAGS:-}" ]]; then
  tags="$tags,$EXTRA_TAGS"
fi

export CGO_ENABLED=1
export GOOS=darwin
export MACOSX_DEPLOYMENT_TARGET=13.0
export CGO_CFLAGS="${CGO_CFLAGS:-} -mmacosx-version-min=13.0"
export CGO_LDFLAGS="${CGO_LDFLAGS:-} -mmacosx-version-min=13.0"

mkdir -p build/bin
stage="$(mktemp -d build/bin/package.XXXXXX)"
trap 'rm -rf "$stage"' EXIT
bundle="$stage/$name.app"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
binary="$bundle/Contents/MacOS/Glint"
arch="${GLINT_ARCH:-$(go env GOARCH)}"
if [[ "$arch" == universal ]]; then
  for target in arm64 amd64; do
    GOARCH="$target" go build "${flags[@]}" -tags "$tags" -o "$stage/Glint-$target" .
  done
  lipo -create -output "$binary" "$stage/Glint-arm64" "$stage/Glint-amd64"
  lipo "$binary" -verify_arch arm64 x86_64
else
  GOARCH="$arch" go build "${flags[@]}" -tags "$tags" -o "$binary" .
fi

cp "$plist" "$bundle/Contents/Info.plist"
plutil -replace CFBundleVersion -string "$version" "$bundle/Contents/Info.plist"
plutil -replace CFBundleShortVersionString -string "$version" "$bundle/Contents/Info.plist"
go tool wails3 generate icons -input build/appicon.png \
  -macfilename "$bundle/Contents/Resources/icons.icns" -windowsfilename "$stage/icon.ico"

if [[ ",$tags," == *,sparkle,* ]]; then
  mkdir -p "$bundle/Contents/Frameworks"
  ditto "${SPARKLE_DIR:?SPARKLE_DIR is required for Sparkle builds}/Sparkle.framework" \
    "$bundle/Contents/Frameworks/Sparkle.framework"
fi
codesign --force --deep --sign - "$bundle"
codesign --verify --deep --strict "$bundle"
# Replace only the generated bundle, so frameworks from earlier builds cannot linger.
rm -rf "build/bin/$name.app"
mv "$bundle" "build/bin/$name.app"
