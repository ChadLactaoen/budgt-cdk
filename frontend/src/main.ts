import { createApp } from 'vue';
import { Amplify } from 'aws-amplify';
import App from './App.vue';

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: 'us-west-2_Kzfi6ZWaA',
      userPoolClientId: '4sgvqc4skkvmntjrch9d7mlldm',
    },
  },
});

createApp(App).mount('#app');
