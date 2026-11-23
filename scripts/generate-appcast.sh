#!/usr/bin/env bash
# Sparkle の appcast.xml を標準出力に書き出す。release workflow から呼ぶ。
#
# usage: generate-appcast.sh <version> <download-url> <release-notes-url> <signature-attributes>
#
# <signature-attributes> は Sparkle の `sign_update <zip>` の出力
# (`sparkle:edSignature="..." length="..."`) をそのまま渡す。
# アプリは SUFeedURL (releases/latest/download/appcast.xml) から最新の 1 件だけを読む。
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "usage: $0 <version> <download-url> <release-notes-url> <signature-attributes>" >&2
  exit 2
fi

version="$1"
download_url="$2"
release_notes_url="$3"
signature_attributes="$4"

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "unexpected version: ${version}" >&2
  exit 1
fi
if [[ ! "$signature_attributes" =~ ^sparkle:edSignature=\"[A-Za-z0-9+/=]+\"\ length=\"[0-9]+\"$ ]]; then
  echo "unexpected signature attributes: ${signature_attributes}" >&2
  exit 1
fi

# minimumSystemVersion は build/darwin/Info.plist の LSMinimumSystemVersion と揃える。
cat <<EOF
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Glint</title>
    <link>https://github.com/ktsu2i/glint</link>
    <item>
      <title>Glint ${version}</title>
      <pubDate>$(LC_ALL=C date -u "+%a, %d %b %Y %H:%M:%S +0000")</pubDate>
      <sparkle:version>${version}</sparkle:version>
      <sparkle:shortVersionString>${version}</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>13.0</sparkle:minimumSystemVersion>
      <sparkle:fullReleaseNotesLink>${release_notes_url}</sparkle:fullReleaseNotesLink>
      <description><![CDATA[<p>Glint ${version} is available. See the <a href="${release_notes_url}">release notes</a> for details.</p>]]></description>
      <enclosure url="${download_url}" ${signature_attributes} type="application/octet-stream"/>
    </item>
  </channel>
</rss>
EOF
