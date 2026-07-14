/**
 * Mermaid built-in plugin. Editor lives in the renderer.
 */
module.exports = {
  onActivate(ctx) {
    ctx.logger.info('Mermaid plugin activated')
  },
  onDeactivate(ctx) {
    ctx.logger.info('Mermaid plugin deactivated')
  }
}
