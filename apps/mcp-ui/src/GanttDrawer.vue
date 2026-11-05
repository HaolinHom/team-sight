<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useVisibleViewport } from './visible-viewport'
defineProps<{ title: string }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>(), closeButton = ref<HTMLButtonElement>()
const viewport = useVisibleViewport()
const previousFocus = document.activeElement as HTMLElement | SVGElement | null
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const elements = Array.from(dialog.value!.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],[tabindex="0"]'))
  const first = elements[0], last = elements.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
function backdrop(event: MouseEvent) {
  if (event.target !== dialog.value) return
  const rect = dialog.value!.getBoundingClientRect()
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) emit('close')
}
onMounted(() => { dialog.value!.showModal(); closeButton.value?.focus({ preventScroll: true }) })
onUnmounted(() => {
  if (previousFocus?.isConnected && previousFocus.getAttribute('tabindex') !== '-1' && !previousFocus.closest('[aria-hidden="true"]')) previousFocus.focus({ preventScroll: true })
})
</script>
<template>
 <Teleport to="body">
  <dialog ref="dialog" class="gantt-drawer" :style="{top:viewport.top+'px',height:(viewport.bottom-viewport.top)+'px'}" :aria-label="title" aria-modal="true" @cancel.prevent="emit('close')" @click="backdrop" @keydown="trapFocus">
   <header><h2>{{title}}</h2><button ref="closeButton" aria-label="关闭详情" @click="emit('close')">×</button></header>
   <div class="drawer-body"><slot /></div>
  </dialog>
 </Teleport>
</template>
<style scoped>
.gantt-drawer{position:fixed;inset:0 0 0 auto;margin:0;width:400px;max-width:100%;height:100dvh;max-height:100%;padding:0;border:0;border-left:1px solid var(--ts-line);background:var(--ts-bg);color:var(--ts-text);box-shadow:-8px 0 32px #0002;overflow:hidden;animation:drawer-enter .18s ease-out}.gantt-drawer[open]{display:flex;flex-direction:column}.gantt-drawer::backdrop{background:#0005}header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;border-bottom:1px solid var(--ts-line)}header button{font-size:22px;line-height:1}.drawer-body{padding:20px;overflow:auto;overscroll-behavior:contain;overflow-wrap:anywhere;flex:1;min-height:0}@media(max-width:539px){.gantt-drawer{width:100%;border-left:0}}@keyframes drawer-enter{from{transform:translateX(100%)}to{transform:translateX(0)}}@media(prefers-reduced-motion:reduce){.gantt-drawer{animation:none}}
</style>
