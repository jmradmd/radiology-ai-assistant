// Blocking theme detection — runs before React hydrates to prevent dark-mode flash.
// Loaded via <Script src="..." strategy="beforeInteractive" /> in layout.tsx.
(function () {
  try {
    var stored = localStorage.getItem('rad-assist-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = stored || (prefersDark ? 'dark' : 'light');
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
})();
