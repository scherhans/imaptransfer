import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'electron-vite';

// Bundling drops the license files of the packages it takes in, and their licenses ask to travel
// with every copy. Each bundle therefore writes the licenses of what it contains next to itself;
// electron-builder.yml puts them into the app's resources, beside Electron's and Chromium's own.
const license = { fileName: 'licenses.md' };

export default defineConfig({
  main: {
    // Everything is bundled, so the packaged app ships no node_modules folder.
    build: { externalizeDeps: false, license },
    define: {
      __MICROSOFT_CLIENT_ID__: JSON.stringify(process.env.IMAPTRANSFER_MICROSOFT_CLIENT_ID ?? ''),
    },
  },
  preload: {
    // Sandboxed preload scripts must be CommonJS.
    build: { externalizeDeps: false, rolldownOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    build: { license },
    // <selectedcontent> belongs to the browser: it shows the chosen option inside a select.
    plugins: [vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === 'selectedcontent' } } })],
    define: {
      __VUE_I18N_FULL_INSTALL__: true,
      __VUE_I18N_LEGACY_API__: false,
      __INTLIFY_PROD_DEVTOOLS__: false,
    },
  },
});
