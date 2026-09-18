<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import { signOut, getCurrentUser } from 'aws-amplify/auth';
import { useRouter, useRoute } from 'vue-router';
import { currentYearMonth } from './router';
import { clearCache } from './stores/cache';
import HAppNav from './components/heeth/HAppNav.vue';
import HButton from './components/heeth/HButton.vue';

const router = useRouter();
const route = useRoute();

const isAuthenticated = ref(false);
const userEmail = ref('');

const home = computed(() => `/month/${currentYearMonth()}`);

const links = computed(() => {
  const ym = currentYearMonth();
  const year = ym.slice(0, 4);
  const monthLabel = new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
  return [
    { label: monthLabel, to: `/month/${ym}`, active: route.name === 'month' },
    { label: `Year ${year}`, to: `/year/${year}`, active: route.name === 'year' },
    { label: 'Period', to: '/period', active: route.name === 'period' },
    { label: 'Add', to: '/transaction', active: route.name === 'transaction' },
  ];
});

async function checkAuth() {
  try {
    const user = await getCurrentUser();
    isAuthenticated.value = true;
    userEmail.value = user.signInDetails?.loginId || user.username;
  } catch {
    isAuthenticated.value = false;
    userEmail.value = '';
  }
}

async function handleSignOut() {
  await signOut();
  clearCache();
  isAuthenticated.value = false;
  userEmail.value = '';
  router.push('/login');
}

onMounted(() => {
  checkAuth();
});
watch(route, () => {
  checkAuth();
});
</script>

<template>
  <div class="app">
    <HAppNav v-if="isAuthenticated && route.name !== 'login'" :home="home" :links="links">
      <template #end>
        <div class="app__account">
          <span class="app__email">{{ userEmail }}</span>
          <HButton variant="ghost" size="sm" @click="handleSignOut">Sign out</HButton>
        </div>
      </template>
    </HAppNav>

    <router-view />
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  background: var(--surface-canvas);
  color: var(--text-body);
}

.app__account { display: flex; align-items: center; gap: var(--space-4); }

.app__email {
  font-size: var(--fs-body-s);
  color: var(--text-faint);
  display: none;
}

@media (min-width: 640px) {
  .app__email { display: inline; }
}
</style>
