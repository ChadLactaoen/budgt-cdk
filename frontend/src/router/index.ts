import { createRouter, createWebHistory } from 'vue-router';
import { getCurrentUser } from 'aws-amplify/auth';

/**
 * The current month is resolved from the BROWSER's clock, never server-side: Lambda
 * runs in UTC, so for a Pacific-time user on August 31st at 6pm a server-side
 * "current month" would return September.
 */
export function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/Login.vue'),
      meta: { requiresGuest: true },
    },
    {
      path: '/',
      name: 'home',
      redirect: () => ({ name: 'month', params: { yearMonth: currentYearMonth() } }),
    },
    {
      path: '/month/:yearMonth',
      name: 'month',
      component: () => import('../views/MonthView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/year/:year',
      name: 'year',
      component: () => import('../views/YearView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/period',
      name: 'period',
      component: () => import('../views/PeriodForm.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/transaction',
      name: 'transaction',
      component: () => import('../views/TransactionForm.vue'),
      meta: { requiresAuth: true },
    },
  ],
});

router.beforeEach(async (to) => {
  let isAuthenticated = false;
  try {
    await getCurrentUser();
    isAuthenticated = true;
  } catch {
    isAuthenticated = false;
  }

  if (to.meta.requiresAuth && !isAuthenticated) return { name: 'login' };
  if (to.meta.requiresGuest && isAuthenticated) return { name: 'home' };
  return true;
});

export default router;
