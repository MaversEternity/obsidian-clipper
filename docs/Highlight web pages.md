---
permalink: web-clipper/highlight
aliases:
  - highlights
  - Highlighter
---
[[Introduction to Obsidian Web Clipper|Web Clipper]] lets you highlight text on web pages, and select the elements you want to save to Obsidian. Your highlights are saved, so you can revisit them when you return to a page.

Highlights can be [[Clip web pages|captured]] and saved to Obsidian when you open the extension.

## Turn on highlighter

You can turn on highlighting in several ways, depending on your browser:

- The highlighter icon in the extension panel.
- Hotkeys, to activate the extension from your keyboard.
- Context menu, by right-clicking the web page you are visiting.

Once highlighting is on, you can select text, images, and elements you want to highlight.

## Highlighter settings

You can change the highlighter behavior by going to Web Clipper settings. Here you can also export your highlights to a `.json` file.

There are three options for highlights to be inserted into your clipped note via the `{{content}}` [[Variables|variable]]:

- **Highlight the page content** — adds highlights directly to the text with the [[Obsidian Flavored Markdown|syntax]] `==highlight==`.
- **Replace the page content** — returns a list of highlights, without any of the page content.
- **Do nothing** — returns the original content without highlights.

You can add highlights directly to your template using the `{{highlights}}` variable, for example:

```
{{highlights|map: item => item.text|join:"\n\n"}}
```

## Cross-site lookup

Cross-site lookup finds and highlights connections between the page you're viewing and your Obsidian vault. When enabled, the extension scans visible text for matches against your vault's tags and note titles, and highlights them directly on the page.

Clicking a highlighted match shows a context menu with options to view the related note in the clipper or open it directly in Obsidian.

### Enable lookup

1. Go to Web Clipper **Settings** → **General**.
2. Toggle **Enable cross-site lookup**.
3. Enter your Obsidian REST API key (required for vault access).

### How it works

- The extension fetches tags from your Obsidian vault via the REST API.
- As you scroll, visible text is scanned and matching terms are highlighted with a blue underline.
- Only text currently in the viewport is processed for performance.
- Lookup works on regular web pages, `file://` URLs, and the [[Book Viewer]].

### Context filtering

You can filter lookup results by vault folder using the **context** dropdown in the clipper panel. Only notes within the selected folder will be matched.
