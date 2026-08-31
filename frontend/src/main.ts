import { createApp } from 'vue';
import { Amplify } from 'aws-amplify';
import App from './App.vue';
import router from './router';
import { loadConfig } from './config';
import './style.css';

async function bootstrap() {
  const config = await loadConfig();
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: config.userPoolId,
        userPoolClientId: config.userPoolClientId,
      },
    },
  });
  createApp(App).use(router).mount('#app');
}

bootstrap().catch((e) => {
  const message = e instanceof Error ? e.message : 'Failed to start';
  document.getElementById('app')!.innerHTML =
    `<div class="min-h-screen flex items-center justify-center p-4">
       <div class="alert alert-error max-w-md">${message}</div>
     </div>`;
});
