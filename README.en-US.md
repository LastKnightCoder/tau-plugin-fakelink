# FakeLink

Whenever you mention the title of another article or project document in your text, FakeLink recognizes it and adds a dotted underline. Click to jump straight to that note—no manual links needed. For example, if you have an article titled *Forgetting Curve*, typing "Forgetting Curve" in another note makes it clickable right away.

Your underlying text is never modified, so saving, syncing, and exporting stay completely untouched. Beyond titles, you can also jump to specific headings or trace shared phrases back to the notes where you wrote them.

## Getting Started

1. **Install**: Install **FakeLink** from the Plugin Center.
2. **Allow read access**: On first enable, choose **Always allow** when prompted for data access. FakeLink only reads your content and never alters any notes.
3. **Click a title**: Open an article—mentioned titles appear with a dotted underline. Click to open the target note, or hover over the title first to preview it.

If your library is large, wait a moment while FakeLink indexes your titles before underlines appear.

## What You Can Do

- **Jump by title**: Mention "Forgetting Curve" and click it to open *Forgetting Curve*.
- **Pick among duplicates**: When multiple notes share the same title, clicking opens a picker showing each item's type, tags, and creation date. Hover an item to preview it, then click to open.
- **Jump to a heading**: Enable any combination of H1–H6 in Settings to make headings from other notes clickable too. For instance, if *Forgetting Curve* has a heading "Spaced Repetition", clicking it elsewhere jumps straight to that section.
- **Rediscover shared passages**: Enable **Body phrases** in Settings to highlight meaningful phrases shared across notes and jump to the matching passage. It focuses on context-matched phrases worth revisiting rather than accidental overlaps or clutter.
- **Reveal all clickable terms**: Hold `⌘` (`Ctrl` on Windows) to highlight every clickable match in the current note.

## Customize to Your Workflow

Configure appearance and scope under **Settings › Fake links** on the plugin detail page.

- **Keep links subtle**: Switch **Appearance** to **Hidden** so matches stay invisible until you hover or hold `⌘`, or pick **Highlighter** or **Tinted**.
- **Use in Cards**: Enable **Card** under **Where to show decorations** so titles and shared phrases become clickable inside cards as well.
- **Exclude certain note types from title matching**: Uncheck them under **Where to collect titles from**.
- **Limit shared-phrase matching to specific note types**: Choose them under **Where to collect body text from**.

## FAQ

**Why didn't a title get underlined?** You need to write the full title, and Latin letters are case-sensitive—writing only part of a title will not match. A note also never links to its own title.

**Why wasn't a note titled "Summary" linked?** Overly common words like "Summary" or "Definition" are skipped to avoid cluttering every paragraph. Headings follow a similar rule: a heading is matched when its parent note is mentioned in the same paragraph, jumping straight to that section.

**No links appear after installing?** Large libraries take a moment to index. If links still do not appear, check the plugin's **Permissions** to confirm read access is granted, then run **FakeLink: Rebuild index** from the command palette.

**Will disabling the plugin change my notes?** No. Decorations are purely visual—disabling the plugin removes them while leaving your text unchanged.

**Does it work on mobile?** No, FakeLink is desktop-only.
