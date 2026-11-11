// Preserve board QR codes, invitations and other app links issued before /app.
(() => {
  const legacyAppRoute = /^#(?:home|dashboard|play|practice|lobby|training|clubs|mymatches|events|leagues|hall|operations|baan|baan-screen|baan-phone|venue|venue-cast|manage|mail|friends|community|reports|camera|match|spectator|overlay|tournaments|players|registrations|pools|knockout|matches|rankings|statistics|settings)(?:[/?]|$)/;
  function redirectLegacyAppRoute() {
    if (legacyAppRoute.test(location.hash)) location.replace('/app' + location.search + location.hash);
  }
  redirectLegacyAppRoute();
  window.addEventListener('hashchange', redirectLegacyAppRoute);
})();
