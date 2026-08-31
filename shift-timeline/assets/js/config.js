/* ============================================================
   Shift Roster — configuration
   ------------------------------------------------------------
   Set API_URL to the /exec URL of your deployed Google Apps
   Script web app. Leave it empty to run in LOCAL mode, where
   the whole roster lives in this browser's localStorage and
   nothing is published. Build and test locally first, then
   paste the URL here to go live.
   ============================================================ */

window.ROSTER_CONFIG = {

  // Paste your Apps Script deployment URL here, e.g.
  // "https://script.google.com/macros/s/AKfycb.../exec"
  // Empty string  ->  local mode (localStorage only).
  API_URL: "https://script.google.com/macros/s/AKfycbwFWHLKa8PvDFoDYNufzPMdTdht8qMUfTyoy5EcAfgeCnyDKvwrFLVUdKYcVGhr9fN0/exec",

  // Shown in the header and on exports.
  ORG_NAME: "Security Operations Centre",
  TEAM_NAME: "SOC L1",

  // Password for the "Sign in" button in LOCAL mode only (API_URL empty).
  // Once API_URL is set, the real password lives in the Google Sheet's
  // Settings tab and this value is ignored.
  EDIT_PASSWORD: "admin",

  // Minimum Off days every engineer should get in a calendar month.
  // The generator tops up to this; the validator flags anyone below it.
  MIN_OFF_PER_MONTH: 8,

  // Longest run of work days before an Off is mandatory. A 4th
  // consecutive work day is a hard conflict.
  MAX_CONSECUTIVE_WORK: 3,

  // How long an unlocked edit session lasts, in hours. After this the
  // builder asks for the edit password again.
  EDIT_TOKEN_HOURS: 12
};
