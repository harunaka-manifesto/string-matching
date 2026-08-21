declare const __BACKEND_BASE_URL__: string;
declare const __PLUGIN_VERSION__: string;
declare const __ENABLE_PUBLIC_SHEET_TEST_MODE__: boolean;

export const pluginConfig = {
  backendBaseUrl: __BACKEND_BASE_URL__,
  pluginVersion: __PLUGIN_VERSION__,
  enablePublicTestMode: __ENABLE_PUBLIC_SHEET_TEST_MODE__,
};

export const APP_SESSION_KEY = 'ux-copy-sync.app-session';
