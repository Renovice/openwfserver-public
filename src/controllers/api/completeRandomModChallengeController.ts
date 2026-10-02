import type { RequestHandler } from "express";
import { getAccountIdForRequest } from "../../services/loginService.ts";
import { addMiscItems, getInventory, updatePlatinum } from "../../services/inventoryService.ts";
import type { IInventoryChanges } from "../../types/purchaseTypes.ts";
import type { IMiscItem } from "../../types/inventoryTypes/inventoryTypes.ts";
import { getJSONfromString } from "../../helpers/stringHelpers.ts";
import { ExportUpgrades } from "warframe-public-export-plus";
import {
    getEquippedWeaponCompatForRiven,
    setRevealCompatPreference,
    type IVeiledRivenFingerprint
} from "../../helpers/rivenHelper.ts";

export const completeRandomModChallengeController: RequestHandler = async (req, res) => {
    const accountId = await getAccountIdForRequest(req);
    const inventory = await getInventory(
        accountId,
        "infinitePlatinum PremiumCreditsFree PremiumCredits MiscItems Upgrades accountOwnerId CurrentLoadOutIds LongGuns Pistols Melee SpaceGuns SentinelWeapons"
    );
    const request = getJSONfromString<ICompleteRandomModChallengeRequest>(String(req.body));
    let inventoryChanges: IInventoryChanges = {};

    // Remove 20 plat or riven cipher
    if ((req.query.p as string) == "1") {
        inventoryChanges = { ...updatePlatinum(inventory, 20) };
    } else {
        const miscItemChanges: IMiscItem[] = [
            {
                ItemType: "/Lotus/Types/Items/MiscItems/RivenIdentifier",
                ItemCount: -1
            }
        ];
        addMiscItems(inventory, miscItemChanges);
        inventoryChanges.MiscItems = miscItemChanges;
    }

    // Complete the riven challenge
    const upgrade = inventory.Upgrades.id(request.ItemId)!;
    const fp = JSON.parse(upgrade.UpgradeFingerprint!) as IVeiledRivenFingerprint;

    // Capture the equipped weapon NOW, while the veiled riven is still slotted on it (the client strips it right
    // after the cipher click). Stash the compat so the unveil in rerollRandomMod can prefer it. This does NOT
    // unveil the riven -- the challenge stays veiled + complete, so the reveal animation is untouched.
    const meta = ExportUpgrades[upgrade.ItemType];
    const capturedCompat = await getEquippedWeaponCompatForRiven(
        inventory,
        upgrade._id.toString(),
        meta.compatibleItems ?? []
    );
    if (capturedCompat) {
        setRevealCompatPreference(upgrade._id.toString(), capturedCompat);
    }

    fp.challenge.Progress = fp.challenge.Required;
    upgrade.UpgradeFingerprint = JSON.stringify(fp);

    await inventory.save();

    res.json({
        InventoryChanges: inventoryChanges,
        Fingerprint: upgrade.UpgradeFingerprint
    });
};

interface ICompleteRandomModChallengeRequest {
    ItemId: string;
}
