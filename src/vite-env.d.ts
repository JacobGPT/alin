/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ANTHROPIC_API_KEY: string;
  readonly VITE_OPENAI_API_KEY: string;
  readonly VITE_BRAVE_API_KEY: string;
  readonly VITE_API_BASE_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_ENABLE_VOICE: string;
  readonly VITE_ENABLE_IMAGE_GEN: string;
  readonly VITE_ENABLE_TBWO: string;
  readonly VITE_ENABLE_MEMORY: string;
  readonly VITE_ENABLE_HARDWARE: string;
  readonly VITE_ENABLE_CODE_EXECUTION: string;
  readonly VITE_ENABLE_WEB_RESEARCH: string;
  readonly VITE_APP_NAME: string;
  readonly VITE_APP_VERSION: string;
  readonly VITE_MAX_FILE_SIZE: string;
  readonly VITE_MAX_MESSAGE_LENGTH: string;
  readonly VITE_DEV_MODE: string;
  readonly VITE_LOG_LEVEL: string;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
