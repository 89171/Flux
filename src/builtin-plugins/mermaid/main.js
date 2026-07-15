/**
 * Mermaid built-in plugin. Editor lives in the renderer.
 * Includes an AI adapter for generating Mermaid diagrams.
 */

module.exports = {
  onActivate(ctx) {
    ctx.logger.info('Mermaid plugin activated')
  },
  onDeactivate(ctx) {
    ctx.logger.info('Mermaid plugin deactivated')
  },
  format: {
    format: 'mermaid',
    aiAdapter: {
      systemPrompt: 'You are an expert at creating Mermaid diagrams. Generate valid Mermaid syntax only — no explanations, no markdown fences. Support flowcharts (flowchart TD/LR), sequence diagrams, class diagrams, state diagrams, ER diagrams, Gantt charts, and pie charts. Use proper node shapes ([], {}, (), >), arrow types (-->, -.->, ==>), and labels. Keep diagrams clean and readable.\n\nExample flowchart:\nflowchart TD\n    A[Start] --> B{Decision}\n    B -->|Yes| C[Action 1]\n    B -->|No| D[Action 2]\n    C --> E[End]\n    D --> E',
      parseResponse: (response) => {
        let content = response.trim()
        // Remove wrapping ```mermaid ... ``` if present
        const fenceMatch = content.match(/^```(?:mermaid)?\n([\s\S]*?)\n```$/)
        if (fenceMatch) {
          content = fenceMatch[1].trim()
        }
        return content
      },
      formatContext: (content) => {
        return `Current Mermaid diagram:\n\n${content}\n\n---\nPlease modify or improve the above diagram.`
      },
      suggestedPrompts: [
        'Create a flowchart for user login',
        'Create a sequence diagram for API request/response',
        'Create a class diagram for a blog system',
        'Create a state diagram for order processing'
      ],
      validateResponse: (response) => {
        const trimmed = response.trim()
        if (!trimmed) return 'AI response is empty'
        // Basic check: should start with a diagram type or graph
        const validTypes = /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|gitGraph|mindmap)\b/m
        if (!validTypes.test(trimmed)) {
          return 'Response does not appear to be valid Mermaid syntax'
        }
        return null
      }
    }
  }
}
