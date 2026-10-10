<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
</script>

<template>
  <div class="app">
    <nav class="app__nav">
      <span class="app__brand">TeamSight</span>
      <RouterLink class="app__link" to="/poc/gantt">排期验证</RouterLink>
      <RouterLink class="app__link" to="/settings">设置</RouterLink>
    </nav>
    <main class="app__main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.app__nav {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: 0 0 auto;
  padding: 8px 16px;
  border-bottom: 1px solid var(--ts-color-border);
  background: var(--ts-color-surface);
}

.app__brand {
  font-weight: 600;
}

.app__link {
  color: var(--ts-color-text-muted);
  text-decoration: none;
}

.app__link.router-link-active {
  color: #1d4ed8;
  font-weight: 600;
}

.app__main {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
