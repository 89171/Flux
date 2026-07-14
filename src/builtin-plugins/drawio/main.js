/**
 * DrawIO built-in plugin
 */

module.exports = {
  onActivate(ctx) {
    ctx.logger.info('DrawIO plugin activated')
  },
  onDeactivate(ctx) {
    ctx.logger.info('DrawIO plugin deactivated')
  }
}
