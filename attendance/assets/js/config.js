/* ============================================================
   Shift Desk — configuration
   ------------------------------------------------------------
   Set API_URL to the /exec URL of your deployed Google Apps
   Script web app. Leave it empty to run in demo mode, where
   everything lives in the browser and nothing is saved to the
   spreadsheet.
   ============================================================ */

window.SHIFTDESK_CONFIG = {

  // Paste your Apps Script deployment URL here, e.g.
  // "https://script.google.com/macros/s/AKfycb.../exec"
  API_URL: "",

  // Shown on the login screen and in exports.
  ORG_NAME: "Security Operations Centre",

  // Session length in hours. Must match SESSION_HOURS in Code.gs.
  SESSION_HOURS: 8,

  // Longest a photo edge may be before upload, in pixels, and
  // JPEG quality. Keeps Drive usage and payloads small.
  PHOTO_MAX_EDGE: 640,
  PHOTO_QUALITY: 0.72,

  // Require a desk photo to sign on.
  REQUIRE_PHOTO: true,

  // Minutes after scheduled start before an absent engineer is
  // counted as a no-show on the board.
  NO_SHOW_AFTER: 60
};
