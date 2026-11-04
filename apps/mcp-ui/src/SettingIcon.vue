<script setup lang="ts">
defineProps<{name:string}>()
const paths:Record<string,string>={
 connection:'M8 7V4m8 3V4M6 8h12v3a6 6 0 0 1-6 6v4m0-4a6 6 0 0 1-6-6V8',
 projects:'M3 8V5h7l2 3h9v12H3V8Zm0 0h9',
 members:'M15 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2m18 0v-2a4 4 0 0 0-3-3.87M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-6a3 3 0 0 1 0 6',
 groups:'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z',
 hours:'M12 8v5l3 2m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
 calendar:'M4 6h16v15H4V6Zm0 5h16M8 3v5m8-5v5',
 leave:'M8 4h10v17H8m0-9H2m3-3-3 3 3 3m7-9v12',
 completed:'m8 12 3 3 6-7M21 12a9 9 0 1 1-5-8',
 write:'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4Zm-4 9 3 3 5-6',
 general:'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6',
 import:'M14 3H5v18h14V8l-5-5Zm0 0v5h5m-7 3v7m-3-3 3 3 3-3',
 plus:'M12 5v14M5 12h14',refresh:'M20 10a8 8 0 0 0-14-5L3 8m0-5v5h5m-4 6a8 8 0 0 0 14 5l3-3m0 5v-5h-5',
 up:'m6 14 6-6 6 6',down:'m6 10 6 6 6-6',back:'m14 6-6 6 6 6',chevron:'m9 5 7 7-7 7',edit:'m15 4 5 5M4 20l5-1L21 7l-4-4L5 15l-1 5Z',check:'m5 12 4 4L19 6',search:'M20 20l-5-5m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',trash:'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',lock:'M5 10h14v11H5V10Zm3 0V7a4 4 0 0 1 8 0v3',info:'M12 11v6m0-10v1m9 4a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'
}
</script>
<template><svg class="setting-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name]??paths.general"/></svg></template>
<style scoped>.setting-icon{display:inline-block;width:20px;height:20px;flex-shrink:0;vertical-align:middle;pointer-events:none}</style>
