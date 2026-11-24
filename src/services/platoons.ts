import {
  PLATOON_RULES,
  SHAI_CLASS_NAME,
  SHOTCALLER_ROLE_NAME,
} from "@/constants/attendance";
import type { PlatoonPlayer } from "@/types/attendance";

export interface MainPlatoonResult {
  platoons: PlatoonPlayer[][];
  warnings: string[];
}

export function isShai(player: PlatoonPlayer): boolean {
  return (
    player.signup.className === SHAI_CLASS_NAME ||
    player.roleName === SHAI_CLASS_NAME
  );
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Even split, remainder goes to the earliest platoons (31 / 2 -> 16, 15). */
function targetSizes(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  const extra = total % count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Splits the fighting pool into balanced platoons: Shai first, then mages,
 * then melee/range alternating, then everything else. Rules are best-effort —
 * anything that can't be met is reported in `warnings`.
 */
export function buildMainPlatoons(
  pool: PlatoonPlayer[],
  platoonCount: number
): MainPlatoonResult {
  const sizes = targetSizes(pool.length, platoonCount);
  const platoons: PlatoonPlayer[][] = sizes.map(() => []);
  const warnings: string[] = [];

  const countIn = (platoon: PlatoonPlayer[], match: (p: PlatoonPlayer) => boolean) =>
    platoon.reduce((sum, p) => sum + (match(p) ? 1 : 0), 0);

  // Platoon with room that has the fewest players matching `match`; ties go to the emptiest.
  const pickPlatoon = (match: (p: PlatoonPlayer) => boolean): number => {
    let best = -1;
    let bestMatches = Infinity;
    let bestFill = Infinity;
    platoons.forEach((platoon, i) => {
      if (platoon.length >= sizes[i]) return;
      const matches = countIn(platoon, match);
      const fill = platoon.length / sizes[i];
      if (matches < bestMatches || (matches === bestMatches && fill < bestFill)) {
        best = i;
        bestMatches = matches;
        bestFill = fill;
      }
    });
    return best;
  };

  const place = (player: PlatoonPlayer, match: (p: PlatoonPlayer) => boolean) => {
    const index = pickPlatoon(match);
    if (index !== -1) platoons[index].push(player);
  };

  const remaining = [...pool];
  const take = (predicate: (p: PlatoonPlayer) => boolean): PlatoonPlayer[] => {
    const taken: PlatoonPlayer[] = [];
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (predicate(remaining[i])) taken.push(...remaining.splice(i, 1));
    }
    return shuffled(taken);
  };

  // Shotcaller leads platoon 0
  const shotcallerIndex = remaining.findIndex(
    (p) => p.roleName === SHOTCALLER_ROLE_NAME
  );
  if (shotcallerIndex !== -1 && sizes[0] > 0) {
    platoons[0].push(...remaining.splice(shotcallerIndex, 1));
  }

  const shaiGroup = take(isShai);
  const mageGroup = take((p) => p.signup.category === "mage");
  const meleeGroup = take((p) => p.signup.category === "melee");
  const rangeGroup = take((p) => p.signup.category === "range");
  const otherGroup = shuffled(remaining);

  for (const player of shaiGroup) place(player, isShai);
  for (const player of mageGroup) place(player, (p) => p.signup.category === "mage");

  // Alternate melee/range so each platoon ends up near 50/50
  const isMelee = (p: PlatoonPlayer) => p.signup.category === "melee";
  const isRange = (p: PlatoonPlayer) => p.signup.category === "range";
  while (meleeGroup.length > 0 || rangeGroup.length > 0) {
    const melee = meleeGroup.pop();
    if (melee) place(melee, isMelee);
    const range = rangeGroup.pop();
    if (range) place(range, isRange);
  }

  for (const player of otherGroup) place(player, () => true);

  platoons.forEach((platoon, i) => {
    const label = `Platoon ${i + 1}`;
    const shai = countIn(platoon, isShai);
    const mages = countIn(platoon, (p) => p.signup.category === "mage");
    if (shai < PLATOON_RULES.shaiMin) {
      warnings.push(`${label} has only ${shai} Shai (wanted ${PLATOON_RULES.shaiMin}).`);
    }
    if (mages < PLATOON_RULES.mageMin) {
      warnings.push(`${label} has only ${mages} mage${mages === 1 ? "" : "s"} (wanted ${PLATOON_RULES.mageMin}).`);
    }
  });

  const unset = pool.filter((p) => !p.signup.category && !isShai(p)).length;
  if (unset > 0) {
    warnings.push(
      `${unset} player${unset === 1 ? " has" : "s have"} no category set, so they can't be balanced. Ask them to use My Details.`
    );
  }

  return { platoons, warnings };
}
