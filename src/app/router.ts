import { createRouter, createWebHashHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/poc/gantt',
    },
    {
      path: '/poc/gantt',
      name: 'poc-gantt',
      component: () => import('@/poc/PocGantt.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/pages/SettingsPage.vue'),
    },
  ],
});
