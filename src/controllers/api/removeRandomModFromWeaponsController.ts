import type { RequestHandler } from "express";
import { getInventory } from "../../services/inventoryService.ts";
import { getAccountIdForRequest } from "../../services/loginService.ts";
import { broadcastInventoryUpdate } from "../../services/wsService.ts";
import { getJSONfromString } from "../../helpers/stringHelpers.ts";
import type { TEquipmentKey } from "../../types/inventoryTypes/inventoryTypes.ts";
import type { IEquipmentClient } from "../../types/equipmentTypes.ts";
import type { IInventoryChanges } from "../../types/purchaseTypes.ts";

// After revealing a riven that was equipped on a weapon, the client asks us to pull it back off -- it becomes a loose
// riven in the inventory to re-slot. We honour that: drop the named upgradeId from the weapon's config so the mod
// capacity stays correct (leaving it on is what caused the negative-capacity + shuffle). We filter by upgradeId
// rather than trusting the request's `upgrades` array, so only the riven is removed and the rest of the build + its
// order are preserved.
export const removeRandomModFromWeaponsController: RequestHandler = async (req, res) => {
    const accountId = await getAccountIdForRequest(req);
    const request = getJSONfromString<IRemoveRandomModFromWeaponsRequest>(String(req.body));
    const categories = [...new Set(request.RemoveInfo.map(info => info.category))];
    const inventory = await getInventory(accountId, categories.join(" "));
    const inventoryChanges: IInventoryChanges = {};
    for (const info of request.RemoveInfo) {
        const item = inventory[info.category].id(info.weaponId);
        const config = item?.Configs[info.configIdx];
        if (config?.Upgrades) {
            // Blank ONLY the riven's slot IN PLACE. Do NOT filter/compact -- that shifts every later mod into the
            // wrong slot (which corrupted the build, capacity, stance + arcane). "" = empty slot; positions preserved.
            config.Upgrades = config.Upgrades.map(id => (id.toString() == info.upgradeId ? "" : id));
        }
        if (item) {
            // Echo the updated weapon back so the client reflects the removal + recomputes capacity live (not just
            // after a relog). Server-authoritative config changes return InventoryChanges, never a bare {}.
            ((inventoryChanges as Record<string, IEquipmentClient[]>)[info.category] ??= []).push(
                item.toJSON<IEquipmentClient>()
            );
        }
    }
    await inventory.save();
    res.json({ InventoryChanges: inventoryChanges });
    broadcastInventoryUpdate(req);
};

interface IRemoveRandomModFromWeaponsRequest {
    RemoveInfo: {
        category: TEquipmentKey;
        weaponId: string;
        configIdx: number;
        upgradeId: string;
        upgrades: string[];
    }[];
}
