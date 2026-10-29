import { createApp } from 'vue';
import App from './App.vue';
import { i18n } from './i18n';
import { initialize } from './store';
import './styles.css';

// The settings decide the language, so they are read before the window shows any text.
void initialize().finally(() => createApp(App).use(i18n).mount('#app'));
