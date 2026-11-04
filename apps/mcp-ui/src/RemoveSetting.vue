<script setup lang="ts">
import {ref} from 'vue'
import SettingIcon from './SettingIcon.vue'
defineProps<{label:string;description:string;disabled?:boolean}>()
const emit=defineEmits<{remove:[]}>()
const confirming=ref(false)
</script>
<template>
 <div class="remove-setting">
  <button v-if="!confirming" type="button" class="remove-trigger" :disabled="disabled" @click="confirming=true"><SettingIcon name="trash"/>{{label}}</button>
  <div v-else class="remove-confirmation" role="group" :aria-label="'确认'+label"><p>{{description}}</p><div><button type="button" @click="confirming=false">保留</button><button type="button" class="confirm-remove" @click="emit('remove');confirming=false">确认删除</button></div></div>
 </div>
</template>
<style scoped>
.remove-setting{margin-top:16px}.remove-trigger{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;padding:6px 0;color:var(--ts-error);font-size:12px}.remove-trigger .setting-icon{width:16px;height:16px}.remove-confirmation{padding:12px;background:var(--ts-error-bg);border-radius:6px;color:var(--ts-error)}.remove-confirmation p{margin:0 0 10px;font-size:13px}.remove-confirmation>div{display:flex;justify-content:flex-end;gap:8px}.remove-confirmation button{font-size:12px;min-height:32px}.confirm-remove{color:var(--ts-error);border-color:var(--ts-error)}
</style>
