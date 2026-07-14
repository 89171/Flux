/**
 * Mindmap built-in plugin
 */

module.exports = {
  onActivate(ctx) {
    ctx.logger.info('Mindmap plugin activated')
  },
  onDeactivate(ctx) {
    ctx.logger.info('Mindmap plugin deactivated')
  }
}
