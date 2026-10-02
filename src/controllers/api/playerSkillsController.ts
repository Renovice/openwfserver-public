import { getJSONfromString } from "../../helpers/stringHelpers.ts";
import { addConsumables, getInventory } from "../../services/inventoryService.ts";
import { getAccountIdForRequest } from "../../services/loginService.ts";
import type { IPlayerSkills } from "../../types/inventoryTypes/inventoryTypes.ts";
import type { IInventoryChanges } from "../../types/purchaseTypes.ts";
import type { RequestHandler } from "express";
import { Inventory } from "../../models/inventoryModels/inventoryModel.ts";
import { logger } from "../../utils/logger.ts";

const playerSkillPools = {
    LPS_PILOTING: "LPP_SPACE",
    LPS_GUNNERY: "LPP_SPACE",
    LPS_TACTICAL: "LPP_SPACE",
    LPS_ENGINEERING: "LPP_SPACE",
    LPS_COMMAND: "LPP_SPACE",
    LPS_DRIFT_COMBAT: "LPP_DRIFTER",
    LPS_DRIFT_RIDING: "LPP_DRIFTER",
    LPS_DRIFT_OPPORTUNITY: "LPP_DRIFTER",
    LPS_DRIFT_ENDURANCE: "LPP_DRIFTER"
} as const satisfies Partial<Record<keyof IPlayerSkills, keyof IPlayerSkills>>;

type TUpgradeablePlayerSkill = keyof typeof playerSkillPools;

export const playerSkillsController: RequestHandler = async (req, res) => {
    const accountId = await getAccountIdForRequest(req);
    const inventory = await getInventory(accountId, "PlayerSkills Consumables");
    const request = getJSONfromString<IPlayerSkillsRequest>(String(req.body));

    if (!isUpgradeablePlayerSkill(request.Skill)) {
        logger.warn(`rejecting unknown player skill upgrade: ${request.Skill}`);
        res.status(400).json({ Error: "INVALID_PLAYER_SKILL" });
        return;
    }

    const skill = request.Skill;
    const pool = playerSkillPools[skill];
    if (request.Pool != pool) {
        logger.warn(`rejecting player skill ${skill} with invalid pool ${request.Pool}; expected ${pool}`);
        res.status(400).json({ Error: "INVALID_PLAYER_SKILL_POOL" });
        return;
    }

    const oldRank = inventory.PlayerSkills[skill];
    const maxRank = pool == "LPP_DRIFTER" ? drifterCosts.length : 10;
    if (!Number.isInteger(oldRank) || oldRank < 0 || oldRank >= maxRank) {
        logger.warn(`rejecting player skill ${skill} upgrade from invalid or maximum rank ${oldRank}`);
        res.status(409).json({ Error: "INVALID_PLAYER_SKILL_RANK", Skill: skill, Rank: oldRank });
        return;
    }

    const cost = (pool == "LPP_DRIFTER" ? drifterCosts[oldRank] : 1 << oldRank) * 1000;
    const poolBalance = inventory.PlayerSkills[pool];
    if (!Number.isFinite(poolBalance) || poolBalance < cost) {
        logger.warn(
            `rejecting unaffordable player skill ${skill} rank ${oldRank + 1}: balance ${poolBalance}, cost ${cost}`
        );
        res.status(409).json({
            Error: "INSUFFICIENT_PLAYER_SKILL_POINTS",
            Pool: pool,
            PoolBalance: poolBalance,
            Skill: skill,
            Rank: oldRank,
            Cost: cost
        });
        return;
    }

    // Rank and balance are guarded in the same database update. This prevents
    // overlapping or stale menu requests from spending the same starting rank.
    const updatedInventory = await Inventory.findOneAndUpdate(
        {
            _id: inventory._id,
            [`PlayerSkills.${skill}`]: oldRank,
            [`PlayerSkills.${pool}`]: { $gte: cost }
        },
        {
            $inc: {
                [`PlayerSkills.${skill}`]: 1,
                [`PlayerSkills.${pool}`]: -cost
            }
        },
        { new: true, projection: "PlayerSkills Consumables" }
    );

    if (!updatedInventory) {
        logger.warn(`rejected stale concurrent player skill ${skill} rank ${oldRank + 1} transaction`);
        res.status(409).json({ Error: "STALE_PLAYER_SKILL_TRANSACTION" });
        return;
    }

    const inventoryChanges: IInventoryChanges = {};
    if (skill == "LPS_COMMAND") {
        if (updatedInventory.PlayerSkills.LPS_COMMAND == 9) {
            const consumablesChanges = [
                {
                    ItemType: "/Lotus/Types/Restoratives/Consumable/CrewmateBall",
                    ItemCount: 1
                }
            ];
            addConsumables(updatedInventory, consumablesChanges);
            inventoryChanges.Consumables = consumablesChanges;
        }
    } else if (skill == "LPS_DRIFT_RIDING") {
        if (updatedInventory.PlayerSkills.LPS_DRIFT_RIDING == 9) {
            const consumablesChanges = [
                {
                    ItemType: "/Lotus/Types/Restoratives/ErsatzSummon",
                    ItemCount: 1
                }
            ];
            addConsumables(updatedInventory, consumablesChanges);
            inventoryChanges.Consumables = consumablesChanges;
        }
    }

    if (updatedInventory.isModified()) {
        await updatedInventory.save();
    }
    res.json({
        Pool: pool,
        PoolInc: -cost,
        Skill: skill,
        Rank: oldRank + 1,
        InventoryChanges: inventoryChanges
    });
};

const isUpgradeablePlayerSkill = (skill: string): skill is TUpgradeablePlayerSkill => skill in playerSkillPools;

interface IPlayerSkillsRequest {
    Pool: string;
    Skill: string;
}

const drifterCosts = [20, 25, 30, 45, 65, 90, 125, 160, 205, 255];
