---
permalink: web-clipper/markdown-editor
---
The Markdown Editor is a rich text editor in the Web Clipper side panel for composing and editing note content before saving to Obsidian.

## Formatting

The editor toolbar provides quick access to common formatting options:

| Button         | Shortcut           | Markdown syntax          |
| -------------- | ------------------ | ------------------------ |
| **Bold**       | `Ctrl/Cmd + B`     | `**text**`               |
| *Italic*       | `Ctrl/Cmd + I`     | `*text*`                 |
| ~~Strikethrough~~ | `Ctrl/Cmd + Shift + S` | `~~text~~`          |
| `Code`         | `Ctrl/Cmd + E`     | `` `text` ``             |
| Heading        |                    | `# `, `## `, `### `      |
| Quote          |                    | `> `                     |
| Bullet list    |                    | `- `                     |
| Numbered list  |                    | `1. `                    |
| Code block     |                    | ` ``` `                  |

You can also type Markdown syntax directly — the editor converts it as you type. For example, typing `# ` at the start of a line creates a heading.

## Links

Insert links with `Ctrl/Cmd + K` or the link toolbar button. You can:

- **Paste a URL** — text containing a URL is automatically converted to a clickable link.
- **Edit a link** — click any link to see a floating toolbar with the URL, an edit button, and a delete button.
- **Auto-link detection** — URLs typed or pasted are automatically recognized as links.

## Mentions (Wiki-links)

Type `[[` to insert an Obsidian wiki-link. An autocomplete dropdown shows notes from your vault:

- Filter by typing a note name.
- Use arrow keys to navigate, `Enter` or `Tab` to select.
- Creates `[[note name]]` syntax in the output.

## Images

Insert images via the toolbar button. Provide a URL and optional alt text. Images are rendered inline and exported as `![alt](url)` in Markdown.

## Undo / Redo

The editor supports full undo and redo with `Ctrl/Cmd + Z` and `Ctrl/Cmd + Shift + Z`.

## Markdown output

The editor content is converted to Markdown when saving to Obsidian. All formatting, links, wiki-links, and images are preserved in standard Markdown and [[Obsidian Flavored Markdown]] syntax.
