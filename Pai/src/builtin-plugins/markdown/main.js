/**
 * Markdown built-in plugin
 *
 * Provides Markdown format support (WYSIWYG via Milkdown in the renderer).
 * This module is intentionally minimal — format rendering is handled by the
 * renderer's Editor component based on the file extension.
 */

module.exports = {
  onActivate(ctx) {
    ctx.logger.info('Markdown plugin activated')
  },
  onDeactivate(ctx) {
    ctx.logger.info('Markdown plugin deactivated')
  }
}
