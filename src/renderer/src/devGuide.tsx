/**
 * Flux Plugin Development Guide
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
# Flux Plugin Development Guide

## Overview

Flux supports a plugin system that allows you to extend the app with custom formats, tools, and themes. This guide covers everything you need to know to build your own plugins.

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
- **minAppVersion**: Minimum Flux version required.

## Plugin Types

### Format Plugins

Format plugins handle custom file types. When a user opens a file with a registered extension, Flux loads your plugin to render and edit the content.

### Tool Plugins

Tool plugins add new tools or features to Flux. They can add menu items, toolbar buttons, or background functionality.

### Theme Plugins

Theme plugins provide custom visual themes for Flux.

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

The \`ctx\` object provides access to Flux APIs:

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
2. In Flux, open Plugin Market.
3. Paste the directory path in the input field and click "Load".

### From File

1. Package your plugin directory as a ZIP file.
2. In Flux, open Plugin Market.
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
  "author": "Flux",
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

## AI Integration

Flux provides a built-in AI assistant that can generate and transform content for any format. Plugins can customize how AI interacts with their format by providing an **AI Format Adapter**.

### AIFormatAdapter Interface

\`\`\`typescript
interface AIFormatAdapter {
  /** System prompt that instructs the AI how to generate content for this format */
  systemPrompt: string
  /** Post-process the AI's raw response (e.g. strip markdown fences, validate XML) */
  parseResponse: (response: string) => string
  /** Format the current document content before sending to AI as context */
  formatContext?: (content: string) => string
  /** Suggested prompts shown in the AI panel when this format is active */
  suggestedPrompts?: string[]
  /** Validate AI-generated content before applying. Returns error message or null if valid */
  validateResponse?: (response: string) => string | null
}
\`\`\`

### How It Works

1. When the user opens the AI panel and sends a prompt, Flux checks if the current file's format plugin provides an \`aiAdapter\`.
2. If found, the adapter's \`systemPrompt\` replaces the default system prompt.
3. If \`formatContext\` is provided, it wraps the current document content before sending to the AI.
4. The AI's response is passed through \`parseResponse\` for cleanup (e.g. stripping code fences).
5. If \`validateResponse\` is provided, the response is validated before being applied.
6. \`suggestedPrompts\` are shown as quick-action buttons in the AI panel.

### Example: Plugin with AI Adapter

\`\`\`javascript
// main.js
module.exports = {
  onActivate(ctx) {
    ctx.logger.info('My format plugin activated')
  },
  format: {
    format: 'myformat',
    aiAdapter: {
      systemPrompt: 'You are an expert at generating MyFormat content. Follow the syntax rules: ...',
      parseResponse: (response) => {
        // Clean up the AI response
        let content = response.trim()
        // Remove wrapping code fences if present
        const match = content.match(/^\`\`\`(?:myformat)?\\n([\\s\\S]*?)\\n\`\`\`$/)
        if (match) content = match[1]
        return content
      },
      formatContext: (content) => {
        return \`Current document:\\n\${content}\\n\\n---\\nPlease modify the above.\`
      },
      suggestedPrompts: [
        'Create a new document from scratch',
        'Add examples to each section',
        'Convert to JSON'
      ],
      validateResponse: (response) => {
        if (!response.includes('required-keyword')) {
          return 'Response must contain required-keyword'
        }
        return null
      }
    }
  }
}
\`\`\`

### Supported AI Providers

Flux supports the following AI providers (configurable in Settings):

| Provider | Models | Base URL |
|---|---|---|
| OpenAI | gpt-4o, gpt-4o-mini, etc. | https://api.openai.com/v1 |
| DeepSeek | deepseek-chat, deepseek-reasoner | https://api.deepseek.com/v1 |
| Anthropic Claude | claude-sonnet-4-20250514, etc. | https://api.anthropic.com |
| Local | Ollama, LM Studio | http://localhost:11434/v1 |

DeepSeek and OpenAI use the same API format (OpenAI-compatible), so any model that supports the OpenAI chat completions API will work.

### Best Practices for AI Adapters

1. **Be specific in system prompts**: Tell the AI exactly what syntax to use, include examples.
2. **Always clean up responses**: AI models often wrap output in code fences — use \`parseResponse\` to strip them.
3. **Validate critical formats**: Use \`validateResponse\` to catch obviously broken output before it reaches the editor.
4. **Provide helpful suggested prompts**: Guide users toward capabilities they might not discover.
5. **Format context clearly**: When sending existing content to AI, wrap it with clear markers so the AI knows what to operate on.
6. **Keep system prompts concise**: Very long prompts increase cost and latency. Focus on syntax rules and output format.

### AI Response Flow

\`\`\`
User sends prompt
    ↓
Flux checks for format plugin's aiAdapter
    ↓
Builds system prompt (adapter.systemPrompt or default)
    ↓
Formats context (adapter.formatContext or raw content)
    ↓
Sends to AI provider (OpenAI/DeepSeek/Anthropic/Local)
    ↓
Receives response
    ↓
Parses response (adapter.parseResponse)
    ↓
Validates response (adapter.validateResponse)
    ↓
Displays in AI panel → User can "Replace" or "Append" to note
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
