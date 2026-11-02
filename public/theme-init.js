// Applies the saved theme before first paint to avoid a light/dark flash.
;(function () {
  var pref = 'system'
  try {
    pref = localStorage.getItem('td-theme') || 'system'
  } catch (e) {}
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
})()
