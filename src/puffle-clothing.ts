import {
  PUFFLE_CLOTHING_SLOTS,
  type PuffleClothing,
  type RoomUser,
} from "./types/player-types.js";

/**
 * Mirrors CPJourney's user shape: walked-puffle clothing lives in flat
 * `puffle{slot}` keys and the hair tint in `pufflehaircolor`.
 */
export function applyPuffleClothing(
  user: RoomUser,
  clothing: Partial<Record<keyof PuffleClothing, unknown>>,
): void {
  for (const slot of PUFFLE_CLOTHING_SLOTS) {
    user.meta[`puffle${slot}`] = Number(clothing[slot] ?? 0) || 0;
  }
}

export function applyPuffleHairColor(user: RoomUser, haircolor: unknown): void {
  const value = Number(haircolor);
  user.meta.pufflehaircolor = Number.isInteger(value) ? value : -1;
}
