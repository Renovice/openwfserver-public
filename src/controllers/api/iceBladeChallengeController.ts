import type { RequestHandler } from "express";
import { Types } from "mongoose";
import { Inventory } from "../../models/inventoryModels/inventoryModel.ts";
import { Loadout } from "../../models/inventoryModels/loadoutModel.ts";
import { addItem, getInventory } from "../../services/inventoryService.ts";
import { getAccountIdForRequest } from "../../services/loginService.ts";

export const ICE_BLADE_REWARDS = [
    "/Lotus/Upgrades/Skins/Weapons/Rapier/IcebladeRapierSkin",
    "/Lotus/Types/Items/Titles/IcebladeTitle"
] as const;
export const ICE_BLADE_KEYS = ["Damage", "Health", "Shield", "Speed"].map(
    key => `/Lotus/Types/Restoratives/Upgraded/${key}DebuffKey`
);

// RECONSTRUCTED eligibility, explicitly authorized for this private server.
// Client response fields are verified; DE's hidden server predicate is not.
// See Documentation/06-Metadata-and-Server/U44-Missing-Endpoints-2026-09-27.md.
export const iceBladeChallengeController: RequestHandler = async (req, res) => {
    const accountId = await getAccountIdForRequest(req);
    const inventory = await getInventory(
        accountId,
        "PlayerLevel spoofMasteryRank noBlessingCooldown BlessingCooldown iceBladeChallengeCompleted " +
            "CurrentLoadOutIds Suits EquippedGear TitleType NodeIntrosCompleted WeaponSkins FlavourItems"
    );
    const rank = (inventory.spoofMasteryRank ?? -1) >= 0 ? inventory.spoofMasteryRank! : inventory.PlayerLevel;
    const GrantBlessing =
        rank >= 30 &&
        (inventory.noBlessingCooldown === true ||
            !inventory.BlessingCooldown ||
            inventory.BlessingCooldown <= new Date());
    if (inventory.iceBladeChallengeCompleted) {
        res.json({ Completed: true, GrantBlessing });
        return;
    }
    const loadout = await Loadout.findOne({ loadoutOwnerId: accountId }, "NORMAL");
    const selection = inventory.CurrentLoadOutIds[0] && loadout?.NORMAL.id(inventory.CurrentLoadOutIds[0])?.s;
    const appearanceIndex = selection ? (selection.cus ?? 0) : 0;
    const selectedId = selection?.ItemId;
    const suit = selectedId && inventory.Suits.id("$oid" in selectedId ? selectedId.$oid : selectedId);
    const shards = suit?.ArchonCrystalUpgrades ?? [];
    const eligible =
        rank >= 31 &&
        suit?.ItemType === "/Lotus/Powersuits/Duelist/Duelist" &&
        shards.length === 5 &&
        shards.every(s => s.UpgradeType && (s.Color === "ACC_BLUE" || s.Color === "ACC_BLUE_MYTHIC")) &&
        ICE_BLADE_KEYS.every(key => inventory.EquippedGear.includes(key)) &&
        inventory.TitleType === "/Lotus/Types/Items/Titles/NarinTitle" &&
        inventory.NodeIntrosCompleted.includes("NarinPoemPoster");
    if (!eligible) {
        res.json({ Completed: false, GrantBlessing });
        return;
    }

    // Use ordinary acquisition validation, then commit rewards and completion in
    // one atomic document update. Retry/concurrent sword pulls cannot double grant.
    const Rewards: string[] = [];
    const set: Record<string, unknown> = { iceBladeChallengeCompleted: true };
    for (const item of ICE_BLADE_REWARDS) {
        const changes = await addItem(inventory, item, 1);
        const category = changes.WeaponSkins?.length
            ? "WeaponSkins"
            : changes.FlavourItems?.length
              ? "FlavourItems"
              : undefined;
        if (!category) continue;
        Rewards.push(item);
        const entry =
            category === "WeaponSkins"
                ? { _id: new Types.ObjectId(), ItemType: item, IsNew: true }
                : { ItemType: item };
        set[category] = {
            $cond: [
                { $in: [item, { $ifNull: [`$${category}.ItemType`, []] }] },
                `$${category}`,
                { $concatArrays: [{ $ifNull: [`$${category}`, []] }, { $literal: [entry] }] }
            ]
        };
    }
    const result = await Inventory.updateOne(
        { _id: inventory._id, iceBladeChallengeCompleted: { $ne: true } },
        [{ $set: set }],
        { updatePipeline: true }
    );
    if (!result.modifiedCount) {
        res.json({ Completed: true, GrantBlessing });
        return;
    }
    // Completed means previously completed: first success updates the local statue.
    res.json({
        Completed: false,
        GrantBlessing,
        Rewards,
        Loadout: { ItemType: suit.ItemType, Skins: suit.Configs[appearanceIndex]?.Skins ?? [] }
    });
};
