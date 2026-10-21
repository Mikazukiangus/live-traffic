// Run synchronously before first paint. Only known preference values reach DOM attributes.
try {
  var theme = localStorage.getItem('trafficpulse.theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  if (localStorage.getItem('trafficpulse.textSize') === 'large') document.documentElement.dataset.text = 'large';
} catch (error) {
  // Storage may be disabled; device/default preferences remain usable.
}
