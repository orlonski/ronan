/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SITE_URL?: string;
  readonly VITE_APP_URL?: string;
  readonly VITE_PWA_URL?: string;
  readonly VITE_WHATSAPP?: string;
  readonly VITE_EMAIL?: string;
  readonly VITE_PLAY_URL?: string;
  readonly VITE_APPSTORE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
