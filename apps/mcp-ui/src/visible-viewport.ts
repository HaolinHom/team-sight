import { onMounted, onUnmounted, ref } from 'vue'

/** A host may scroll an auto-sized iframe partly outside its viewport. */
export function useVisibleViewport() {
  const bounds = ref({ top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight })
  let probe: HTMLDivElement | undefined, observer: IntersectionObserver | undefined
  function reset() { bounds.value = { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight } }
  onMounted(() => {
    window.addEventListener('resize', reset)
    if (typeof IntersectionObserver === 'undefined') return
    probe = document.createElement('div')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText = 'position:fixed;inset:0;pointer-events:none;visibility:hidden'
    document.body.appendChild(probe)
    observer = new IntersectionObserver(entries => {
      const rect = entries[0]?.intersectionRect
      if (rect && rect.width > 0 && rect.height > 0) bounds.value = { top: Math.ceil(rect.top), left: Math.ceil(rect.left), right: Math.floor(rect.right), bottom: Math.floor(rect.bottom) }
    }, { threshold: Array.from({ length: 1001 }, (_, index) => index / 1000) })
    observer.observe(probe)
  })
  onUnmounted(() => { observer?.disconnect(); probe?.remove(); window.removeEventListener('resize', reset) })
  return bounds
}
