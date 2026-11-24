package books

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strings"

	"golang.org/x/net/html"
)

const (
	maxEPUBFileBytes      = 512 << 20
	maxEPUBOPFBytes       = 4 << 20
	maxEPUBSpineItemBytes = 16 << 20
	maxEPUBCoverBytes     = 8 << 20
)

type SpineItem struct {
	Index     int    `json:"index"`
	ID        string `json:"id"`
	Href      string `json:"href"`
	MediaType string `json:"mediaType"`
	Title     string `json:"title"`
}

type epubPackage struct {
	OPFDirectory   string
	Manifest       map[string]epubManifestItem
	Spine          []SpineItem
	Metadata       EPUBMetadata
	CoverItemHref  string
	CoverMediaType string
}

type epubManifestItem struct {
	ID         string
	Href       string
	MediaType  string
	Properties string
}

type containerXML struct {
	Rootfiles []struct {
		FullPath  string `xml:"full-path,attr"`
		MediaType string `xml:"media-type,attr"`
	} `xml:"rootfiles>rootfile"`
}

type opfPackage struct {
	XMLName  xml.Name    `xml:"package"`
	Metadata opfMetadata `xml:"metadata"`
	Manifest opfManifest `xml:"manifest"`
	Spine    opfSpine    `xml:"spine"`
}

type opfMetadata struct {
	Titles       []string         `xml:"http://purl.org/dc/elements/1.1/ title"`
	Creators     []string         `xml:"http://purl.org/dc/elements/1.1/ creator"`
	Language     string           `xml:"http://purl.org/dc/elements/1.1/ language"`
	Publisher    string           `xml:"http://purl.org/dc/elements/1.1/ publisher"`
	Descriptions []string         `xml:"http://purl.org/dc/elements/1.1/ description"`
	Meta         []opfMetaElement `xml:"meta"`
}

type opfMetaElement struct {
	Name    string `xml:"name,attr"`
	Content string `xml:"content,attr"`
}

type opfManifest struct {
	Items []opfManifestItem `xml:"item"`
}

type opfManifestItem struct {
	ID         string `xml:"id,attr"`
	Href       string `xml:"href,attr"`
	MediaType  string `xml:"media-type,attr"`
	Properties string `xml:"properties,attr"`
}

type opfSpine struct {
	Items []opfSpineItem `xml:"itemref"`
}

type opfSpineItem struct {
	IDRef string `xml:"idref,attr"`
}

func inspectEPUB(filePath string) (Inspection, *epubPackage, error) {
	info, err := os.Stat(filePath)
	if err != nil {
		return Inspection{}, nil, fmt.Errorf("inspect EPUB: %w", err)
	}
	if info.IsDir() {
		return Inspection{}, nil, errors.New("selected EPUB path is a directory")
	}
	if info.Size() > maxEPUBFileBytes {
		return Inspection{}, nil, errors.New("selected EPUB is too large")
	}
	hash, err := hashFile(filePath)
	if err != nil {
		return Inspection{}, nil, err
	}

	reader, err := zip.OpenReader(filePath)
	if err != nil {
		return Inspection{}, nil, fmt.Errorf("open EPUB archive: %w", err)
	}
	defer func() { _ = reader.Close() }()

	hasEncryption := zipFileExists(&reader.Reader, "META-INF/encryption.xml")
	pkg, err := parseEPUBPackage(&reader.Reader)
	if err != nil {
		if hasEncryption {
			return Inspection{
				Format:    BookFormatEPUB,
				FileHash:  hash,
				SizeBytes: info.Size(),
				ModTime:   info.ModTime(),
				Metadata:  &EPUBMetadata{HasEncryption: true},
			}, nil, nil
		}
		return Inspection{}, nil, err
	}
	pkg.Metadata.HasEncryption = hasEncryption
	pkg.Metadata.CoverItemHref = pkg.CoverItemHref

	metadata := pkg.Metadata
	return Inspection{
		Format:    BookFormatEPUB,
		FileHash:  hash,
		SizeBytes: info.Size(),
		ModTime:   info.ModTime(),
		Metadata:  &metadata,
	}, pkg, nil
}

func loadEPUBPackage(filePath string) (*epubPackage, error) {
	reader, err := zip.OpenReader(filePath)
	if err != nil {
		return nil, fmt.Errorf("open EPUB archive: %w", err)
	}
	defer func() { _ = reader.Close() }()
	if zipFileExists(&reader.Reader, "META-INF/encryption.xml") {
		return nil, ErrEPUBDRMProtected
	}
	pkg, err := parseEPUBPackage(&reader.Reader)
	if err != nil {
		return nil, err
	}
	pkg.Metadata.CoverItemHref = pkg.CoverItemHref
	return pkg, nil
}

func parseEPUBPackage(reader *zip.Reader) (*epubPackage, error) {
	opfPath, err := readContainerXML(reader)
	if err != nil {
		return nil, err
	}
	rawOPF, err := readZipFile(reader, opfPath, maxEPUBOPFBytes)
	if err != nil {
		return nil, fmt.Errorf("read EPUB OPF: %w", err)
	}
	var opf opfPackage
	if err := xml.Unmarshal(rawOPF, &opf); err != nil {
		return nil, fmt.Errorf("parse EPUB OPF: %w", err)
	}

	pkg := &epubPackage{
		OPFDirectory: path.Dir(opfPath),
		Manifest:     make(map[string]epubManifestItem, len(opf.Manifest.Items)),
	}
	for _, item := range opf.Manifest.Items {
		pkg.Manifest[item.ID] = epubManifestItem{
			ID:         item.ID,
			Href:       item.Href,
			MediaType:  item.MediaType,
			Properties: item.Properties,
		}
	}

	for i, ref := range opf.Spine.Items {
		manifestItem, ok := pkg.Manifest[ref.IDRef]
		if !ok {
			continue
		}
		pkg.Spine = append(pkg.Spine, SpineItem{
			Index:     i,
			ID:        manifestItem.ID,
			Href:      manifestItem.Href,
			MediaType: manifestItem.MediaType,
		})
	}

	pkg.Metadata = EPUBMetadata{
		Title:       firstNonEmpty(opf.Metadata.Titles),
		Authors:     trimAll(opf.Metadata.Creators),
		Language:    strings.TrimSpace(opf.Metadata.Language),
		Publisher:   strings.TrimSpace(opf.Metadata.Publisher),
		Description: firstNonEmpty(opf.Metadata.Descriptions),
	}
	coverID := ""
	for _, meta := range opf.Metadata.Meta {
		if strings.EqualFold(strings.TrimSpace(meta.Name), "cover") {
			coverID = strings.TrimSpace(meta.Content)
			break
		}
	}
	pkg.CoverItemHref, pkg.CoverMediaType = resolveCoverItem(pkg.Manifest, coverID)

	return pkg, nil
}

func readContainerXML(reader *zip.Reader) (string, error) {
	raw, err := readZipFile(reader, "META-INF/container.xml", maxEPUBOPFBytes)
	if err != nil {
		return "", fmt.Errorf("read EPUB container.xml: %w", err)
	}
	var container containerXML
	if err := xml.Unmarshal(raw, &container); err != nil {
		return "", fmt.Errorf("parse EPUB container.xml: %w", err)
	}
	for _, rootfile := range container.Rootfiles {
		full := strings.TrimSpace(rootfile.FullPath)
		if full == "" {
			continue
		}
		mediaType := strings.TrimSpace(rootfile.MediaType)
		if mediaType != "" && mediaType != "application/oebps-package+xml" {
			continue
		}
		return path.Clean(full), nil
	}
	return "", errors.New("EPUB container.xml does not list an OPF rootfile")
}

func resolveCoverItem(manifest map[string]epubManifestItem, coverID string) (string, string) {
	if coverID != "" {
		if item, ok := manifest[coverID]; ok && isImageMediaType(item.MediaType) {
			return item.Href, item.MediaType
		}
	}
	for _, item := range manifest {
		if strings.Contains(item.Properties, "cover-image") {
			return item.Href, item.MediaType
		}
	}
	return "", ""
}

type spineItemContent struct {
	Text    string
	Heading string
}

func (pkg *epubPackage) extractSpineItemText(reader *zip.Reader, item SpineItem) (spineItemContent, error) {
	target := pkg.resolveHref(item.Href)
	raw, err := readZipFile(reader, target, maxEPUBSpineItemBytes)
	if err != nil {
		return spineItemContent{}, fmt.Errorf("read EPUB spine item %q: %w", item.Href, err)
	}
	content, err := xhtmlToPlainText(raw)
	if err != nil {
		return spineItemContent{}, fmt.Errorf("convert EPUB spine item %q: %w", item.Href, err)
	}
	if len(content.Text) > maxBookPageTextBytes {
		content.Text = truncateUTF8(content.Text, maxBookPageTextBytes)
	}
	if len(content.Heading) > maxSpineHeadingBytes {
		content.Heading = truncateUTF8(content.Heading, maxSpineHeadingBytes)
	}
	return content, nil
}

const maxSpineHeadingBytes = 1024

func (pkg *epubPackage) extractCover(reader *zip.Reader) ([]byte, string, error) {
	if pkg.CoverItemHref == "" {
		return nil, "", nil
	}
	target := pkg.resolveHref(pkg.CoverItemHref)
	raw, err := readZipFile(reader, target, maxEPUBCoverBytes)
	if err != nil {
		return nil, "", err
	}
	mediaType := pkg.CoverMediaType
	if mediaType == "" {
		mediaType = guessImageMediaType(target)
	}
	return raw, mediaType, nil
}

func (pkg *epubPackage) resolveHref(href string) string {
	if pkg.OPFDirectory == "" || pkg.OPFDirectory == "." {
		return path.Clean(href)
	}
	return path.Clean(pkg.OPFDirectory + "/" + href)
}

const maxBookPageTextBytes = 4 * 1024 * 1024

func xhtmlToPlainText(raw []byte) (spineItemContent, error) {
	tokenizer := html.NewTokenizer(strings.NewReader(string(raw)))
	tokenizer.AllowCDATA(true)

	var (
		builder        strings.Builder
		headingBuilder strings.Builder
		heading        string
		inHeading      string
		skip           int
	)
	flushBreak := func() {
		if builder.Len() == 0 {
			return
		}
		if last := builder.String()[builder.Len()-1]; last == '\n' {
			return
		}
		builder.WriteByte('\n')
	}
	for {
		tokenType := tokenizer.Next()
		switch tokenType {
		case html.ErrorToken:
			if err := tokenizer.Err(); err != nil && !errors.Is(err, io.EOF) {
				return spineItemContent{}, err
			}
			return spineItemContent{Text: normalizeWhitespace(builder.String()), Heading: heading}, nil
		case html.StartTagToken, html.SelfClosingTagToken:
			name, _ := tokenizer.TagName()
			tag := string(name)
			if tag == "script" || tag == "style" {
				if tokenType == html.StartTagToken {
					skip++
				}
				continue
			}
			if skip > 0 {
				continue
			}
			if isBlockTag(tag) {
				flushBreak()
			}
			if tag == "br" {
				flushBreak()
			}
			if heading == "" && inHeading == "" && isSectionHeadingTag(tag) && tokenType == html.StartTagToken {
				inHeading = tag
				headingBuilder.Reset()
			}
		case html.EndTagToken:
			name, _ := tokenizer.TagName()
			tag := string(name)
			if tag == "script" || tag == "style" {
				if skip > 0 {
					skip--
				}
				continue
			}
			if skip > 0 {
				continue
			}
			if isBlockTag(tag) {
				flushBreak()
			}
			if tag == inHeading {
				inHeading = ""
				heading = strings.Join(strings.Fields(headingBuilder.String()), " ")
			}
		case html.TextToken:
			if skip > 0 {
				continue
			}
			text := tokenizer.Text()
			builder.Write(text)
			if inHeading != "" {
				headingBuilder.Write(text)
			}
		}
	}
}

func isSectionHeadingTag(tag string) bool {
	return tag == "h1" || tag == "h2" || tag == "h3"
}

func isBlockTag(tag string) bool {
	switch tag {
	case "p", "div", "section", "article", "header", "footer",
		"h1", "h2", "h3", "h4", "h5", "h6",
		"li", "ul", "ol", "blockquote", "pre", "table", "tr", "td", "th",
		"figure", "figcaption", "hr":
		return true
	}
	return false
}

func normalizeWhitespace(input string) string {
	var builder strings.Builder
	builder.Grow(len(input))
	previousSpace := false
	previousNewline := true
	for _, r := range input {
		switch r {
		case '\r':
			continue
		case '\n':
			if previousNewline {
				continue
			}
			builder.WriteByte('\n')
			previousNewline = true
			previousSpace = false
		case ' ', '\t':
			if previousNewline {
				continue
			}
			if previousSpace {
				continue
			}
			builder.WriteByte(' ')
			previousSpace = true
		default:
			builder.WriteRune(r)
			previousSpace = false
			previousNewline = false
		}
	}
	return strings.TrimSpace(builder.String())
}

func truncateUTF8(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	cut := limit
	for cut > 0 && (value[cut]&0xC0) == 0x80 {
		cut--
	}
	return value[:cut]
}

func zipFileExists(reader *zip.Reader, name string) bool {
	for _, file := range reader.File {
		if file.Name == name {
			return true
		}
	}
	return false
}

func readZipFile(reader *zip.Reader, name string, limit int64) ([]byte, error) {
	for _, file := range reader.File {
		if file.Name != name {
			continue
		}
		opened, err := file.Open()
		if err != nil {
			return nil, err
		}
		defer func() { _ = opened.Close() }()
		return io.ReadAll(io.LimitReader(opened, limit+1))
	}
	return nil, fmt.Errorf("entry %q not found in EPUB archive", name)
}

func hashFile(filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", fmt.Errorf("open file for hash: %w", err)
	}
	defer func() { _ = file.Close() }()
	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return "", fmt.Errorf("hash file: %w", err)
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

func isImageMediaType(mediaType string) bool {
	return strings.HasPrefix(strings.ToLower(mediaType), "image/")
}

func guessImageMediaType(name string) string {
	switch strings.ToLower(extension(name)) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".svg":
		return "image/svg+xml"
	}
	return "application/octet-stream"
}

func extension(name string) string {
	for i := len(name) - 1; i >= 0 && name[i] != '/' && name[i] != '\\'; i-- {
		if name[i] == '.' {
			return name[i:]
		}
	}
	return ""
}

func trimAll(values []string) []string {
	output := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		output = append(output, trimmed)
	}
	return output
}

func firstNonEmpty(values []string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}
