/**
 * Plain Text built-in plugin
 */

module.exports = {
  onActivate(ctx) {
    ctx.logger.info('Plain Text plugin activated')
  },
  onDeactivate(ctx) {
    ctx.logger.info('Plain Text plugin deactivated')
  }
}
