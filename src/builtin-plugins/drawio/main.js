/**
 * Draw.io built-in plugin. Editor lives in the renderer.
 * Includes an AI adapter for generating draw.io XML diagrams.
 */

/**
 * A draw.io file is XML, so every attribute value must be valid XML — but
 * models routinely emit raw HTML inside `value="…"` (e.g. `<br>`, or a bare
 * `&`), which makes the file unparseable ("Unescaped '<' not allowed in
 * attributes values"). Escape stray `<`, `>` and `&` inside double-quoted
 * attribute values. Internal quotes are already written as &quot;, so a value
 * never contains a raw " and [^"]* captures it whole.
 */
function sanitizeXmlAttributes(xml) {
  return xml.replace(/=\s*"([^"]*)"/g, (_full, val) => {
    const fixed = val
      .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    return `="${fixed}"`
  })
}

module.exports = {
  onActivate(ctx) {
    ctx.logger.info('Draw.io plugin activated')
  },
  onDeactivate(ctx) {
    ctx.logger.info('Draw.io plugin deactivated')
  },
  format: {
    format: 'drawio',
    aiAdapter: {
      systemPrompt: 'You are an expert at creating draw.io diagrams. Generate valid mxfile XML with mxGraphModel and mxCell elements. Use proper styles for shapes (rectangles, ellipses, rhombus), edges with labels, and proper geometry (x, y, width, height). Include vertex cells (vertex="1") and edge cells (edge="1") with source/target references. CRITICAL: a .drawio file is XML, so every attribute value must be valid XML — escape special characters: use &lt; for <, &gt; for >, &amp; for &, and &quot; for ". For a line break inside a cell label write &lt;br&gt; (NEVER a raw <br>). Only output the XML, no explanations.',
      parseResponse: (response) => {
        let content = response.trim()
        // Remove wrapping ```xml ... ``` if present
        const fenceMatch = content.match(/^```(?:xml)?\n([\s\S]*?)\n```$/)
        if (fenceMatch) {
          content = fenceMatch[1].trim()
        }
        // Repair unescaped HTML/special chars inside attribute values so the
        // generated XML always parses, even if the model forgot to escape.
        content = sanitizeXmlAttributes(content)
        return content
      },
      formatContext: (content) => {
        return `Current draw.io diagram XML:\n\n${content}\n\n---\nPlease modify or improve the above diagram.`
      },
      suggestedPrompts: [
        'Create a flowchart with 5 steps',
        'Create an organizational chart',
        'Create a network topology diagram',
        'Create a decision tree'
      ],
      validateResponse: (response) => {
        const trimmed = response.trim()
        if (!trimmed) return 'AI response is empty'
        if (!trimmed.includes('<mxfile') && !trimmed.includes('<mxGraphModel')) {
          return 'Response must contain valid draw.io XML (mxfile or mxGraphModel)'
        }
        return null
      }
    }
  }
}
