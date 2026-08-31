<script setup lang="ts">
/**
 * Search across every category, grouped by parent, each parent's label in its own
 * colour. Category colour is identity, never decoration.
 */
import { computed, ref } from 'vue';
import { allCategories, PARENTS, type CategoryId, type Parent } from '@shared/categories';
import HSheet from './HSheet.vue';
import HInput from './HInput.vue';
import HCategoryAvatar from './HCategoryAvatar.vue';

const emit = defineEmits<{ close: []; pick: [id: CategoryId] }>();

const query = ref('');
const all = allCategories().filter((c) => c.active);

const groups = computed(() => {
  const q = query.value.trim().toLowerCase();
  const matches = q
    ? all.filter((c) => c.nm.toLowerCase().includes(q) || c.pt.toLowerCase().includes(q))
    : all;
  return PARENTS.map((pt: Parent) => ({
    pt,
    items: matches.filter((c) => c.pt === pt),
  })).filter((g) => g.items.length > 0);
});
</script>

<template>
  <HSheet title="Pick a category" @close="emit('close')">
    <div class="h-picker">
      <HInput
        v-model="query"
        icon="search"
        :placeholder="`Search ${all.length} categories`"
      />

      <div v-for="group in groups" :key="group.pt" class="h-picker__group">
        <span
          class="heeth-caps"
          :style="{ color: group.items[0].hex }"
        >{{ group.pt }}</span>
        <div class="h-picker__items">
          <button
            v-for="c in group.items"
            :key="c.id"
            type="button"
            class="h-picker__item"
            @click="emit('pick', c.id)"
          >
            <HCategoryAvatar :icon="c.icon" :color="c.hex" />
            <span class="h-picker__name">{{ c.nm }}</span>
          </button>
        </div>
      </div>

      <p v-if="!groups.length" class="h-picker__empty">
        Nothing matches “{{ query }}”.
      </p>
    </div>
  </HSheet>
</template>

<style scoped>
.h-picker { display: flex; flex-direction: column; gap: var(--stack-loose); }
.h-picker__group { display: flex; flex-direction: column; gap: var(--space-3); }
.h-picker__items { display: flex; flex-direction: column; gap: var(--space-3); }

.h-picker__item {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  width: 100%;
  min-height: 56px;
  padding: var(--space-3);
  background: var(--surface-card);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
  color: var(--text-body);
  font-family: var(--font-ui);
  font-size: var(--fs-body);
  text-align: left;
  cursor: pointer;
}
.h-picker__item:hover { background: var(--surface-hover); }

.h-picker__name { flex: 1; }

.h-picker__empty { font-size: var(--fs-body); color: var(--text-faint); }
</style>
