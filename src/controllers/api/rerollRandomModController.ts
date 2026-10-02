import type { RequestHandler } from "express";
import { getAccountForRequest, getBuildLabel } from "../../services/loginService.ts";
import { addMiscItems, getInventory } from "../../services/inventoryService.ts";
import { getJSONfromString } from "../../helpers/stringHelpers.ts";
import type { LockedRivenStatTags, RivenFingerprint } from "../../helpers/rivenHelper.ts";
import {
    clearRevealCompatPreference,
    createUnveiledRivenFingerprint,
    getEquippedWeaponCompatForRiven,
    getRevealCompatPreference,
    randomiseRivenStats,
    resolveRivenCycleLocks
} from "../../helpers/rivenHelper.ts";
import { ExportUpgrades, type IUpgrade } from "warframe-public-export-plus";
import { getCurrentRivenContract } from "../../services/currentPublicExportService.ts";
import type { IOidWithLegacySupport } from "../../types/commonTypes.ts";
import { toObjectId, toOid2 } from "../../helpers/inventoryHelpers.ts";
import { getPrivateServerTuning } from "../../services/privateServerTuningService.ts";

export const rerollRandomModController: RequestHandler = async (req, res) => {
    const account = await getAccountForRequest(req);
    const request = getJSONfromString<RerollRandomModRequest>(String(req.body));
    if ("ItemIds" in request) {
        const buildLabel = getBuildLabel(req, account);
        const tuning = getPrivateServerTuning(account);
        const inventory = await getInventory(
            account._id,
            "Upgrades MiscItems dontSubtractKuvaForRivens accountOwnerId CurrentLoadOutIds LongGuns Pistols Melee SpaceGuns SentinelWeapons"
        );
        const changes: IChange[] = [];
        let totalKuvaCost = 0;
        for (const itemId of request.ItemIds) {
            const upgrade = inventory.Upgrades.id(itemId)!;
            const fingerprint = JSON.parse(upgrade.UpgradeFingerprint!) as RivenFingerprint;
            if ("challenge" in fingerprint) {
                const meta = ExportUpgrades[upgrade.ItemType];
                // Prefer the weapon captured at cipher-time (before the client stripped the riven off it); fall
                // back to a live lookup for the in-mission path where the riven is still slotted at reveal.
                const storedCompat = getRevealCompatPreference(upgrade._id.toString());
                const preferredCompat = tuning?.preferEquippedWeaponOnRivenReveal
                    ? (storedCompat ??
                      (await getEquippedWeaponCompatForRiven(
                          inventory,
                          upgrade._id.toString(),
                          meta.compatibleItems ?? []
                      )))
                    : undefined;
                clearRevealCompatPreference(upgrade._id.toString());
                upgrade.UpgradeFingerprint = JSON.stringify(
                    createUnveiledRivenFingerprint(meta, fingerprint.IsSentinel, preferredCompat)
                );
            } else {
                const meta = ExportUpgrades[upgrade.ItemType];
                const lock = resolveRivenCycleLocks(
                    meta,
                    fingerprint,
                    getNativeLockedTraits(request, itemId, meta),
                    getTagsFromPayload(request.UnlockedAdvancedTags, itemId)
                );
                fingerprint.rerolls ??= 0;
                if (!inventory.dontSubtractKuvaForRivens) {
                    const kuvaCost =
                        (fingerprint.rerolls < rerollCosts.length ? rerollCosts[fingerprint.rerolls] : 3500) *
                        lock.costMultiplier;
                    const kuva = "/Lotus/Types/Items/MiscItems/Kuva";
                    if ((inventory.MiscItems.find(item => item.ItemType === kuva)?.ItemCount ?? 0) < kuvaCost) {
                        throw new Error("Insufficient Kuva for Riven cycle");
                    }
                    totalKuvaCost += kuvaCost;
                    addMiscItems(inventory, [{ ItemType: kuva, ItemCount: -kuvaCost }]);
                }
                fingerprint.rerolls++;
                upgrade.UpgradeFingerprint = JSON.stringify(fingerprint);
                randomiseRivenStats(ExportUpgrades[upgrade.ItemType], fingerprint, lock.tags);
                upgrade.PendingRerollFingerprint = JSON.stringify(fingerprint);
            }

            changes.push({
                ItemId: toOid2(toObjectId(itemId), buildLabel),
                UpgradeFingerprint: upgrade.UpgradeFingerprint,
                PendingRerollFingerprint: upgrade.PendingRerollFingerprint
            });
        }

        await inventory.save();

        res.json({
            changes: changes,
            cost: totalKuvaCost
        });
    } else {
        const inventory = await getInventory(account._id, "Upgrades");
        const upgrade = inventory.Upgrades.id(request.ItemId)!;
        if (request.CommitReroll && upgrade.PendingRerollFingerprint) {
            upgrade.UpgradeFingerprint = upgrade.PendingRerollFingerprint;
        }
        upgrade.PendingRerollFingerprint = undefined;
        await inventory.save();
        res.send(upgrade.UpgradeFingerprint);
    }
};

type RerollRandomModRequest = LetsGoGamblingRequest | AwDangitRequest;

interface LetsGoGamblingRequest {
    ItemIds: string[];
    /** Native U44 trait lock, e.g. {"ItemIds":["..."],"LockedTraits":["WeaponFireIterationsMod"]}. */
    LockedTraits?: TagPayload;
    /** Spliced traits released from their automatic lock so they can be cycled off. */
    UnlockedAdvancedTags?: TagPayload;
}

interface AwDangitRequest {
    ItemId: string;
    CommitReroll: boolean;
}

interface IChange {
    ItemId: IOidWithLegacySupport;
    UpgradeFingerprint?: string;
    PendingRerollFingerprint?: string;
}

const rerollCosts = [900, 1000, 1200, 1400, 1700, 2000, 2350, 2750, 3150];

type TagPayload = readonly string[] | Record<string, unknown>;

// Trait locking through the native UI (client module 477479ee5209dc94 allows up to 4 manual locks; vanilla allows 1).
// Cost is x2 per manual lock (resolveRivenCycleLocks). Spliced (advanced) traits are locked automatically and
// do not count towards this limit or the surcharge.
const maxNativeLockedTraits = 4;

// The client also lists the automatically locked spliced trait in LockedTraits; only manual locks count.
const getNativeLockedTraits = (
    request: LetsGoGamblingRequest,
    itemId: string,
    meta: IUpgrade
): LockedRivenStatTags => {
    const tags = [...new Set(getTagsFromPayload(request.LockedTraits, itemId))];
    const advanced = new Set(
        getCurrentRivenContract(meta)
            ?.entries.filter(entry => entry.isAdvancedTrait)
            .map(entry => entry.tag) ?? []
    );
    if (tags.filter(tag => !advanced.has(tag)).length > maxNativeLockedTraits) {
        throw new Error(
            `At most ${maxNativeLockedTraits} Riven traits can be locked per cycle (received ${tags.join(", ")})`
        );
    }
    return tags;
};

const getTagsFromPayload = (payload: TagPayload | undefined, itemId: string): string[] => {
    if (!payload) return [];
    const value = Array.isArray(payload) ? payload : (payload as Record<string, unknown>)[itemId];
    if (typeof value == "string") return [value].filter(Boolean);
    if (!Array.isArray(value)) return [];
    return value.filter((tag): tag is string => typeof tag == "string" && tag.length != 0);
};
