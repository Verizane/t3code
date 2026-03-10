/// <reference types="vite/client" />

import type { NativeApi, DesktopBridge } from "@t3tools/contracts";

interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string;
  readonly VITE_WS_URL?: string;
}

declare global {
  interface Window {
    nativeApi?: NativeApi;
    desktopBridge?: DesktopBridge;
  }
}
