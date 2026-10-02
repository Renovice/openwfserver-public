import type { RequestHandler } from "express";
import { Types } from "mongoose";
import { ExportUpgrades } from "warframe-public-export-plus";
import { getAccountIdForRequest } from "../../services/loginService.ts";
import { getInventory } from "../../services/inventoryService.ts";
import { Inventory } from "../../models/inventoryModels/inventoryModel.ts";
import {
    getRivenSpliceRecipes,
    spliceRiven,
    validateSpliceFingerprint,
    RIVEN_SPLICER,
    RIVEN_SPLICE_COST
} from "../../helpers/rivenSpliceHelper.ts";
import type { IUnveiledRivenFingerprint } from "../../helpers/rivenHelper.ts";

// Custom backend contract only. Native DE UI/request wiring is deliberately separate.
export const spliceRivenController: RequestHandler = async (req, res) => {
    const accountId = await getAccountIdForRequest(req);
    const request = req.body as
        | { action?: string; itemId?: string; recipeId?: string; expectedFingerprint?: string }
        | undefined;
    if (
        !request ||
        !["preview", "commit"].includes(request.action ?? "") ||
        typeof request.itemId !== "string" ||
        !/^[0-9a-f]{24}$/i.test(request.itemId)
    ) {
        res.status(400).json({ error: "Expected preview/commit action and owned Riven itemId" });
        return;
    }
    const inventory = await getInventory(accountId, "Upgrades MiscItems");
    const upgrade = inventory.Upgrades.id(request.itemId);
    if (!upgrade?.UpgradeFingerprint || !Object.hasOwn(ExportUpgrades, upgrade.ItemType)) {
        res.status(404).json({ error: "Riven not owned" });
        return;
    }
    if (upgrade.PendingRerollFingerprint !== undefined) {
        res.status(409).json({ error: "Resolve the pending reroll before splicing" });
        return;
    }
    const before = upgrade.UpgradeFingerprint;
    const meta = ExportUpgrades[upgrade.ItemType];
    let fp: IUnveiledRivenFingerprint;
    try {
        fp = JSON.parse(before) as IUnveiledRivenFingerprint;
        validateSpliceFingerprint(meta, fp);
    } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : "Invalid Riven" });
        return;
    }
    const ownedTags = new Set([...fp.buffs, ...fp.curses].map(s => s.Tag));
    const recipes = getRivenSpliceRecipes(meta).map(r => ({
        ...r,
        eligible: r.available && ownedTags.has(r.primaryIngredient) && ownedTags.has(r.secondaryIngredient)
    }));
    const splicers = inventory.MiscItems.filter(item => item.ItemType === RIVEN_SPLICER);
    const count = splicers.length === 1 ? splicers[0].ItemCount : 0;
    if (request.action === "preview") {
        res.json({
            itemId: request.itemId,
            expectedFingerprint: before,
            recipes,
            cost: { ItemType: RIVEN_SPLICER, ItemCount: RIVEN_SPLICE_COST },
            ownedSplicers: count,
            qualityPolicy: "higher-encoded-quality",
            nativeMenuWired: false
        });
        return;
    }
    if (request.expectedFingerprint !== before) {
        res.status(409).json({ error: "Riven changed; request a new preview" });
        return;
    }
    if (!Number.isInteger(count) || count < RIVEN_SPLICE_COST) {
        res.status(409).json({ error: "Insufficient Riven Splicers" });
        return;
    }
    let next: IUnveiledRivenFingerprint;
    try {
        next = spliceRiven(meta, fp, request.recipeId ?? "");
    } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : "Invalid splice" });
        return;
    }
    const after = JSON.stringify(next);
    // Single-document atomic debit + mutation. Concurrent/replayed commits cannot
    // spend a second splicer or overwrite a newer fingerprint/pending reroll.
    const result = await Inventory.updateOne(
        {
            _id: inventory._id,
            accountOwnerId: new Types.ObjectId(accountId),
            Upgrades: {
                $elemMatch: {
                    _id: upgrade._id,
                    UpgradeFingerprint: before,
                    PendingRerollFingerprint: { $exists: false }
                }
            },
            MiscItems: { $elemMatch: { ItemType: RIVEN_SPLICER, ItemCount: { $gte: RIVEN_SPLICE_COST } } }
        },
        {
            $set: { "Upgrades.$[riven].UpgradeFingerprint": after },
            $inc: { "MiscItems.$[splicer].ItemCount": -RIVEN_SPLICE_COST }
        },
        { arrayFilters: [{ "riven._id": upgrade._id }, { "splicer.ItemType": RIVEN_SPLICER }] }
    );
    if (result.modifiedCount !== 1) {
        res.status(409).json({ error: "Inventory changed; no splice was applied" });
        return;
    }
    res.json({
        itemId: request.itemId,
        UpgradeFingerprint: after,
        cost: { ItemType: RIVEN_SPLICER, ItemCount: RIVEN_SPLICE_COST }
    });
};
