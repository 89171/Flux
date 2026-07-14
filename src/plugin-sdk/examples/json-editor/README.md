# JSON Editor — Sample PaiNote Plugin

Minimal end-to-end example of a **plugin-owned editor** using the iframe
+ postMessage protocol. Everything here is dependency-free — copy the
directory, tweak `manifest.json` + `renderer/index.html`, ship it.

## Layout

```
json-editor/
├── manifest.json         # id, extensions, editor.entry, permissions
├── main.js               # (optional) lifecycle hooks in the vm sandbox
└── renderer/
    └── index.html        # iframe UI + inlined postMessage client
```

## How the wiring works

1. When the user opens a `.json` file, PaiNote consults its format map,
   finds `{ kind: "plugin-editor", entryUrl: "file://…/renderer/index.html" }`,
   and mounts a `sandbox="allow-scripts"` iframe at that URL.
2. The iframe script calls `createPluginEditor(handlers)` which sends
   `ready` to the host and starts listening.
3. The host replies with `init` (content, mtime, filePath, theme,
   readonly).
4. On every edit, the plugin calls `updateContent(newContent)`. Host
   marks the buffer dirty; Cmd+S in the host triggers `saveFile()`
   which persists via the FileSystemManager (mtime-guarded).
5. When another window writes the same file, host sends
   `externalUpdate` so the plugin can refresh without losing caret.

## Installing this example locally

1. Start PaiNote, open the Plugin Market.
2. Click **Load Local Plugin** and pick this directory.
3. Create a `.json` file in your workspace — the editor mounts.

## Protocol reference

See `src/shared/types.ts` (`HostToPluginMessage`, `PluginToHostMessage`)
and `src/plugin-sdk/browser.ts` (client helper).
