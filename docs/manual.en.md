# Sandsea Notes · Manual

Complete usage documentation. If you'd like to first learn what this project is and how to install it, see [README](../README.md).

---

## Table of Contents

- [1. Installation and Build](#1-installation-and-build)
- [2. Choosing a Vault](#2-choosing-a-vault)
- [3. Creating and Editing](#3-creating-and-editing)
- [4. Views and Themes](#4-views-and-themes)
- [5. Version History and Sync](#5-version-history-and-sync)
- [6. Committing and Browsing History](#6-committing-and-browsing-history)
- [7. Data and Security](#7-data-and-security)
- [8. FAQ](#8-faq)
- [9. Not Implemented Yet](#9-not-implemented-yet)
- [10. Tech Stack and Project Structure](#10-tech-stack-and-project-structure)
- [11. Contributing](#11-contributing)

---

## 1. Installation and Build

### Requirements

- **Node.js 20.19+ or 22.12+** (required by Vite 7)
- macOS is the current development and verification platform; the code is written under cross-platform constraints, but Windows / Linux are untested

### Running from source

```bash
npm install
npm run dev
```

On networks in mainland China, it's advisable to route the Electron binary through a mirror:

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

npm 11 blocks dependency install scripts by default; if the Electron binary didn't download successfully, run it once more:

```bash
node node_modules/electron/install.js
```

### All commands

```bash
npm run dev         # Development mode, with hot reload
npm run typecheck   # Type check (main process + renderer)
npm run build       # Type check + build to out/
npm start           # Launch from the build output (requires npm run build first)
npm run pack        # Build and package into release/mac-arm64/Sandsea Notes.app
npm run icon        # Regenerate icons after editing build/icon.svg
```

### Packaging into a .app (macOS)

`npm run pack` → the output is at `release/mac-arm64/Sandsea Notes.app`; drag it into "Applications" and you can double-click it — no terminal needed.

> - After renaming the app (`build.productName`, `appId`) and repackaging, the Dock may still show the old name/icon — that's a LaunchServices cache; remove the old icon from the Dock and drag the new one in again.
> - **When installing, drag the whole `.app`** (the `release/mac-arm64/Sandsea Notes.app` "folder" itself) into "Applications", and **do not** drag `Sandsea Notes.app/Contents/MacOS/Sandsea Notes` — that's the executable inside the bundle, and dragging it out on its own gives you a "document" that TextEdit will open on double-click, reporting "The text encoding Unicode (UTF-8) isn't applicable / this may not be a text file". In an IDE's file tree the `.app` shows up as an ordinary folder, so it's easy to keep clicking into it — be careful not to grab the wrong thing. Finder hides extensions by default, so `release/mac-arm64/Sandsea Notes.app` and `Sandsea Notes.app/Contents/MacOS/Sandsea Notes` are displayed under the same name; pick the one whose icon is the app icon.
> - `build.electronDist` points at `node_modules/electron/dist`, which makes electron-builder **use the Electron already installed locally instead of downloading from GitHub**. Do not remove this: connections from this machine to GitHub stall (measured: TCP stuck at `SYN_SENT`), and once it's removed, packaging hangs indefinitely.
> - **No code signing is done.** On your own machine that's fine — locally built files have no quarantine attribute, Gatekeeper doesn't block them, and double-clicking launches normally (verified). Sending it to someone else gets blocked, which requires an Apple Developer account to do signing + notarization.
> - Only the current architecture is built (arm64 on this machine). Supporting Intel Macs would require configuring the `universal` target separately.
> - The packaged build and `npm run dev` **share the same configuration and vault** (both under `~/Library/Application Support/Notes`), so switching back and forth won't lose settings — but **don't run them at the same time** (the same profile would be contended by two processes).

### App icon

The vector source file is `build/icon.svg`; after editing it, run `npm run icon` to regenerate:

- `build/icon.png` (1024×1024, used to set the macOS Dock icon during development)
- `build/icon.icns` (used for packaging)

The generation script rasterizes with the Chromium bundled in Electron and renders every size directly from the vector, so there's no need to install any additional image tools.

### About the port

**The port is only used in development mode.** `npm run dev` starts a Vite dev server (5173 by default) for Electron to load the UI from; if that port is taken, Vite automatically moves on to 5174, 5175… and tells Electron the actual port, so there's nothing to handle manually.

**Build output (`npm start` or a packaged app) does not listen on any port** — the UI is loaded directly from `out/renderer/index.html` on disk, so there's no port-conflict problem when it's installed on another computer.

---

## 2. Choosing a Vault

The first launch shows a welcome page; click **"Start here"** to create a vault at the default location, or **"Choose another folder"** to pick your own.

- The left panel lists the Markdown files and attachments in that folder
- Opening a folder automatically enables local version history for it (see section 5)
- Clicking **"Change Folder"** in the sidebar lets you switch vaults at any time (it won't touch anything in the original folder)
- Hidden directories, `node_modules`, `.git`, and the like are not shown

---

## 3. Creating and Editing

### Creating

**Right-click** in the file tree → "New Note" / "New Folder". Where it's created depends on where you right-clicked:

- Right-click a **folder** → created inside that folder
- Right-click a **file** → created in that file's directory
- Right-click **empty space** → created in the vault root

The dialog states the creation location at the top; new notes don't need an extension — `.md` is appended automatically; the note opens as soon as it's created.

The context menu closes when you press `Esc`, click outside it, scroll, or zoom the window.

### Saving

**Saving is automatic**: changes are written to disk about 0.7 seconds after you stop typing, and `Cmd+S` saves immediately. In the top-right of the content area you'll see `Saved` / `Unsaved` / `Saving…` (which file is open shows as the highlighted row in the file tree on the left).

### Context menu

**Select some text in the editor and right-click** to cut / copy / paste / select all. With nothing selected, "Cut" and "Copy" are greyed out. Clipboard reads and writes go through the main process, so they don't depend on clipboard permissions in the renderer.

### Formatting toolbar

A row of buttons above the editing area; select some text and click a button to apply the format. With nothing selected, it inserts placeholder content and selects it, so you can just start typing to replace it.

| Group | Buttons |
|---|---|
| Inline | Bold `B`, italic `I`, strikethrough `S`, inline code `<>`, link, text color |
| Headings | `H1` `H2` `H3` |
| Lists | Unordered `•`, ordered `1.`, to-do `☐`, quote `❝` |
| Insert | Code block, table, Mermaid diagram, horizontal rule |

**Table**: clicking the table button opens a grid; as you move the mouse over a cell, the panel shows how many columns and rows you'd get (up to 10 × 10), and one click inserts it; click outside the panel or press `Esc` to cancel. The row count includes the header row — choosing "3 rows" gives 1 header row + 2 body rows, which renders as exactly 3 rows.

**Text color**: clicking the `A` with a color bar opens 8 presets, plus the system color picker for any color, plus "Clear Color". With text selected, click a color to apply it; **clicking another color on text that's already colored changes the color rather than nesting it**.

> Colors are stored as `[text]{color=#c2635a}`. Markdown has no native text-color syntax, and writing `<span style="color:...">` would mean turning on raw-HTML passthrough in the renderer, adding an XSS attack surface whenever external content is pasted — so this reuses the same curly-brace attribute syntax as images' `{width=320}`. Hex values are supported, along with the color names `red` / `orange` / `yellow` / `green` / `teal` / `blue` / `purple` / `pink` / `gray` / `black` / `white`; a value it doesn't recognize is displayed as plain text, and nothing is injected into `style`.

Headings, lists, to-dos, and quotes are **toggles**: clicking again on a line that already has that format removes it; switching from one line-level format to another (say, a quote line to a list) replaces rather than stacking, and the line's leading indentation is preserved. Tables, code blocks, and Mermaid insert a template you can edit directly.

### Inserting images

After taking a screenshot, just `Cmd+V`, or drag an image file into the editing area, and it will automatically:

1. save it to `images/` in the **vault root** (created on demand), with a filename like `image-20260929-234654.jpg`
2. insert a reference at the cursor, e.g. `![name](images/image-20260929-234654.jpg)`

The reference path is recalculated automatically according to how deep the note is — a note in a subdirectory becomes `../images/xxx.png`. So moving the whole vault elsewhere won't break anything; but if you move a single note to a different depth, you'll need to adjust that prefix yourself. Supported formats are `png / jpg / jpeg / gif / webp / svg`, up to 20 MB each.

Images in the preview aren't read from disk directly; they go through an internal protocol that only allows "images inside the vault" (see [Data and Security](#7-data-and-security)).

### Resizing images

Hover over an image in the preview and a handle appears in the bottom-right corner; drag it to change the width, and on release the width is written back to the source:

```markdown
![image](images/x.png){width=320}
```

You can also write this curly-brace syntax in the source yourself (it supports `width` / `height`, in pixels), and the preview will display the image at that size. The change goes into the undo history, so `Cmd+Z` / `Ctrl+Z` can undo it.

> Reference-style syntax (`![description][ref]`) can't be resized by dragging for now — its address isn't available in the editor's syntax tree, so there's no way to confirm it's the same image. A hint appears in the status bar while dragging.

### Viewing images

Clicking an image file in the file tree shows it on the right, scaled proportionally to the available space and centered (the title bar shows `Image`, and there's no edit/split/reading switch). Images are read-only and don't need saving; switching back to a note restores editing automatically.

---

## 4. Views and Themes

Three buttons in the top-right of the content area switch views:

| View | Description |
|---|---|
| Edit | Source only |
| Split | Source on the left, live preview on the right |
| Reading | Rendered result only |

**In split view the two panes scroll together**, and only one scrollbar is shown (the one on the preview, on the right) — scroll either side and the other follows. The panes are aligned by **source line number**, not by scroll percentage: the editor has a fixed line height while the preview holds images, tables and diagrams, so the two panes end up with very different content heights. Percentage-based alignment drifts as soon as there's a large image or a long code block, and the error only grows as you scroll.

The preview supports GFM tables, task lists `- [ ]`, footnotes, code blocks, and more. **Mermaid diagrams** (a `` ```mermaid `` code block) render as real flowcharts / sequence diagrams, colored to match the current theme; if the source has an error, the error message and the original code are shown in place, rather than taking down the whole preview.

### Editing straight from the preview

The preview in Split and Reading views is not read-only: task items and tables can be edited right there, and the change is written back to the source and saved automatically.

- **Ticking a task** — click the checkbox in front of `- [ ]` and the source flips to `[x]`; click again to flip back. Clicking the text does not toggle it, so you can still select and copy a task.
- **Editing table cells** — click into any cell (header cells included) and type; about **0.4 s after you stop typing** the content is written back to the source, without leaving the table. Pressing Enter or clicking outside flushes it immediately. **Arrow keys move between cells**: Left/Right jump into the neighbouring cell once the caret reaches the edge, Up/Down jump to the same column of the row above or below. Holding `Shift` still does plain selection.
- **Adding and removing rows/columns** — **right-click a cell** and the menu offers "insert row above / insert row below / delete row / insert column left / insert column right / delete column", all relative to **the cell you right-clicked**. The header row cannot be deleted and neither can the last remaining column — those two items are greyed out. The lower part of the menu has "cut / copy / paste", and any text selected before the right-click comes along with it. Right-clicking **outside** a table still shows the browser's own menu, so copying and looking things up keep working.

All of these go into undo history — `Cmd+Z` / `Ctrl+Z` reverts them. Two things to know:

- Cells are written back as **plain text**: a cell you edited loses any bold, links, or inline code it had. Cells you did not touch are unaffected. Edit the source directly if you need to keep the formatting.
- A `|` inside cell content is written as `\|`, otherwise it would cut the table apart.

> Writing back re-renders the preview and replaces that cell's DOM, so the implementation puts the caret back where it was — you can sit in a cell and watch the source pane follow along. When you are typing with an IME, the write-back waits until the composition is **committed**, otherwise the candidate window would be interrupted.

The **`Follow System` / `Light` / `Dark`** buttons in the status bar cycle the theme when clicked, and the choice is remembered. The default is "Follow System".

**"About"** on the right of the status bar shows a short description of the app, the version number, and a link to a Markdown syntax reference (clicking hands it to your system browser — the app itself never loads remote content).

### Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+S` / `Ctrl+S` | Save immediately |
| `Cmd+B` / `Ctrl+B` | Bold the selection |
| `Cmd+I` / `Ctrl+I` | Italicize the selection |
| `Tab` | Indent the current line (indents all selected lines when there's a selection) |
| `Shift+Tab` | Outdent |

> Everything else relies on the editor's built-in behavior (undo, find, list continuation, auto-linking on paste, etc.).
> If you want to use `Tab` to move between UI controls, press `Esc` to temporarily restore Tab's focus navigation.

---

## 5. Version History and Sync

Click **"Settings"** in the bottom bar. The dialog has two blocks — local first, remote second.

### Local version history (on by default)

When you open a folder as a vault, local version history is **switched on automatically** — no configuration needed. History lives in the vault's own `.git` directory, entirely on this machine, with no network access.

The only thing to confirm here is the **commit signature** (name + email): it's written into every commit record. It defaults to your system username and `username@localhost`; change it to an email you actually use (GitHub / Gitee will show it to others if you push).

### Push to a remote (optional, collapsed by default)

Expand this block when you want another device to see these notes:

| Field | Description |
|---|---|
| Remote URL | For example `https://gitee.com/username/repo.git`, or a GitHub HTTPS URL |
| Account name | Gitee requires your real account name; GitHub accepts any non-empty value |
| Access token | For Gitee, a "personal token"; for GitHub, a fine-grained PAT. **Leaving it blank means the saved token is not changed** |
| Branch · Implementation | Tucked under "Advanced", normally leave them alone. The built-in implementation needs no git installed and is HTTPS-only; system git supports SSH |

Fill in the URL and click **"Save"** — nothing else to click. The bottom-bar button changes from "Commit to history" to "Sync".

> Create the repository on GitHub / Gitee first, ideally empty (don't tick "Add a README"), otherwise the first sync reports that the remote is ahead.
> The token is entered once when saving; after that it's encrypted and stored by the system keychain, and never written into the notes directory.
> Already have this vault's repository on the remote? Use **"Clone from remote"** at the bottom of the same block — it clones locally and switches to it automatically.

---

## 6. Committing and Browsing History

The bottom bar always shows a status, e.g. `3 files changed, not committed`. Click **"Commit to history"** (this becomes "Sync" once a remote URL is set):

1. The dialog lists this commit's changed files **on the left**, each tagged with `+N` `−M`; **click a file and its line-by-line changes appear on the right** (`+` for added lines, `−` for removed ones). The first file is selected automatically, so the right pane is useful before you click anything
2. The commit message defaults to the current time (e.g. `2026-10-02 22:30`), and you can replace it with anything
3. **Local history only**: "Commit to history" writes it into local version history
4. **With a remote**: there's an extra "Commit and push", or "Commit locally only" first

> Binary files such as images aren't diffed line by line — expanding one just says so, and the whole file is recorded in history on commit.

| Bottom bar status | Meaning |
|---|---|
| Local version history not enabled | Automatic setup failed; click "Settings" → "Enable now" |
| Local repository, nothing to commit | The working tree is clean |
| N files changed, not committed | There are changes worth recording |
| Repository connected, access token needed | Enter the token (only needed for HTTPS remotes) |
| No changes to sync | The working tree is clean |
| N files changed, not synced | There are changes waiting to be synced |

**When both machines have made changes and the history has diverged**: syncing reports that the remote is ahead, and **"Pull"** and **"Open Vault Folder"** appear in the bottom bar. First use "Commit locally only" to record this side's content in the version history, then pull; if both sides changed the same file, the app won't merge automatically and you'll need to resolve it by hand in the vault directory.

### Viewing history and restoring a file

As soon as the vault is a Git repository (with or without a remote), a **"History"** button appears in the bottom bar. The panel lays out three columns — **commits | changed files | diff** — all of them stay put, and clicking in one updates the next one to its right. There's no "back" button to speak of:

1. The left column lists commits; click one → the middle column lists the files it changed, each tagged with `+N` `−M`
2. Click a file in the middle → the right column shows its line-by-line diff, `+` for added lines and `−` for removed ones
3. To go back to a version, click **"Restore this version"** above the diff

The newest commit, and the first file it changed, are selected automatically — all three columns have content the moment the panel opens.

> The columns are narrow, so long commit messages and file paths get truncated with an ellipsis — **hover over a row and the full text pops up**.
> Binary files such as images aren't diffed line by line, so their rows show no counts.

Restoring works at the **file level**: only that one file's content is reverted to how it looked in that commit. Other files are untouched, and no branch pointer moves. The restored content counts as an uncommitted change and is not committed automatically — take a look in the editor first, then decide whether to commit.

> If that file is open in the editor with unsaved edits, the restore is blocked. Save or undo first, then restore.

---

## 7. Data and Security

| Item | Location |
|---|---|
| Notes | The vault folder you chose (plain Markdown, no extra metadata) |
| Pasted images | `images/` in the vault root (ordinary image files, synced along with the notes) |
| Version history | `.git` in the vault folder (a standard Git repository, works with no network; switching vaults doesn't take it along) |
| App configuration | `~/Library/Application Support/Notes/config.json` |
| Git access token | `~/Library/Application Support/Notes/credentials.json` (encrypted via `safeStorage`, file permissions `600`) |

A few design constraints:

- **The token is not written into the notes directory and not logged**; it's passed to git via environment variables, never appearing in command-line arguments
- **Images are loaded through an internal protocol** (`notes-asset://`). The renderer can only request this protocol, and the main process validates each path: it must be a file inside the vault and its extension must be on the image whitelist; out-of-bounds paths and any other file types return 404. The reason for not using `file://` is that it would hand the page read access to the entire file system
- **Pasted/dropped images only pass binary content to the main process**; the renderer can't specify any read/write path
- **Never silently overwrite**: before writing back, the file's modification time is compared, and if an external change is detected the write is refused and a prompt is shown
- **No destructive Git operations**: no automatic `rebase`, no `force push`; when the remote is ahead it only shows a prompt
- The UI makes no external network requests (no telemetry beyond the Git remote you configure); fonts and themes are all local with no remote resources

**Resetting app configuration**: quit the app and delete `config.json` (the notes themselves are unaffected).

---

## 8. FAQ

**A macOS keychain/password prompt appears every time it opens**
The window uses an in-memory session, so Chromium no longer touches the keychain for cookies. If it still appears, please record the dialog text verbatim — that means the source isn't the keychain and needs to be tracked down separately.

**It opens but has no color scheme / looks like a light theme**
The theme defaults to "Follow System". When the system is in light mode, that's the light theme; click the theme button in the status bar to switch to "Dark".

**`Port 5173 is in use`**
The previous dev process didn't exit cleanly. **Nothing needs to be done**: Vite will automatically move to 5174 and continue starting up, just with an extra line in the terminal. If you want 5173 back, close the old terminal or kill the leftover `node` / `Electron` processes and try again.

**Pasted images don't show up in the preview**
Check in order: whether the image extension is on the whitelist (`bmp`, `heic`, etc. are not supported); whether the reference path was edited by hand or the image was moved (images are fixed in `images/` at the vault root, and notes in subdirectories need the `../images/...` prefix); whether the image is still inside the vault (the preview only allows images inside the vault).

**Syncing reports "the remote has commits that aren't present locally"**
The remote is newer than the local copy, so click "Pull" first. If there are also uncommitted local changes, use "Commit Locally Only" first.

**Syncing reports "the file was modified externally; to avoid overwriting the other party's changes, this save was cancelled"**
The file was changed by another program while you were editing it. To avoid losing those changes, the app refuses to write — you can copy the content in the editor, reopen the file, and paste it back.

---

## 9. Not Implemented Yet

As planned by milestone, the following are not implemented, and there's no entry point for them in the UI:

- **Deleting / renaming files and folders**
- Full-text search
- KaTeX formulas, Shiki code highlighting
- Bidirectional links (`[[link]]`), backlinks, tags, graph view
- Packaged distribution (`.dmg` / `.exe`)

---

## 10. Tech Stack and Project Structure

Electron + React + TypeScript + Vite; CodeMirror 6 for the editor; markdown-it for rendering; isomorphic-git (built-in) / simple-git (system) for Git; electron-store for configuration; safeStorage for credentials.

```
src/
├── shared/      Shared by main/renderer: IPC contracts, domain models, themes, cross-platform utilities
├── main/        Main process: windows and security baseline, IPC routing, vault/watching/indexing, Git service
├── preload/     contextBridge allowlist bridge (no generic invoke exposed)
└── renderer/    React UI: file tree, editor, preview, Git panel, status bar
```

See [技术方案.md](../技术方案.md) (Chinese only) for architecture and decision details.

---

## 11. Contributing

Issues and PRs are welcome. Before submitting, please make sure:

1. **`npm run typecheck` passes** — both the main and renderer processes are strictly type-checked, and type errors will block a merge outright
2. **Keep changes small and focused** — one PR solves one problem, which makes review easier
3. **Write comments and UI copy in Chinese** — to stay consistent with the existing code
4. **Explain the "why" in the commit message** — the "what" is evident from the diff

### Architecture boundaries (please read before changing anything)

| Layer | Responsibility | Constraint |
|---|---|---|
| `src/main/` | Window, IPC routing, file system, Git | The only layer that holds privileges |
| `src/preload/` | contextBridge allowlist bridge | **Only concrete methods are exposed; no generic `invoke`** |
| `src/renderer/` | React UI | Runs inside the sandbox and can only reach system capabilities via `window.notes` |
| `src/shared/` | IPC contracts, domain models, themes | Shared by main/renderer, and must not pull in Node or DOM APIs |

The security baseline (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`) is a **hard constraint**; changes that relax it for development convenience will not be accepted.

### Reporting issues

In an Issue, please include: your macOS version, the app version (the `version` in `package.json`), reproduction steps, and the expected vs. actual result. For UI-related problems, adding a screenshot makes it much faster.
