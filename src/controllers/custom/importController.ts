import { importInventory, importLoadOutPresets, importPersonalRooms } from "../../services/importService.ts";
import { ensureUserHasFounderHonoria, getInventory } from "../../services/inventoryService.ts";
import { getLoadout } from "../../services/loadoutService.ts";
import { getAccountForRequest, hasPermission } from "../../services/loginService.ts";
import { getPersonalRooms } from "../../services/personalRoomsService.ts";
import { broadcastInventoryUpdate } from "../../services/wsService.ts";
import { fromOid } from "../../helpers/inventoryHelpers.ts";
import { Ship } from "../../models/shipModel.ts";
import { PendingTrade } from "../../models/tradingModel.ts";
import { Types } from "mongoose";
import type { IInventoryClient } from "../../types/inventoryTypes/inventoryTypes.ts";
import type { IShipInventory } from "../../types/inventoryTypes/inventoryTypes.ts";
import type { IGetShipResponse } from "../../types/personalRoomsTypes.ts";
import type { IPendingTradeClient, ITradeOffer } from "../../types/tradingTypes.ts";
import type { RequestHandler } from "express";

export const importController: RequestHandler = async (req, res) => {
    const account = await getAccountForRequest(req);
    if (!hasPermission(account, "import")) {
        res.status(500).send(`Permission denied`).end();
        return;
    }
    const request = req.body as IImportRequest;

    let anyKnownKey = false;
    try {
        const inventory = await getInventory(account._id, undefined);
        importInventory(inventory, request.inventory);
        const activeImportedShipId =
            "Ships" in request.inventory && request.inventory.Ships
                ? await importShips(account._id, inventory.Ships, request.inventory.Ships)
                : undefined;
        if (inventory.isModified()) {
            anyKnownKey = true;
            if (inventory.Founder) {
                await ensureUserHasFounderHonoria(inventory);
            }
            await inventory.save();
        }

        if ("LoadOutPresets" in request.inventory && request.inventory.LoadOutPresets) {
            const loadout = await getLoadout(account._id);
            importLoadOutPresets(loadout, request.inventory.LoadOutPresets);
            if (loadout.isModified()) {
                anyKnownKey = true;
                await loadout.save();
            }
        }

        if ("PendingTrades" in request.inventory && request.inventory.PendingTrades) {
            await importPendingTrades(account._id, request.inventory.PendingTrades);
            anyKnownKey = true;
        }

        if (
            request.inventory.Ship?.Rooms || // very old accounts may have Ship with { Features: [ ... ] }
            request.inventory.Ship?.Features ||
            "Apartment" in request.inventory ||
            "TailorShop" in request.inventory
        ) {
            const personalRooms = await getPersonalRooms(account._id);
            importPersonalRooms(personalRooms, request.inventory);
            if (activeImportedShipId && !personalRooms.activeShipId.equals(activeImportedShipId)) {
                personalRooms.activeShipId = activeImportedShipId;
            }
            if (personalRooms.isModified()) {
                anyKnownKey = true;
                await personalRooms.save();
            }
        } else if (activeImportedShipId) {
            const personalRooms = await getPersonalRooms(account._id);
            if (!personalRooms.activeShipId.equals(activeImportedShipId)) {
                personalRooms.activeShipId = activeImportedShipId;
                anyKnownKey = true;
                await personalRooms.save();
            }
        }

        if (!anyKnownKey) {
            res.send("noKnownKey").end();
        }

        broadcastInventoryUpdate(req);
    } catch (e) {
        console.error(e);
        res.send((e as Error).message);
    }
    res.end();
};

interface IImportRequest {
    inventory: Partial<IInventoryClient> | Partial<IGetShipResponse>;
}

const importShips = async (
    accountId: Types.ObjectId,
    inventoryShipIds: Types.DocumentArray<Types.ObjectId> | Types.ObjectId[],
    clientShips: IShipInventory[]
): Promise<Types.ObjectId | undefined> => {
    const importedShipIds = clientShips.map(ship => new Types.ObjectId(fromOid(ship.ItemId)));
    inventoryShipIds.splice(0, inventoryShipIds.length, ...importedShipIds);

    for (const clientShip of clientShips) {
        const shipId = new Types.ObjectId(fromOid(clientShip.ItemId));
        const ship = await Ship.findById(shipId);
        if (ship && !ship.ShipOwnerId.equals(accountId)) {
            throw new Error(`ship ${shipId.toString()} belongs to another account`);
        }

        await Ship.updateOne(
            { _id: shipId },
            {
                $set: {
                    ItemType: clientShip.ItemType,
                    ShipOwnerId: accountId,
                    ShipExteriorColors: clientShip.ShipExterior?.Colors,
                    ShipAttachments: clientShip.ShipExterior?.ShipAttachments,
                    SkinFlavourItem: clientShip.ShipExterior?.SkinFlavourItem,
                    AirSupportPower: clientShip.AirSupportPower
                }
            },
            { upsert: true }
        );
    }

    if (importedShipIds.length) {
        await Ship.deleteMany({ ShipOwnerId: accountId, _id: { $nin: importedShipIds } });
    }

    return importedShipIds[0];
};

const importPendingTrades = async (accountId: Types.ObjectId, clientTrades: IPendingTradeClient[]): Promise<void> => {
    await PendingTrade.deleteMany({ $or: [{ a: accountId }, { b: accountId }] });
    if (clientTrades.length == 0) {
        return;
    }

    await PendingTrade.insertMany(
        clientTrades.map(clientTrade => {
            const buddyId = new Types.ObjectId(fromOid(clientTrade.ItemId));
            return {
                a: accountId,
                b: buddyId,
                aOffer: normalizeTradeOffer(clientTrade.Giving),
                bOffer: normalizeTradeOffer(clientTrade.Getting),
                aReady: clientTrade.SelfReady,
                bReady: clientTrade.BuddyReady,
                aAccepted: clientTrade.State >= 3,
                bAccepted: clientTrade.State >= 4,
                importedState: clientTrade.State,
                importedClient: clientTrade,
                revision: clientTrade.Revision,
                clanTax: clientTrade.ClanTax ?? 0
            };
        })
    );
};

const normalizeTradeOffer = (offer: ITradeOffer | undefined): ITradeOffer => {
    return offer ?? { _SlotOrderInfo: ["", "", "", "", "", ""] };
};
