import type { MenuSnapshot } from '../../domain/menu.ts';

/**
 * A deliberately small menu that still exercises every rule the Order Service
 * has to enforce: sizes, required and optional modifier groups, removals,
 * combos with slots, dayparting, and aliases that collide.
 *
 * Shared by fakes, conformance checks, and (from Phase 1) the Order Service
 * tests, so one fixture defines what "correct" means everywhere.
 */
export const TEST_MENU: MenuSnapshot = {
  storeId: 'test-store',
  version: 'test-menu-v1',
  publishedAt: '2026-01-01T00:00:00.000Z',

  items: [
    {
      sku: 'burger_classic',
      displayName: 'Classic Burger',
      spokenName: 'classic burger',
      category: 'entree',
      sizes: [],
      modifierGroupIds: ['burger_toppings'],
      basePriceCents: 549,
    },
    {
      sku: 'burger_double',
      displayName: 'Double Burger',
      spokenName: 'double burger',
      category: 'entree',
      sizes: [],
      modifierGroupIds: ['burger_toppings'],
      basePriceCents: 729,
    },
    {
      sku: 'fries',
      displayName: 'Fries',
      spokenName: 'fries',
      category: 'side',
      sizes: [
        { id: 'sm', displayName: 'Small', priceDeltaCents: 0, isDefault: true },
        { id: 'md', displayName: 'Medium', priceDeltaCents: 60, isDefault: false },
        { id: 'lg', displayName: 'Large', priceDeltaCents: 110, isDefault: false },
      ],
      modifierGroupIds: [],
      basePriceCents: 229,
    },
    {
      sku: 'drink_cola',
      displayName: 'Cola',
      spokenName: 'cola',
      category: 'drink',
      sizes: [
        { id: 'sm', displayName: 'Small', priceDeltaCents: 0, isDefault: true },
        { id: 'md', displayName: 'Medium', priceDeltaCents: 50, isDefault: false },
        { id: 'lg', displayName: 'Large', priceDeltaCents: 90, isDefault: false },
      ],
      modifierGroupIds: ['drink_options'],
      basePriceCents: 199,
    },
    {
      sku: 'drink_diet_cola',
      displayName: 'Diet Cola',
      spokenName: 'diet cola',
      category: 'drink',
      sizes: [
        { id: 'sm', displayName: 'Small', priceDeltaCents: 0, isDefault: true },
        { id: 'md', displayName: 'Medium', priceDeltaCents: 50, isDefault: false },
        { id: 'lg', displayName: 'Large', priceDeltaCents: 90, isDefault: false },
      ],
      modifierGroupIds: ['drink_options'],
      basePriceCents: 199,
    },
    {
      sku: 'apple_pie',
      displayName: 'Apple Pie',
      spokenName: 'apple pie',
      category: 'dessert',
      sizes: [],
      modifierGroupIds: [],
      basePriceCents: 179,
    },
    {
      sku: 'breakfast_muffin',
      displayName: 'Breakfast Muffin',
      spokenName: 'breakfast muffin',
      category: 'entree',
      sizes: [],
      modifierGroupIds: [],
      basePriceCents: 399,
      dayparts: ['breakfast'],
    },
    {
      sku: 'milkshake',
      displayName: 'Milkshake',
      spokenName: 'milkshake',
      category: 'drink',
      sizes: [],
      modifierGroupIds: [],
      basePriceCents: 349,
    },
  ],

  modifierGroups: [
    {
      id: 'burger_toppings',
      displayName: 'Toppings',
      minSelections: 0,
      maxSelections: 3,
      options: [
        { id: 'no_onions', displayName: 'No Onions', spokenName: 'no onions', priceDeltaCents: 0, kind: 'remove' },
        { id: 'no_pickles', displayName: 'No Pickles', spokenName: 'no pickles', priceDeltaCents: 0, kind: 'remove' },
        { id: 'extra_cheese', displayName: 'Extra Cheese', spokenName: 'extra cheese', priceDeltaCents: 70, kind: 'add' },
        { id: 'bacon', displayName: 'Bacon', spokenName: 'bacon', priceDeltaCents: 130, kind: 'add' },
      ],
    },
    {
      id: 'drink_options',
      displayName: 'Drink Options',
      minSelections: 0,
      maxSelections: 1,
      options: [
        { id: 'no_ice', displayName: 'No Ice', spokenName: 'no ice', priceDeltaCents: 0, kind: 'remove' },
        { id: 'light_ice', displayName: 'Light Ice', spokenName: 'light ice', priceDeltaCents: 0, kind: 'remove' },
      ],
    },
  ],

  combos: [
    {
      id: 'combo_1',
      displayName: 'Classic Burger Combo',
      spokenAliases: ['number one', 'combo one', 'number 1', 'the first one'],
      priceCents: 849,
      slots: [
        { id: 'entree', displayName: 'Entree', eligibleSkus: ['burger_classic'], defaultSku: 'burger_classic' },
        { id: 'side', displayName: 'Side', eligibleSkus: ['fries'], defaultSku: 'fries' },
        { id: 'drink', displayName: 'Drink', eligibleSkus: ['drink_cola', 'drink_diet_cola'], defaultSku: 'drink_cola' },
      ],
    },
    {
      id: 'combo_3',
      displayName: 'Double Burger Combo',
      spokenAliases: ['number three', 'combo three', 'number 3'],
      priceCents: 1029,
      slots: [
        { id: 'entree', displayName: 'Entree', eligibleSkus: ['burger_double'], defaultSku: 'burger_double' },
        { id: 'side', displayName: 'Side', eligibleSkus: ['fries'], defaultSku: 'fries' },
        { id: 'drink', displayName: 'Drink', eligibleSkus: ['drink_cola', 'drink_diet_cola'], defaultSku: 'drink_cola' },
      ],
    },
  ],

  // Milkshake machine is down, as is traditional.
  unavailableSkus: ['milkshake'],

  aliasIndex: [
    { phrase: 'coke', targetSku: 'drink_cola', confidence: 0.95 },
    { phrase: 'coca cola', targetSku: 'drink_cola', confidence: 0.97 },
    { phrase: 'a coke', targetSku: 'drink_cola', confidence: 0.93 },
    // "diet" is genuinely ambiguous against "diet cola" — exercises clarification.
    { phrase: 'diet', targetSku: 'drink_diet_cola', confidence: 0.61 },
    { phrase: 'diet coke', targetSku: 'drink_diet_cola', confidence: 0.96 },
    { phrase: 'burger', targetSku: 'burger_classic', confidence: 0.72 },
    { phrase: 'cheeseburger', targetSku: 'burger_classic', confidence: 0.8 },
    { phrase: 'double', targetSku: 'burger_double', confidence: 0.78 },
    { phrase: 'large fries', targetSku: 'fries', targetSizeId: 'lg', confidence: 0.94 },
    { phrase: 'big fries', targetSku: 'fries', targetSizeId: 'lg', confidence: 0.85 },
    { phrase: 'pie', targetSku: 'apple_pie', confidence: 0.88 },
    { phrase: 'shake', targetSku: 'milkshake', confidence: 0.9 },
  ],
};

/** The empty order every session starts from. */
export const EMPTY_ORDER = {
  orderId: 'test-order',
  sessionId: 'test-session',
  revision: 0,
  status: 'draft',
  lines: [],
  subtotalCents: 0,
  taxCents: 0,
  totalCents: 0,
} as const;

/**
 * A small confirmed order for POS conformance and outbox tests: one combo line
 * plus a modified item, which is enough to exercise line mapping and totals.
 */
export const SAMPLE_ORDER = {
  orderId: 'test-order-1',
  sessionId: 'test-session',
  revision: 3,
  status: 'confirmed',
  lines: [
    {
      lineId: 'line-1',
      sku: 'burger_double',
      displayName: 'Double Burger',
      quantity: 1,
      modifiers: [{ optionId: 'no_onions', displayName: 'No Onions', priceDeltaCents: 0 }],
      comboId: 'combo_3',
      unitPriceCents: 1029,
      totalPriceCents: 1029,
      resolutionConfidence: 0.95,
    },
    {
      lineId: 'line-2',
      sku: 'apple_pie',
      displayName: 'Apple Pie',
      quantity: 2,
      modifiers: [],
      unitPriceCents: 179,
      totalPriceCents: 358,
      resolutionConfidence: 0.91,
    },
  ],
  subtotalCents: 1387,
  taxCents: 114,
  totalCents: 1501,
} as const;
