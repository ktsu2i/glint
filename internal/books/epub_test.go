package books

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const sampleOPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Sample Technical Book</dc:title>
    <dc:creator>Author One</dc:creator>
    <dc:creator>Author Two</dc:creator>
    <dc:language>en</dc:language>
    <dc:publisher>Glint Press</dc:publisher>
    <dc:description>A small EPUB used as a test fixture.</dc:description>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="cover-image" href="images/cover.png" media-type="image/png"/>
    <item id="chap1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chap2" href="text/chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="chap3" href="text/chapter3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chap1"/>
    <itemref idref="chap2"/>
    <itemref idref="chap3"/>
  </spine>
</package>`

func newSampleEPUB(t *testing.T, opts ...func(map[string]string)) string {
	t.Helper()
	files := map[string]string{
		"mimetype": "application/epub+zip",
		"META-INF/container.xml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
			"<container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\">\n" +
			"  <rootfiles><rootfile full-path=\"OEBPS/content.opf\" media-type=\"application/oebps-package+xml\"/></rootfiles>\n" +
			"</container>",
		"OEBPS/content.opf":         sampleOPF,
		"OEBPS/text/chapter1.xhtml": `<?xml version="1.0" encoding="UTF-8"?><html><body><h1>Chapter One</h1><p>Hello evidence.</p><script>ignored.</script></body></html>`,
		"OEBPS/text/chapter2.xhtml": `<?xml version="1.0" encoding="UTF-8"?><html><body><h1>Chapter Two</h1><p>Retrieval pipeline evidence.</p></body></html>`,
		"OEBPS/text/chapter3.xhtml": `<?xml version="1.0" encoding="UTF-8"?><html><body><h1>Chapter Three</h1><p>Mapping repo files to book sections.</p></body></html>`,
		"OEBPS/images/cover.png":    string(pngFixture()),
	}
	for _, opt := range opts {
		opt(files)
	}
	return writeEPUB(t, files)
}

func writeEPUB(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "sample.epub")
	output, err := os.Create(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = output.Close() })
	writer := zip.NewWriter(output)
	for name, content := range files {
		header := &zip.FileHeader{Name: name, Method: zip.Deflate}
		if name == "mimetype" {
			header.Method = zip.Store
		}
		w, err := writer.CreateHeader(header)
		require.NoError(t, err)
		_, err = w.Write([]byte(content))
		require.NoError(t, err)
	}
	require.NoError(t, writer.Close())
	require.NoError(t, output.Close())
	return path
}

func pngFixture() []byte {
	return append([]byte("\x89PNG\r\n\x1a\n"), []byte("epubcover")...)
}

func TestInspectEPUBParsesMetadataAndSpine(t *testing.T) {
	path := newSampleEPUB(t)
	inspection, pkg, err := inspectEPUB(path)
	require.NoError(t, err)
	require.NotNil(t, inspection.Metadata)
	require.NotNil(t, pkg)

	assert.Equal(t, BookFormatEPUB, inspection.Format)
	assert.NotEmpty(t, inspection.FileHash)
	assert.Positive(t, inspection.SizeBytes)
	assert.False(t, inspection.Metadata.HasEncryption)
	assert.Equal(t, "Sample Technical Book", inspection.Metadata.Title)
	assert.Equal(t, []string{"Author One", "Author Two"}, inspection.Metadata.Authors)
	assert.Equal(t, "Glint Press", inspection.Metadata.Publisher)
	assert.Equal(t, "images/cover.png", inspection.Metadata.CoverItemHref)
	assert.Len(t, pkg.Spine, 3)
	assert.Equal(t, "text/chapter1.xhtml", pkg.Spine[0].Href)
}

func TestInspectEPUBDetectsEncryption(t *testing.T) {
	path := newSampleEPUB(t, func(files map[string]string) {
		files["META-INF/encryption.xml"] = "<encryption xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\"></encryption>"
	})
	inspection, _, err := inspectEPUB(path)
	require.NoError(t, err)
	require.NotNil(t, inspection.Metadata)
	assert.True(t, inspection.Metadata.HasEncryption)
}

func TestInspectBookRejectsDRMProtectedEPUB(t *testing.T) {
	path := newSampleEPUB(t, func(files map[string]string) {
		files["META-INF/encryption.xml"] = "<encryption xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\"></encryption>"
	})
	_, _, err := inspectBook(path)
	assert.ErrorIs(t, err, ErrEPUBDRMProtected)
}

func TestInspectBookRejectsUnknownExtensions(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "notes.txt")
	require.NoError(t, os.WriteFile(path, []byte("hello"), 0o600))
	_, _, err := inspectBook(path)
	assert.ErrorIs(t, err, ErrUnsupportedBookFormat)
}

func TestExtractSpineItemTextStripsScriptsAndKeepsHeadings(t *testing.T) {
	path := newSampleEPUB(t)
	_, pkg, err := inspectEPUB(path)
	require.NoError(t, err)

	reader, err := zip.OpenReader(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = reader.Close() })
	content, err := pkg.extractSpineItemText(&reader.Reader, pkg.Spine[0])
	require.NoError(t, err)
	assert.Contains(t, content.Text, "Chapter One")
	assert.Contains(t, content.Text, "Hello evidence")
	assert.NotContains(t, content.Text, "ignored")
	assert.Equal(t, "Chapter One", content.Heading)
}

func TestXHTMLHeadingUsesFirstNonEmptySectionHeading(t *testing.T) {
	cases := map[string]struct {
		body    string
		heading string
	}{
		"nested inline markup": {
			body:    `<h2><span>3.2</span>  <em>Channels</em></h2><h1>Later</h1>`,
			heading: "3.2 Channels",
		},
		"skips h4 and empty headings": {
			body:    `<h4>Aside</h4><h1> </h1><h3>Real heading</h3>`,
			heading: "Real heading",
		},
		"no heading": {
			body:    `<p>Only prose.</p>`,
			heading: "",
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			content, err := xhtmlToPlainText([]byte("<html><body>" + tc.body + "</body></html>"))
			require.NoError(t, err)
			assert.Equal(t, tc.heading, content.Heading)
		})
	}
}

func TestExtractSpineItemTextTruncatesOversizedSection(t *testing.T) {
	large := strings.Repeat("a", maxBookPageTextBytes+1024)
	path := newSampleEPUB(t, func(files map[string]string) {
		files["OEBPS/text/chapter1.xhtml"] = "<html><body><p>" + large + "</p></body></html>"
	})
	_, pkg, err := inspectEPUB(path)
	require.NoError(t, err)
	reader, err := zip.OpenReader(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = reader.Close() })
	content, err := pkg.extractSpineItemText(&reader.Reader, pkg.Spine[0])
	require.NoError(t, err)
	assert.LessOrEqual(t, len(content.Text), maxBookPageTextBytes)
}

func TestExtractCoverReturnsImageBytes(t *testing.T) {
	path := newSampleEPUB(t)
	_, pkg, err := inspectEPUB(path)
	require.NoError(t, err)
	reader, err := zip.OpenReader(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = reader.Close() })
	data, mediaType, err := pkg.extractCover(&reader.Reader)
	require.NoError(t, err)
	assert.Equal(t, "image/png", mediaType)
	assert.True(t, bytes.HasPrefix(data, []byte("\x89PNG")))
}
