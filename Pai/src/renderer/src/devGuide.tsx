/**
 * PaiNote Plugin Development Guide
 *
 * A static read-only page displayed in a separate window.
 * Renders the guide content as formatted HTML.
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import { marked } from 'marked'
import './styles/global.css'
import './styles/components.css'

const guideMarkdown = `
# PaiNote Plugin Development Guide

## Overview

PaiNote supports a plugin system that allows you to extend the app with custom formats, tools, and themes. This guide covers everything you need to know to build your own plugins.

## Plugin Structure

\`\`\`
my-plugin/
  ├── manifest.json    # Plugin metadata
  ├── main.js          # Entry point
  └── icon.png         # (Optional) Plugin icon
\`\`\`

## manifest.json

\`\`\`json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "author": "Your Name",
  "description": "A description of what your plugin does.",
  "type": "format",
  "extensions": ["myext"],
  "main": "main.js",
  "minAppVersion": "1.0.0"
}
\`\`\`

### Fields

- **id** (required): Unique identifier for your plugin.
- **name** (required): Display name.
- **version** (required): Semantic version string.
- **author** (required): Author name.
- **description** (required): Short description.
- **type** (required): One of \`format\`, \`tool\`, or \`theme\`.
- **extensions**: File extensions this plugin handles (for format plugins).
- **main** (required): Entry point JavaScript file.
- **icon**: Path to an icon image (PNG, 24x24 recommended).
- **minAppVersion**: Minimum PaiNote version required.

## Plugin Types

### Format Plugins

Format plugins handle custom file types. When a user opens a file with a registered extension, PaiNote loads your plugin to render and edit the content.

### Tool Plugins

Tool plugins add new tools or features to PaiNote. They can add menu items, toolbar buttons, or background functionality.

### Theme Plugins

Theme plugins provide custom visual themes for PaiNote.

## Plugin Lifecycle

\`\`\`javascript
module.exports = {
  onLoad(ctx) {
    // Called when the plugin is loaded
    console.log('Plugin loaded:', ctx.pluginId)
  },
  onActivate(ctx) {
    // Called when the plugin is activated
    console.log('Plugin activated')
  },
  onDeactivate(ctx) {
    // Called when the plugin is deactivated
    console.log('Plugin deactivated')
  },
  onUnload() {
    // Called when the plugin is unloaded
    console.log('Plugin unloaded')
  }
}
\`\`\`

## Plugin Context

The \`ctx\` object provides access to PaiNote APIs:

\`\`\`javascript
module.exports = {
  onActivate(ctx) {
    // Access file system
    ctx.fs.readFile('path/to/file')

    // Access settings
    ctx.settings.get()

    // Emit events
    ctx.emit('custom-event', { data: 'value' })
  }
}
\`\`\`

## Installation

### From Directory

1. Create a plugin directory with the structure above.
2. In PaiNote, open Plugin Market.
3. Paste the directory path in the input field and click "Load".

### From File

1. Package your plugin directory as a ZIP file.
2. In PaiNote, open Plugin Market.
3. Click "Install Plugin" and select the ZIP file.

## Testing

During development, you can load your plugin from a local directory. Changes to the plugin code require deactivating and reactivating the plugin.

## Best Practices

- Keep your plugin lightweight and focused on a single feature.
- Handle errors gracefully and provide user feedback.
- Test with different file sizes and edge cases.
- Document your plugin's features and configuration options.
- Follow semantic versioning for releases.

## Example: Simple Format Plugin

\`\`\`javascript
// manifest.json
{
  "id": "csv-viewer",
  "name": "CSV Viewer",
  "version": "1.0.0",
  "author": "PaiNote",
  "description": "Render CSV files as tables",
  "type": "format",
  "extensions": ["csv"],
  "main": "main.js"
}

// main.js
module.exports = {
  onActivate(ctx) {
    console.log('CSV Viewer activated')
  },
  render(content) {
    const rows = content.split('\\n').map(row => row.split(','))
    const table = rows.map(row =>
      '<tr>' + row.map(cell => '<td>' + cell + '</td>').join('') + '</tr>'
    ).join('')
    return '<table>' + table + '</table>'
  }
}
\`\`\`
`

function DevGuideApp() {
  const html = marked.parse(guideMarkdown) as string

  return (
    <div
      style={{
        height: '100vh',
        overflow: 'auto',
        padding: '32px 48px',
        maxWidth: '800px',
        margin: '0 auto',
        fontFamily: 'var(--font-sans)',
        fontSize: '15px',
        lineHeight: 1.7,
        color: 'var(--text-primary)',
      }}
      className="markdown-preview"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DevGuideApp />
  </React.StrictMode>
)
