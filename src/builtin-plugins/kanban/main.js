/**
 * Kanban built-in plugin. Editor lives in the renderer.
 */
module.exports = {
  onActivate(ctx) {
    ctx.logger.info('Kanban plugin activated')
  },
  onDeactivate(ctx) {
    ctx.logger.info('Kanban plugin deactivated')
  }
}
