---
permalink: web-clipper/book-viewer
---
The Book Viewer is a built-in PDF reader that renders documents with full text selection, [[Highlight web pages#Cross-site lookup|cross-site lookup]], and [[Highlight web pages|highlighting]] support.

## Why use the Book Viewer

Browser PDF viewers render content inside a closed `<embed>` element, making the text inaccessible to extensions. The Book Viewer renders PDFs using PDF.js with a proper text layer, so all Web Clipper features work:

- **Text selection** — select and clip text from any page.
- **Cross-site lookup** — tag matches are highlighted as you read.
- **Highlighter** — highlight passages and save them to Obsidian.
- **Content picker** — select text blocks to include in your note.
- **PDF metadata** — title, author, subject, and keywords are extracted and available as template [[Variables|variables]].

## Opening PDFs

PDFs opened in the browser (`file://` or `http://`/`https://` URLs) are automatically redirected to the Book Viewer.

You can also open a PDF manually using the **Open PDF** button in the Book Viewer toolbar.

## Navigation

| Action              | Control                                    |
| ------------------- | ------------------------------------------ |
| Next page           | `→` or Page Down                           |
| Previous page       | `←` or Page Up                             |
| Zoom in             | `Ctrl/Cmd + =` or zoom button              |
| Zoom out            | `Ctrl/Cmd + -` or zoom button              |
| Fit to width        | **Fit** button in toolbar                  |
| Go to page          | Click page indicator in toolbar            |

## Template variables

The Book Viewer provides additional [[Variables|template variables]] for local files:

| Variable           | Description                                           |
| ------------------ | ----------------------------------------------------- |
| `{{filePath}}`     | Full file path (e.g. `/Users/john/Documents/book.pdf`) |
| `{{fileName}}`     | File name (e.g. `book.pdf`)                            |
| `{{pageNumber}}`   | Current page number                                    |
| `{{title}}`        | PDF metadata title (falls back to file name)           |
| `{{author}}`       | PDF metadata author                                    |
| `{{description}}`  | PDF metadata subject                                   |

## Performance

Pages are lazily rendered as you scroll — only visible pages are drawn. This allows the Book Viewer to handle large documents without performance issues.

## Requirements

- **Chrome**: You must enable **Allow access to file URLs** in `chrome://extensions` for the extension to work on local PDF files.
- **Firefox / Safari**: Local file access is granted automatically.
