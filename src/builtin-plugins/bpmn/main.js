/**
 * BPMN built-in plugin. Editor lives in the renderer.
 */
module.exports = {
  onActivate(ctx) {
    ctx.logger.info('BPMN plugin activated')
  },
  onDeactivate(ctx) {
    ctx.logger.info('BPMN plugin deactivated')
  }
}
