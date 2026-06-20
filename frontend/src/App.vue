<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { signIn, signOut, getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';

const API_ENDPOINT = 'https://82mbbxddw0.execute-api.us-west-2.amazonaws.com/prod';

const isAuthenticated = ref(false);
const userEmail = ref('');
const email = ref('');
const password = ref('');
const error = ref('');
const apiResponse = ref('');
const loading = ref(false);

onMounted(async () => {
  try {
    const user = await getCurrentUser();
    isAuthenticated.value = true;
    userEmail.value = user.signInDetails?.loginId || user.username;
  } catch {
    isAuthenticated.value = false;
  }
});

async function handleSignIn() {
  error.value = '';
  loading.value = true;
  try {
    await signIn({ username: email.value, password: password.value });
    const user = await getCurrentUser();
    isAuthenticated.value = true;
    userEmail.value = user.signInDetails?.loginId || user.username;
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Sign in failed';
  } finally {
    loading.value = false;
  }
}

async function handleSignOut() {
  await signOut();
  isAuthenticated.value = false;
  userEmail.value = '';
  apiResponse.value = '';
}

async function callApi() {
  error.value = '';
  apiResponse.value = '';
  loading.value = true;
  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();

    const response = await fetch(`${API_ENDPOINT}/hello`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await response.json();
    apiResponse.value = JSON.stringify(data, null, 2);
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'API call failed';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="container">
    <h1>Budgt</h1>

    <div v-if="!isAuthenticated" class="login-form">
      <h2>Sign In</h2>
      <form @submit.prevent="handleSignIn">
        <div class="field">
          <label for="email">Email</label>
          <input id="email" v-model="email" type="email" required />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" v-model="password" type="password" required />
        </div>
        <button type="submit" :disabled="loading">
          {{ loading ? 'Signing in...' : 'Sign In' }}
        </button>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <div v-else class="home">
      <p>Welcome, {{ userEmail }}</p>
      <div class="actions">
        <button @click="callApi" :disabled="loading">
          {{ loading ? 'Loading...' : 'Call API' }}
        </button>
        <button @click="handleSignOut" class="secondary">Sign Out</button>
      </div>
      <pre v-if="apiResponse" class="response">{{ apiResponse }}</pre>
      <p v-if="error" class="error">{{ error }}</p>
    </div>
  </div>
</template>

<style>
* {
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  margin: 0;
  display: flex;
  justify-content: center;
  align-items: center;
}

.container {
  background: white;
  padding: 2rem;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  width: 100%;
  max-width: 400px;
}

h1 {
  margin: 0 0 1.5rem;
  text-align: center;
  color: #333;
}

h2 {
  margin: 0 0 1rem;
  font-size: 1.2rem;
  color: #555;
}

.field {
  margin-bottom: 1rem;
}

label {
  display: block;
  margin-bottom: 0.25rem;
  font-size: 0.875rem;
  color: #555;
}

input {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
}

input:focus {
  outline: none;
  border-color: #667eea;
}

button {
  width: 100%;
  padding: 0.75rem;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  cursor: pointer;
  transition: background 0.2s;
}

button:hover:not(:disabled) {
  background: #5a6fd6;
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

button.secondary {
  background: #888;
  margin-top: 0.5rem;
}

button.secondary:hover:not(:disabled) {
  background: #666;
}

.actions {
  margin-top: 1rem;
}

.error {
  color: #d32f2f;
  font-size: 0.875rem;
  margin-top: 1rem;
}

.response {
  background: #f5f5f5;
  padding: 1rem;
  border-radius: 4px;
  margin-top: 1rem;
  overflow-x: auto;
  font-size: 0.875rem;
}

.home p {
  text-align: center;
  color: #333;
}
</style>
