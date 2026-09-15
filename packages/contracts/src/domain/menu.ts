/**
 * The read model the Order Service validates against. Built at menu-publish
 * time and held in memory; a store's menu is small enough that this is fine.
 */

export interface MenuSnapshot {
  readonly storeId: string;
  readonly version: string;
  readonly publishedAt: string;
  readonly items: readonly MenuItem[];
  readonly modifierGroups: readonly ModifierGroup[];
  readonly combos: readonly ComboDefinition[];
  /** SKUs currently 86'd. Changes hourly; kept separate from `version`. */
  readonly unavailableSkus: readonly string[];
  /** Feeds ASR vocabulary bias and the catalog resolver. */
  readonly aliasIndex: readonly MenuAlias[];
}

export interface MenuItem {
  readonly sku: string;
  readonly displayName: string;
  /** What TTS should say — often shorter than the display name. */
  readonly spokenName: string;
  readonly category: string;
  readonly sizes: readonly SizeOption[];
  readonly modifierGroupIds: readonly string[];
  readonly basePriceCents: number;
  readonly dayparts?: readonly Daypart[];
}

export interface SizeOption {
  readonly id: string;
  readonly displayName: string;
  readonly priceDeltaCents: number;
  readonly isDefault: boolean;
}

export interface ModifierGroup {
  readonly id: string;
  readonly displayName: string;
  readonly minSelections: number;
  readonly maxSelections: number;
  readonly options: readonly ModifierOption[];
}

export interface ModifierOption {
  readonly id: string;
  readonly displayName: string;
  readonly spokenName: string;
  readonly priceDeltaCents: number;
  /** e.g. "no onions" is a removal of a default-on modifier. */
  readonly kind: 'add' | 'remove' | 'substitute';
}

export interface ComboDefinition {
  readonly id: string;
  readonly displayName: string;
  /** Spoken shorthand customers actually use: "number three", "combo 3". */
  readonly spokenAliases: readonly string[];
  readonly slots: readonly ComboSlot[];
  readonly priceCents: number;
}

export interface ComboSlot {
  readonly id: string;
  readonly displayName: string;
  readonly eligibleSkus: readonly string[];
  readonly defaultSku: string;
}

/**
 * Maps what people say to what we sell. Populated from menu data, then grown
 * from production transcripts — this is where most accuracy gains come from
 * after the first month, far more than model upgrades.
 */
export interface MenuAlias {
  readonly phrase: string;
  readonly targetSku: string;
  readonly targetSizeId?: string;
  /** 0..1. Below the resolver threshold we ask instead of guessing. */
  readonly confidence: number;
}

export type Daypart = 'breakfast' | 'lunch' | 'dinner' | 'late_night';
