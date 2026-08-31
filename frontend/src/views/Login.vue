<script setup lang="ts">
import { ref } from 'vue';
import { signIn, confirmSignIn } from 'aws-amplify/auth';
import { useRouter } from 'vue-router';
import HButton from '../components/heeth/HButton.vue';
import HCallout from '../components/heeth/HCallout.vue';
import HInput from '../components/heeth/HInput.vue';

const router = useRouter();

const email = ref('');
const password = ref('');
const newPassword = ref('');
const error = ref('');
const loading = ref(false);

/**
 * Users are created by an admin, so a first sign-in lands on Cognito's
 * NEW_PASSWORD_REQUIRED challenge unless the password was set with --permanent.
 */
const needsNewPassword = ref(false);

async function handleSignIn() {
  error.value = '';
  loading.value = true;
  try {
    const { isSignedIn, nextStep } = await signIn({
      username: email.value,
      password: password.value,
    });
    await afterStep(isSignedIn, nextStep.signInStep);
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Sign in failed.';
  } finally {
    loading.value = false;
  }
}

async function handleNewPassword() {
  error.value = '';
  loading.value = true;
  try {
    const { isSignedIn, nextStep } = await confirmSignIn({ challengeResponse: newPassword.value });
    await afterStep(isSignedIn, nextStep.signInStep);
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Could not set the new password.';
  } finally {
    loading.value = false;
  }
}

/**
 * `signIn` resolving does NOT mean the user is signed in — an unmet challenge resolves
 * normally with `isSignedIn: false`. Navigating on that alone bounces off the router
 * guard and silently returns here, so every step is handled or surfaced.
 */
async function afterStep(isSignedIn: boolean, step: string) {
  if (isSignedIn) {
    await router.push('/');
    return;
  }
  if (step === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
    needsNewPassword.value = true;
    return;
  }
  error.value = `Additional sign-in step required: ${step}`;
}
</script>

<template>
  <div class="login">
    <div class="login__card">
      <span class="login__wordmark">Budgt</span>

      <template v-if="!needsNewPassword">
        <h1 class="login__title">Sign in</h1>
        <form class="login__form" @submit.prevent="handleSignIn">
          <HInput id="email" v-model="email" label="Email" type="email" placeholder="you@example.com" />
          <HInput id="password" v-model="password" label="Password" type="password" />
          <HButton type="submit" block :disabled="loading">
            {{ loading ? 'Signing in' : 'Sign in' }}
          </HButton>
        </form>
      </template>

      <template v-else>
        <h1 class="login__title">Choose a password</h1>
        <p class="login__hint">
          This account was created with a temporary password. Set a permanent one to continue.
        </p>
        <form class="login__form" @submit.prevent="handleNewPassword">
          <HInput
            id="new-password"
            v-model="newPassword"
            label="New password"
            type="password"
            hint="At least 8 characters, with upper, lower and a digit."
          />
          <HButton type="submit" block :disabled="loading">
            {{ loading ? 'Saving' : 'Set password' }}
          </HButton>
        </form>
      </template>

      <HCallout v-if="error" tone="over" title="That did not work">{{ error }}</HCallout>
    </div>
  </div>
</template>

<style scoped>
.login {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--gutter);
  background: var(--surface-canvas);
}

.login__card {
  width: 100%;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding: var(--space-7);
  background: var(--surface-card);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
  box-shadow: var(--shadow-3);
}

.login__wordmark {
  font-family: var(--font-display);
  font-size: var(--fs-display-s);
  text-transform: uppercase;
  letter-spacing: var(--ls-label);
  color: var(--lime-500);
}

.login__title {
  font-family: var(--font-display);
  font-size: var(--fs-title);
  text-transform: uppercase;
  color: var(--text-strong);
}

.login__hint { font-size: var(--fs-body-s); color: var(--text-faint); }

.login__form { display: flex; flex-direction: column; gap: var(--space-5); }
</style>
