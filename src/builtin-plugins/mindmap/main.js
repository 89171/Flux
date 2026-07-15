/**
 * Mindmap built-in plugin. Editor lives in the renderer.
 * Includes an AI adapter for generating mind maps.
 */

module.exports = {
  onActivate(ctx) {
    ctx.logger.info('Mindmap plugin activated')
  },
  onDeactivate(ctx) {
    ctx.logger.info('Mindmap plugin deactivated')
  },
  format: {
    format: 'mindmap',
    aiAdapter: {
      systemPrompt: 'You are a helpful assistant that generates mind maps using Markdown headings. Use # for the central topic, ## for main branches, and ### for sub-branches. Keep each heading concise (3-5 words). Generate a well-structured hierarchy with 3-5 main branches and 2-3 sub-branches each. Only output the Markdown headings, no explanations.',
      parseResponse: (response) => {
        // Extract only heading lines
        const lines = response.split('\n')
        const headings = lines.filter(l => /^#{1,6}\s/.test(l))
        return headings.join('\n')
      },
      formatContext: (content) => {
        return `Current mind map:\n\n${content}\n\n---\nPlease modify or expand the above mind map.`
      },
      suggestedPrompts: [
        'Create a mind map for project planning',
        'Create a mind map for learning a new technology',
        'Expand the current mind map with more detail',
        'Reorganize the mind map structure'
      ],
      validateResponse: (response) => {
        const lines = response.split('\n').filter(l => /^#{1,6}\s/.test(l))
        if (lines.length === 0) {
          return 'Response must contain at least one Markdown heading'
        }
        return null
      }
    }
  }
}
