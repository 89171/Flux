/**
 * Markdown built-in plugin
 *
 * Provides Markdown format support (WYSIWYG via Milkdown in the renderer).
 * Includes an AI adapter for intelligent Markdown generation and editing.
 */

module.exports = {
  onActivate(ctx) {
    ctx.logger.info('Markdown plugin activated')
  },
  onDeactivate(ctx) {
    ctx.logger.info('Markdown plugin deactivated')
  },
  format: {
    format: 'markdown',
    aiAdapter: {
      systemPrompt: 'You are an expert Markdown assistant. You can create, edit, summarize, and transform Markdown documents. Generate well-structured content with headings, lists, tables, code blocks, and blockquotes. When the user provides existing content, improve or transform it based on their request. Always respond with valid Markdown only, no explanations outside the content.',
      parseResponse: (response) => {
        // Strip leading/trailing whitespace and remove any wrapping code fences
        let content = response.trim()
        // Remove wrapping ```markdown ... ``` if present
        const fenceMatch = content.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/)
        if (fenceMatch) {
          content = fenceMatch[1]
        }
        return content
      },
      formatContext: (content) => {
        return `Current document content:\n\n${content}\n\n---\nPlease operate on the above document.`
      },
      suggestedPrompts: [
        'Summarize this document',
        'Improve the writing and fix grammar',
        'Add more detail to each section',
        'Convert to a table of contents',
        'Translate to Chinese'
      ],
      validateResponse: (response) => {
        if (!response || response.trim().length === 0) {
          return 'AI response is empty'
        }
        return null
      }
    }
  }
}
