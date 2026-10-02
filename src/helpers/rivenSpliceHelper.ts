import { getCurrentRivenContract } from "../services/currentPublicExportService.ts";
import type { IUpgrade } from "warframe-public-export-plus";
import { isRivenTraitAllowed, type IUnveiledRivenFingerprint } from "./rivenHelper.ts";

export const RIVEN_SPLICER = "/Lotus/Types/Items/MiscItems/RivenSplicer";
export const RIVEN_SPLICE_COST = 1;
export const RIVEN_MAX_QUALITY = 0x3fffffff;
export interface SpliceRecipe {
    id: string;
    primaryIngredient: string;
    secondaryIngredient: string;
    resultTag: string;
    available: boolean;
    reason?: string;
}

// Each Riven class uses its own native MergeOptions from the current client.
// Native melee MergeOptions name some ingredients by their generic weapon tag,
// while melee Rivens carry the melee-specific trait; resolve those to the trait
// that actually exists on the Riven.
const meleeIngredientAliases: Readonly<Record<string, string>> = {
    WeaponDamageAmountMod: "WeaponMeleeDamageMod",
    WeaponFactionDamageGrineer: "WeaponMeleeFactionDamageGrineer",
    WeaponFactionDamageCorpus: "WeaponMeleeFactionDamageCorpus",
    WeaponFactionDamageInfested: "WeaponMeleeFactionDamageInfested"
};
export const getRivenSpliceRecipes = (meta: IUpgrade): SpliceRecipe[] => {
    const contract = getCurrentRivenContract(meta);
    if (!contract) return [];
    const tags = new Set(contract.entries.map(e => e.tag));
    const resolve = (tag: string): string =>
        tags.has(tag) ? tag : (meleeIngredientAliases[tag] ?? tag);
    const recipes = contract.mergeOptions.map(recipe => ({
        primaryIngredient: resolve(recipe.primaryIngredient),
        secondaryIngredient: resolve(recipe.secondaryIngredient),
        resultTag: recipe.resultTag
    }));
    return recipes.map(recipe => {
        const a = contract.entries.find(e => e.tag === recipe.primaryIngredient && !e.isAdvancedTrait);
        const b = contract.entries.find(e => e.tag === recipe.secondaryIngredient && !e.isAdvancedTrait);
        const result = contract.entries.find(e => e.tag === recipe.resultTag && e.canBeBuff && e.isAdvancedTrait);
        const available = !!a && !!b && !!result;
        return {
            ...recipe,
            id: [recipe.primaryIngredient, recipe.secondaryIngredient, recipe.resultTag].join("+"),
            available,
            ...(!available
                ? { reason: "Current client lacks a required native trait/coefficient for this Riven class" }
                : {})
        };
    });
};

export const validateSpliceFingerprint = (meta: IUpgrade, fp: IUnveiledRivenFingerprint): void => {
    const contract = getCurrentRivenContract(meta);
    if (
        !contract ||
        !Array.isArray(fp.buffs) ||
        !Array.isArray(fp.curses) ||
        ![2, 3].includes(fp.buffs.length) ||
        fp.curses.length > 1
    )
        throw new Error("Expected an unveiled Riven with a legal trait layout");
    const seen = new Set<string>();
    for (const [stats, positive] of [
        [fp.buffs, true],
        [fp.curses, false]
    ] as const) {
        for (const stat of stats) {
            const entry = contract.entries.find(e => e.tag === stat.Tag);
            if (
                !entry ||
                !(positive ? entry.canBeBuff : entry.canBeCurse) ||
                seen.has(stat.Tag) ||
                !Number.isInteger(stat.Value) ||
                stat.Value < 0 ||
                stat.Value > RIVEN_MAX_QUALITY
            )
                throw new Error("Invalid, duplicate or out-of-range Riven trait");
            seen.add(stat.Tag);
        }
    }
    if ([...fp.buffs, ...fp.curses].some(s => contract.entries.find(e => e.tag === s.Tag)?.isAdvancedTrait))
        throw new Error("Remove the existing spliced trait before creating another");
};

export const spliceRiven = (
    meta: IUpgrade,
    original: IUnveiledRivenFingerprint,
    recipeId: string,
    random = Math.random
): IUnveiledRivenFingerprint => {
    validateSpliceFingerprint(meta, original);
    const recipe = getRivenSpliceRecipes(meta).find(r => r.id === recipeId);
    if (!recipe?.available) throw new Error("Unsupported splice recipe for this Riven class");
    const tags = new Set([recipe.primaryIngredient, recipe.secondaryIngredient]);
    const consumed = [...original.buffs, ...original.curses].filter(s => tags.has(s.Tag));
    if (consumed.length !== 2) throw new Error("Both required traits must exist on the same Riven");
    const fp = structuredClone(original);
    const positiveIndex = fp.buffs.findIndex(s => tags.has(s.Tag));
    if (positiveIndex === -1) throw new Error("A splice requires at least one positive trait");
    const randomIsNegative = fp.curses.some(s => tags.has(s.Tag));
    const randomIndex = randomIsNegative
        ? fp.curses.findIndex(s => tags.has(s.Tag))
        : fp.buffs.findIndex((s, i) => i !== positiveIndex && tags.has(s.Tag));
    const retainedTags = new Set([...fp.buffs, ...fp.curses].filter(s => !tags.has(s.Tag)).map(s => s.Tag));
    const pool = getCurrentRivenContract(meta)!.entries.filter(
        e =>
            !e.isAdvancedTrait &&
            !retainedTags.has(e.tag) &&
            isRivenTraitAllowed(meta, e.tag, randomIsNegative, fp) &&
            (randomIsNegative ? e.canBeCurse : e.canBeBuff)
    );
    if (!pool.length) throw new Error("No legal replacement trait available");
    const draw = (): number => {
        const v = random();
        if (!Number.isFinite(v) || v < 0 || v >= 1) throw new Error("Invalid random draw");
        return v;
    };
    // User's requested quality policy: keep the larger encoded roll quality,
    // including mixed-sign inputs. Do not compare displayed percentages, round
    // to a letter grade, or alter the output coefficient/rank/disposition.
    fp.buffs[positiveIndex] = { Tag: recipe.resultTag, Value: Math.max(...consumed.map(s => s.Value)) };
    const replacement = {
        Tag: pool[Math.floor(draw() * pool.length)].tag,
        Value: Math.floor(draw() * (RIVEN_MAX_QUALITY + 1))
    };
    (randomIsNegative ? fp.curses : fp.buffs)[randomIndex] = replacement;
    return fp;
};
