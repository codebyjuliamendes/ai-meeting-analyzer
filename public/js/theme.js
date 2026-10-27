// Applies the saved theme before first paint to avoid a flash of the wrong theme.
(function () {
  var theme;
  try {
    theme = window.localStorage.getItem('nexusmeet-theme');
  } catch {
    theme = null;
  }
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  }
})();
