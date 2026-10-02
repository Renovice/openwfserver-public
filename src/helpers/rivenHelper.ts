import { currentRivenPhysicalRules, getCurrentRivenContract } from "../services/currentPublicExportService.ts";
import { ExportWeapons, type IUpgrade } from "warframe-public-export-plus";
import type { TInventoryDatabaseDocument } from "../models/inventoryModels/inventoryModel.ts";
import { Loadout } from "../models/inventoryModels/loadoutModel.ts";
import type { IEquipmentDatabase, IEquipmentSelectionDatabase } from "../types/equipmentTypes.ts";
import { eLoadoutIndex } from "../types/inventoryTypes/inventoryTypes.ts";
import { getRandomElement, getRandomInt, getRandomReward } from "../services/rngService.ts";

export type RivenFingerprint = IVeiledRivenFingerprint | IUnveiledRivenFingerprint;

export interface IVeiledRivenFingerprint {
    challenge: IRivenChallenge;
    IsSentinel?: true;
}

interface IRivenChallenge {
    Type: string;
    Progress: number;
    Required: number;
    Complication?: string;
}

export interface IUnveiledRivenFingerprint {
    compat: string;
    lim: 0;
    lvl: number;
    lvlReq: number;
    rerolls?: number;
    pol: string;
    buffs: IFingerprintStat[];
    curses: IFingerprintStat[];
    IsSentinel?: true;
}

export interface IFingerprintStat {
    Tag: string;
    Value: number;
}

export type LockedRivenStatTags = readonly string[];

// Server contract for the later native UI adapter. Existing custom multi-lock
// input remains supported; advanced traits are implicitly locked unless released.
export const resolveRivenCycleLocks = (
    meta: IUpgrade,
    fingerprint: IUnveiledRivenFingerprint,
    manualTags: readonly string[],
    unlockedAdvancedTags: readonly string[] = []
): { tags: string[]; costMultiplier: number } => {
    const advanced = new Set(
        getCurrentRivenContract(meta)
            ?.entries.filter(entry => entry.isAdvancedTrait)
            .map(entry => entry.tag) ?? []
    );
    const present = new Set([...fingerprint.buffs, ...fingerprint.curses].map(stat => stat.Tag));
    for (const tag of [...manualTags, ...unlockedAdvancedTags]) {
        if (!present.has(tag)) throw new Error(`Cannot select absent Riven trait ${tag}`);
    }
    if (unlockedAdvancedTags.some(tag => !advanced.has(tag)))
        throw new Error("Only advanced traits can be released from their automatic lock");
    const tags = new Set(manualTags);
    for (const tag of present) {
        if (advanced.has(tag) && !unlockedAdvancedTags.includes(tag)) tags.add(tag);
    }
    // x2 Kuva per manual lock (x2, x4, x6, x8); the automatic spliced-trait lock is free.
    const manualLocks = new Set(manualTags.filter(tag => !advanced.has(tag))).size;
    return { tags: [...tags], costMultiplier: manualLocks == 0 ? 1 : 2 * manualLocks };
};

export const createVeiledRivenFingerprint = (meta: IUpgrade, IsSentinel: true | undefined): IVeiledRivenFingerprint => {
    const challenge = getRandomElement(meta.availableChallenges!)!;
    const fingerprintChallenge: IRivenChallenge = {
        Type: challenge.fullName,
        Progress: 0,
        Required: getRandomInt(challenge.countRange[0], challenge.countRange[1])
    };
    if (Math.random() < challenge.complicationChance) {
        const complications: { type: string; probability: number }[] = [];
        for (const complication of challenge.complications) {
            complications.push({
                type: complication.fullName,
                probability: complication.weight
            });
        }
        fingerprintChallenge.Complication = getRandomReward(complications)!.type;
        const complication = challenge.complications.find(x => x.fullName == fingerprintChallenge.Complication)!;
        fingerprintChallenge.Required *= complication.countMultiplier;
    }
    return { challenge: fingerprintChallenge, IsSentinel };
};

export const createUnveiledRivenFingerprint = (
    meta: IUpgrade,
    IsSentinel: true | undefined,
    preferredCompat?: string
): IUnveiledRivenFingerprint => {
    const compatibleItems = getRivenCompatPool(meta, IsSentinel);
    const fingerprint: IUnveiledRivenFingerprint = {
        // preferredCompat is already resolved to a base weapon that's in compatibleItems (see
        // getEquippedWeaponCompatForRiven). Use it; fall back to a random compatible weapon if none was found.
        compat:
            preferredCompat && compatibleItems.includes(preferredCompat)
                ? preferredCompat
                : getRandomElement(compatibleItems)!,
        lim: 0,
        lvl: 0,
        lvlReq: getRandomInt(8, 16),
        pol: getRandomElement(["AP_ATTACK", "AP_DEFENSE", "AP_TACTIC"])!,
        buffs: [],
        curses: [],
        IsSentinel
    };
    randomiseRivenStats(meta, fingerprint);
    return fingerprint;
};

const normalizeObjectIdString = (value: unknown): string | undefined => {
    if (!value) return undefined;
    if (typeof value == "string") return value;
    if (typeof value == "object") {
        if ("$oid" in value && typeof value.$oid == "string") return value.$oid;
        if ("$id" in value && typeof value.$id == "string") return value.$id;
    }
    if (typeof (value as { toString?: unknown }).toString == "function") return String(value);
    return undefined;
};

const equipmentHasRiven = (
    equipment: IEquipmentDatabase | undefined | null,
    upgradeId: string,
    activeConfigIndex: number | undefined
): equipment is IEquipmentDatabase => {
    if (!equipment) return false;
    const activeConfig = equipment.Configs.at(activeConfigIndex ?? 0);
    if (activeConfig?.Upgrades?.some(id => normalizeObjectIdString(id) == upgradeId)) return true;
    return equipment.Configs.some(config => config.Upgrades?.some(id => normalizeObjectIdString(id) == upgradeId));
};

const getSelectedEquipment = (
    inventory: TInventoryDatabaseDocument,
    collection: "LongGuns" | "Pistols" | "Melee" | "SpaceGuns" | "SentinelWeapons",
    selection: IEquipmentSelectionDatabase | undefined
): IEquipmentDatabase | undefined | null => {
    const itemId = normalizeObjectIdString(selection?.ItemId);
    if (!itemId) return undefined;
    switch (collection) {
        case "LongGuns":
            return inventory.LongGuns.id(itemId);
        case "Pistols":
            return inventory.Pistols.id(itemId);
        case "Melee":
            return inventory.Melee.id(itemId);
        case "SpaceGuns":
            return inventory.SpaceGuns.id(itemId);
        case "SentinelWeapons":
            return inventory.SentinelWeapons.id(itemId);
    }
};

export const getEquippedWeaponCompatForRiven = async (
    inventory: TInventoryDatabaseDocument,
    upgradeId: string,
    compatibleItems: readonly string[]
): Promise<string | undefined> => {
    const loadout = await Loadout.findOne({ loadoutOwnerId: inventory.accountOwnerId });
    if (!loadout) return undefined;

    const normalLoadout =
        inventory.CurrentLoadOutIds[eLoadoutIndex.NORMAL] &&
        loadout.NORMAL.id(inventory.CurrentLoadOutIds[eLoadoutIndex.NORMAL]);
    const sentinelLoadout =
        inventory.CurrentLoadOutIds[eLoadoutIndex.SENTINEL] &&
        loadout.SENTINEL.id(inventory.CurrentLoadOutIds[eLoadoutIndex.SENTINEL]);

    const candidates = [
        { equipment: getSelectedEquipment(inventory, "LongGuns", normalLoadout?.l), selection: normalLoadout?.l },
        { equipment: getSelectedEquipment(inventory, "Pistols", normalLoadout?.p), selection: normalLoadout?.p },
        { equipment: getSelectedEquipment(inventory, "Melee", normalLoadout?.m), selection: normalLoadout?.m },
        { equipment: getSelectedEquipment(inventory, "SpaceGuns", normalLoadout?.h), selection: normalLoadout?.h },
        {
            equipment: getSelectedEquipment(inventory, "SentinelWeapons", sentinelLoadout?.l),
            selection: sentinelLoadout?.l
        }
    ];

    for (const { equipment, selection } of candidates) {
        if (equipment && equipmentHasRiven(equipment, upgradeId, selection?.mod)) {
            // The riven is slotted on this weapon. Resolve to the BASE weapon the riven keys to: variants (Prime,
            // Vandal, Wraith, etc.) share the base's Riven, and only the base appears in compatibleItems. Walk
            // parentName up to the first ancestor present in compatibleItems (e.g. PrimeBallistica -> AutoCrossBow).
            let current: string | undefined = equipment.ItemType;
            const walked = new Set<string>();
            while (current && !walked.has(current)) {
                if (compatibleItems.includes(current)) return current;
                walked.add(current);
                current = Object.hasOwn(ExportWeapons, current) ? ExportWeapons[current].parentName : undefined;
            }
        }
    }

    return undefined;
};

// Cipher-time -> unveil-time hand-off. In the orbiter the client strips the veiled riven off the weapon the instant
// the cipher is used, so by the time rerollRandomMod unveils it, equipmentHasRiven can no longer see it on the weapon.
// completeRandomModChallenge captures the compat while the mod is still slotted and stashes it here; the reveal
// consumes it. Server-only (never sent to the client), cleared on use.
const revealCompatPreference = new Map<string, string>();
export const setRevealCompatPreference = (upgradeId: string, compat: string): void => {
    revealCompatPreference.set(upgradeId, compat);
};
export const getRevealCompatPreference = (upgradeId: string): string | undefined => {
    return revealCompatPreference.get(upgradeId);
};
export const clearRevealCompatPreference = (upgradeId: string): void => {
    revealCompatPreference.delete(upgradeId);
};

// Native client ItemCompatibilities / SentinelItemCompatibilities: normal and companion Rivens draw their weapon
// from separate lists (companion lists include robotic Hound weapons, which normal Rivens never become).
const getRivenCompatPool = (meta: IUpgrade, IsSentinel: true | undefined): readonly string[] => {
    const contract = getCurrentRivenContract(meta);
    if (!contract) throw new Error("Unknown Riven type");
    return IsSentinel ? contract.sentinelCompatibleItems : contract.compatibleItems;
};

const isCompanionRiven = (meta: IUpgrade, fingerprint: { compat?: string; IsSentinel?: true }): boolean => {
    if (fingerprint.IsSentinel) return true;
    if (!fingerprint.compat) return false;
    return (
        getRivenCompatPool(meta, true).includes(fingerprint.compat) &&
        !getRivenCompatPool(meta, undefined).includes(fingerprint.compat)
    );
};

// Native UpgradeEntries restrictions from the current client:
// - NotSentinel: never on companion Rivens.
// - NotGrimoire: never on Rivens for the Grimoire.
// - DamageTypes: physical traits follow the generated per-weapon table (currentRivenPhysicalRules: market evidence,
//   PE+ riven_unrollables, decoded-client rule; unlisted weapons are unrestricted); elemental traits need the weapon
//   to deal that element (unreachable today: elemental traits are never curses).
// - CompatibilityTags (e.g. Projectile Speed -> PROJECTILE): the weapon must carry every tag.
// Unknown restriction kinds fail closed.
const physicalTraits = new Set(["WeaponImpactDamageMod", "WeaponArmorPiercingDamageMod", "WeaponSlashDamageMod"]);
const elementalDamagePerShotIndex: Readonly<Record<string, number>> = {
    DT_FIRE: 3,
    DT_FREEZE: 4,
    DT_ELECTRICITY: 5,
    DT_POISON: 6
};
const isGrimoire = (weaponType: string): boolean => weaponType.startsWith("/Lotus/Weapons/Tenno/Grimoire/");

export const isRivenTraitAllowed = (
    meta: IUpgrade,
    tag: string,
    asCurse: boolean,
    fingerprint: { compat?: string; IsSentinel?: true }
): boolean => {
    const entry = getCurrentRivenContract(meta)?.entries.find(e => e.tag == tag);
    if (!entry) return false;
    const weapon = fingerprint.compat ? ExportWeapons[fingerprint.compat] : undefined;
    if (entry.compatibilityTags.length != 0) {
        const weaponTags = weapon?.compatibilityTags ?? [];
        if (!entry.compatibilityTags.every(t => weaponTags.includes(t))) return false;
    }
    for (const restriction of asCurse ? entry.curseRestrictions : entry.buffRestrictions) {
        if (restriction == "NotSentinel") {
            if (isCompanionRiven(meta, fingerprint)) return false;
        } else if (restriction == "NotGrimoire") {
            if (fingerprint.compat && isGrimoire(fingerprint.compat)) return false;
        } else if (restriction == "DamageTypes") {
            if (!fingerprint.compat) return false;
            if (physicalTraits.has(tag)) {
                if ((currentRivenPhysicalRules[fingerprint.compat] as readonly string[] | undefined)?.includes(tag))
                    return false;
            } else {
                const index = entry.damageType ? elementalDamagePerShotIndex[entry.damageType] : undefined;
                if (index === undefined || !((weapon?.damagePerShot?.[index] ?? 0) > 0)) return false;
            }
        } else {
            return false;
        }
    }
    return true;
};

export const randomiseRivenStats = (
    meta: IUpgrade,
    fingerprint: IUnveiledRivenFingerprint,
    lockedTags: LockedRivenStatTags = []
): void => {
    const lockedTagSet = new Set(lockedTags.filter(Boolean));
    const oldBuffs = fingerprint.buffs;
    const oldCurses = fingerprint.curses;
    const allEntries = meta.upgradeEntries!;
    const advancedTags = new Set(
        getCurrentRivenContract(meta)
            ?.entries.filter(entry => entry.isAdvancedTrait)
            .map(entry => entry.tag) ?? []
    );
    const stats = [...oldBuffs, ...oldCurses];
    for (const tag of lockedTagSet) {
        if (!stats.some(stat => stat.Tag === tag)) throw new Error(`Cannot lock absent Riven trait ${tag}`);
    }
    const fixedLayout = lockedTagSet.size !== 0;

    const lockedCurse = oldCurses.find(
        stat => lockedTagSet.has(stat.Tag) && allEntries.some(entry => entry.canBeCurse && entry.tag == stat.Tag)
    );
    const lockedBuffs = oldBuffs
        .filter(
            stat =>
                lockedTagSet.has(stat.Tag) &&
                stat.Tag != lockedCurse?.Tag &&
                allEntries.some(entry => entry.canBeBuff && entry.tag == stat.Tag)
        )
        .slice(0, 3);

    fingerprint.buffs = [...lockedBuffs];
    const numBuffs = fixedLayout
        ? oldBuffs.length
        : Math.max(fingerprint.buffs.length, 2 + Math.trunc(Math.random() * 2)); // 2 or 3
    const buffEntries = allEntries.filter(
        entry =>
            entry.canBeBuff &&
            !advancedTags.has(entry.tag) &&
            isRivenTraitAllowed(meta, entry.tag, false, fingerprint) &&
            entry.tag != lockedCurse?.Tag &&
            !fingerprint.buffs.some(stat => stat.Tag == entry.tag)
    );
    for (let i = 0; i != numBuffs; ++i) {
        if (fingerprint.buffs.length >= numBuffs || buffEntries.length == 0) {
            break;
        }
        const buffIndex = Math.trunc(Math.random() * buffEntries.length);
        const entry = buffEntries[buffIndex];
        fingerprint.buffs.push({ Tag: entry.tag, Value: Math.trunc(Math.random() * 0x40000000) });
        buffEntries.splice(buffIndex, 1);
    }

    fingerprint.curses = lockedCurse ? [lockedCurse] : [];
    if (!lockedCurse && (fixedLayout ? oldCurses.length !== 0 : Math.random() < 0.5)) {
        const entry = getRandomElement(
            allEntries.filter(
                x =>
                    x.canBeCurse &&
                    !advancedTags.has(x.tag) &&
                    isRivenTraitAllowed(meta, x.tag, true, fingerprint) &&
                    !fingerprint.buffs.find(y => y.Tag == x.tag)
            )
        );
        if (!entry) throw new Error(`No legal negative Riven trait available for compat ${fingerprint.compat}`);
        fingerprint.curses.push({ Tag: entry.tag, Value: Math.trunc(Math.random() * 0x40000000) });
    }
};

export const rivenRawToRealWeighted: Record<string, string[]> = {
    "/Lotus/Upgrades/Mods/Randomized/RawArchgunRandomMod": [
        "/Lotus/Upgrades/Mods/Randomized/LotusArchgunRandomModRare"
    ],
    "/Lotus/Upgrades/Mods/Randomized/RawMeleeRandomMod": [
        "/Lotus/Upgrades/Mods/Randomized/PlayerMeleeWeaponRandomModRare"
    ],
    "/Lotus/Upgrades/Mods/Randomized/RawModularMeleeRandomMod": [
        "/Lotus/Upgrades/Mods/Randomized/LotusModularMeleeRandomModRare"
    ],
    "/Lotus/Upgrades/Mods/Randomized/RawModularPistolRandomMod": [
        "/Lotus/Upgrades/Mods/Randomized/LotusModularPistolRandomModRare"
    ],
    "/Lotus/Upgrades/Mods/Randomized/RawPistolRandomMod": ["/Lotus/Upgrades/Mods/Randomized/LotusPistolRandomModRare"],
    "/Lotus/Upgrades/Mods/Randomized/RawRifleRandomMod": ["/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare"],
    "/Lotus/Upgrades/Mods/Randomized/RawShotgunRandomMod": [
        "/Lotus/Upgrades/Mods/Randomized/LotusShotgunRandomModRare"
    ],
    "/Lotus/Upgrades/Mods/Randomized/RawSentinelWeaponRandomMod": [
        "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare",
        "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare",
        "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare",
        "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare",
        "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare",
        "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare",
        "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare",
        "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare",
        "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare",
        "/Lotus/Upgrades/Mods/Randomized/LotusShotgunRandomModRare",
        "/Lotus/Upgrades/Mods/Randomized/LotusPistolRandomModRare",
        "/Lotus/Upgrades/Mods/Randomized/PlayerMeleeWeaponRandomModRare"
    ]
};
