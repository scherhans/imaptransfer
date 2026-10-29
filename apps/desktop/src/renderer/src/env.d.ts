/// <reference types="vite/client" />
import type { ImaptransferApi } from '../../shared/api';

declare global {
  interface Window {
    imaptransfer: ImaptransferApi;
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
