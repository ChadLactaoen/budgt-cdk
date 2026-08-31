<script setup lang="ts">
/**
 * Lucide, outline, 2px stroke, inheriting `currentColor`.
 *
 * The design system masks a CDN-hosted SVG with `background: currentColor`; this uses
 * the official Vue package instead — same glyph set and same colour inheritance, but
 * bundled, so there is no third-party request on every page load.
 *
 * Sizes: 16 inline with body, 20 default, 24 headers, 32 empty states.
 */
import {
  ArrowLeft, Banknote, Calendar, Check, ChevronLeft, ChevronRight, Clock, Info,
  Music, OctagonAlert, PiggyBank, ReceiptText, Repeat, Search, Shapes,
  ShoppingBasket, ShoppingBag, Store, TriangleAlert, X,
} from 'lucide-vue-next';
import type { Component } from 'vue';
import { computed } from 'vue';

const GLYPHS: Record<string, Component> = {
  'arrow-left': ArrowLeft,
  banknote: Banknote,
  calendar: Calendar,
  check: Check,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  clock: Clock,
  info: Info,
  music: Music,
  'octagon-alert': OctagonAlert,
  'piggy-bank': PiggyBank,
  'receipt-text': ReceiptText,
  repeat: Repeat,
  search: Search,
  shapes: Shapes,
  'shopping-basket': ShoppingBasket,
  'shopping-bag': ShoppingBag,
  store: Store,
  'triangle-alert': TriangleAlert,
  x: X,
};

const props = withDefaults(defineProps<{ name: string; size?: number; label?: string }>(), {
  size: 20,
});

const glyph = computed(() => GLYPHS[props.name] ?? Shapes);
</script>

<template>
  <component
    :is="glyph"
    :size="size"
    :stroke-width="2"
    :aria-label="label"
    :aria-hidden="label ? undefined : true"
    :role="label ? 'img' : undefined"
    style="flex: 0 0 auto"
  />
</template>
