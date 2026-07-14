/**
 * PlantUML built-in plugin. Editor lives in the renderer.
 */
module.exports = {
  onActivate(ctx) {
    ctx.logger.info('PlantUML plugin activated')
  },
  onDeactivate(ctx) {
    ctx.logger.info('PlantUML plugin deactivated')
  }
}
