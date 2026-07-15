/**
 * PlantUML built-in plugin. Editor lives in the renderer.
 * Includes an AI adapter for generating PlantUML diagrams.
 */

module.exports = {
  onActivate(ctx) {
    ctx.logger.info('PlantUML plugin activated')
  },
  onDeactivate(ctx) {
    ctx.logger.info('PlantUML plugin deactivated')
  },
  format: {
    format: 'plantuml',
    aiAdapter: {
      systemPrompt: 'You are an expert at creating PlantUML diagrams. Generate valid PlantUML syntax wrapped between @startuml and @enduml tags. Support sequence diagrams, class diagrams, use case diagrams, activity diagrams, component diagrams, and state diagrams. Use proper syntax for participants, messages, classes, interfaces, and relationships. Only output the PlantUML code, no explanations.\n\nExample:\n@startuml\nstart\n:User submits form;\nif (Valid?) then (yes)\n  :Save to database;\nelse (no)\n  :Show errors;\nendif\nstop\n@enduml',
      parseResponse: (response) => {
        let content = response.trim()
        // Remove wrapping ```plantuml ... ``` if present
        const fenceMatch = content.match(/^```(?:plantuml)?\n([\s\S]*?)\n```$/)
        if (fenceMatch) {
          content = fenceMatch[1].trim()
        }
        // Ensure @startuml ... @enduml wrapping
        if (!content.startsWith('@startuml')) {
          content = '@startuml\n' + content
        }
        if (!content.endsWith('@enduml')) {
          content = content + '\n@enduml'
        }
        return content
      },
      formatContext: (content) => {
        return `Current PlantUML diagram:\n\n${content}\n\n---\nPlease modify or improve the above diagram.`
      },
      suggestedPrompts: [
        'Create a sequence diagram for user authentication',
        'Create a class diagram for an e-commerce system',
        'Create an activity diagram for order processing',
        'Create a component diagram for microservices'
      ],
      validateResponse: (response) => {
        const trimmed = response.trim()
        if (!trimmed) return 'AI response is empty'
        if (!trimmed.includes('@startuml') || !trimmed.includes('@enduml')) {
          return 'PlantUML must include @startuml and @enduml tags'
        }
        return null
      }
    }
  }
}
