// Archimedea Personal Modifier audit (Hotfix 44.0.1 groups).
// 1. The four groups hold the 25 client FRAME_VARIABLE_TAGS exactly once (9/6/4/6, as in the patch notes).
// 2. From the 2026-09-28 reset, a 44.0.0+ client gets one modifier from each group, in group order, deterministically.
// 3. Earlier weeks and pre-44 clients keep the pre-groups rule (19 legacy tags, unchanged output).
// 4. Over ten years of weeks every tag is offered at least once.
import assert from "node:assert/strict";
import { EPOCH } from "../../src/constants/timeConstants.ts";
import gameToBuildVersionInt from "../../src/constants/gameToBuildVersionInt.ts";
import {
    getConquest,
    personalModifierGroups,
    personalModifierGroupsStart
} from "../../src/services/conquestService.ts";
import type { TConquestType } from "../../src/types/worldStateTypes.ts";

const weekMs = 604800000;
const legacyTags = new Set([
    "Framecurse",
    "Knifestep",
    "Exhaustion",
    "Gearless",
    "TimeDilation",
    "Armorless",
    "Starvation",
    "ShieldDelay",
    "Withering",
    "ContactDamage",
    "AbilityLockout",
    "OperatorLockout",
    "EnergyStarved",
    "OverSensitive",
    "AntiGuard",
    "DecayingFlesh",
    "VoidEnergyOverload",
    "DullBlades",
    "Undersupplied"
]);
// Client 2026.09.30.14.45 ConquestLib FRAME_VARIABLE_TAGS (same list for both conquest types).
const clientTags = [
    ...legacyTags,
    "AoeDebuff",
    "RangeDebuff",
    "ChannelDrain",
    "NoPets",
    "AnemicShields",
    "InfectedWounds"
];

let checks = 0;
const check = (ok: boolean, message: string): void => {
    checks++;
    assert.ok(ok, message);
};

// 1. groups
const grouped = personalModifierGroups.flat();
check(personalModifierGroups.length == 4, "four groups");
check(personalModifierGroups.map(g => g.length).join("/") == "9/6/4/6", "group sizes 9/6/4/6 (Hotfix 44.0.1)");
check(new Set(grouped).size == grouped.length, "no tag in two groups");
check(grouped.length == clientTags.length && clientTags.every(t => grouped.includes(t)), "groups = client tags");

const firstGroupedWeek = Math.ceil((personalModifierGroupsStart - EPOCH) / weekMs);
check(EPOCH + firstGroupedWeek * weekMs == personalModifierGroupsStart, "the groups start on a weekly reset");
const current = gameToBuildVersionInt["44.0.0"];
const legacyBuild = gameToBuildVersionInt["43.5.4"];
const seen = new Set<string>();

for (const [type, season] of [
    ["CT_LAB", null],
    ["CT_HEX", "CST_WINTER"]
] as [TConquestType, "CST_WINTER" | null][]) {
    for (let week = firstGroupedWeek - 60; week < firstGroupedWeek + 520; week++) {
        const vars = getConquest(type, week, season, current).Variables;
        if (week < firstGroupedWeek) {
            // 3. before the reset: identical to the pre-groups rule (what a pre-44 client gets)
            check(
                vars.join() == getConquest(type, week, season, legacyBuild).Variables.join(),
                `${type} week ${week}: pre-groups week changed`
            );
            continue;
        }
        // 2. one per group, in group order, deterministic
        vars.forEach((tag, i) =>
            check(personalModifierGroups[i].includes(tag), `${type} week ${week}: ${tag} not in group ${i + 1}`)
        );
        check(
            vars.join() == getConquest(type, week, season, current).Variables.join(),
            `${type} week ${week}: not deterministic`
        );
        vars.forEach(tag => seen.add(`${type}:${tag}`));
        // 3. pre-44 clients keep the legacy tags
        for (const tag of getConquest(type, week, season, legacyBuild).Variables) {
            check(legacyTags.has(tag), `${type} week ${week}: pre-44 client got ${tag}`);
        }
    }
    // 4. coverage
    for (const tag of clientTags) {
        check(seen.has(`${type}:${tag}`), `${type}: ${tag} never offered in ten years`);
    }
}

console.log(
    `Conquest modifier audit passed: ${checks} checks; groups ${personalModifierGroups.map(g => g.length).join("/")} ` +
        `from ${new Date(personalModifierGroupsStart).toISOString().slice(0, 10)}; all ${clientTags.length} tags offered`
);
