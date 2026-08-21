declare const __BACKEND_BASE_URL__: string;
declare const __PLUGIN_VERSION__: string;
declare const __ENABLE_PUBLIC_SHEET_TEST_MODE__: boolean;

export const pluginConfig = {
  backendBaseUrl:
    typeof __BACKEND_BASE_URL__ === 'string'
      ? __BACKEND_BASE_URL__
      : 'https://ux-copy-sync.example.com',
  pluginVersion: typeof __PLUGIN_VERSION__ === 'string' ? __PLUGIN_VERSION__ : 'test',
  enablePublicTestMode:
    typeof __ENABLE_PUBLIC_SHEET_TEST_MODE__ === 'boolean'
      ? __ENABLE_PUBLIC_SHEET_TEST_MODE__
      : true,
};

export const APP_SESSION_KEY = 'ux-copy-sync.app-session';
