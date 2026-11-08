// Applies the last board style before the workspace loads, so the page doesn't flash the default colors.
// A separate file (not inline) so the desktop app's Content-Security-Policy allows it.
// StylePicker keeps these localStorage keys in sync with workspace.appearance.
try {
  var data = document.documentElement.dataset
  var read = function (key, options) { var value = localStorage.getItem(key); return options.indexOf(value) > -1 ? value : null }
  var palette = read('unfold-palette', ['lavender', 'rose', 'sage'])
  var pattern = read('unfold-canvas-pattern', ['dots', 'grid', 'lined', 'gingham', 'plain'])
  var tone = read('unfold-canvas-tone', ['cream', 'white', 'linen', 'tint'])
  if (palette) data.palette = palette
  if (pattern) data.pattern = pattern
  if (tone) data.canvasTone = tone
} catch (error) { /* Storage unavailable: StylePicker applies the style once the workspace loads. */ }
