// The name the app shows. Electron's app name stays "Paseo" because the userData folder is
// derived from it, and renaming it would strand every existing install's settings.
export const APP_DISPLAY_NAME = process.env.PASEO_TEST_APP_NAME?.trim() || "TePaseo";
