import type { TInventoryDatabaseDocument } from "../models/inventoryModels/inventoryModel.ts";
import type { IVoidTearParticipantInfo, IVoidTearWaveInfo } from "../types/requestTypes.ts";
import type { TRarity } from "warframe-public-export-plus";
import { ExportRelics, ExportRewards } from "warframe-public-export-plus";
import type { IRngResult } from "../services/rngService.ts";
import { getRandomWeightedReward } from "../services/rngService.ts";
import { logger } from "../utils/logger.ts";
import { addItem, addMiscItems, combineInventoryChanges } from "../services/inventoryService.ts";
import type { IInventoryChanges } from "../types/purchaseTypes.ts";
import type { ITypeCount } from "../types/commonTypes.ts";
import { fromStoreItem } from "../services/itemDataService.ts";
import type { TPrivateServerTuning } from "../services/privateServerTuningService.ts";

type TRelicReward = IRngResult & { rarity: TRarity };
type TCrackedRelicReward = TRelicReward & { grantedRewards: TRelicReward[] };

export const getGrantedRelicRewardTypeCounts = (reward: TCrackedRelicReward): ITypeCount[] => {
    return reward.grantedRewards.map(grantedReward => ({
        ItemType: grantedReward.type,
        ItemCount: grantedReward.itemCount
    }));
};

export const getPendingMissionRelicRewards = (inventory: TInventoryDatabaseDocument): ITypeCount[] => {
    if (inventory.MissionRelicRewardGroups?.length) {
        return inventory.MissionRelicRewardGroups.toSorted((a, b) => a.Wave - b.Wave).flatMap(group => group.Rewards);
    }
    return inventory.MissionRelicRewards ?? [];
};

export const crackRelic = async (
    inventory: TInventoryDatabaseDocument,
    participant: IVoidTearParticipantInfo,
    inventoryChanges: IInventoryChanges = {},
    tuning?: TPrivateServerTuning
): Promise<TCrackedRelicReward> => {
    const relic = ExportRelics[participant.VoidProjection];
    let weights = refinementToWeights[relic.quality];
    if (relic.quality == "VPQ_SILVER" && inventory.exceptionalRelicsAlwaysGiveBronzeReward) {
        weights = { COMMON: 1, UNCOMMON: 0, RARE: 0, LEGENDARY: 0 };
    } else if (relic.quality == "VPQ_GOLD" && inventory.flawlessRelicsAlwaysGiveSilverReward) {
        weights = { COMMON: 0, UNCOMMON: 1, RARE: 0, LEGENDARY: 0 };
    } else if (relic.quality == "VPQ_PLATINUM" && inventory.radiantRelicsAlwaysGiveGoldReward) {
        weights = { COMMON: 0, UNCOMMON: 0, RARE: 1, LEGENDARY: 0 };
    }
    logger.debug(`opening a relic of quality ${relic.quality}; rarity weights are`, weights);
    let reward = getRandomWeightedReward(
        ExportRewards[relic.rewardManifest][0] as { type: string; itemCount: number; rarity: TRarity }[], // rarity is nullable in PE+ typings, but always present for relics
        weights
    )!;
    let grantedRewards: TRelicReward[] = [reward];
    // "Give all of a rarity" only for refinement levels EXPLICITLY listed in relicRewards.refinementRarity.
    // An unlisted level (e.g. VPQ_BRONZE) keeps the single weighted roll above -> Bronze = 1 normal drop,
    // Silver = all Commons, Gold = all Uncommons, Platinum = all Rares (each tier distinct).
    const configuredRarity = tuning?.relicRewards?.refinementRarity?.[relic.quality];
    if (tuning?.relicRewards?.mode == "allOfRefinementRarity" && configuredRarity) {
        grantedRewards = (
            ExportRewards[relic.rewardManifest][0] as { type: string; itemCount: number; rarity: TRarity }[]
        )
            .filter(entry => entry.rarity == configuredRarity)
            .map(entry => ({
                ...entry,
                probability: 1
            }));
        if (grantedRewards.length != 0) {
            reward = grantedRewards[0];
        } else {
            grantedRewards = [reward];
        }
    }
    if (inventory.relicRewardItemCountMultiplier && inventory.relicRewardItemCountMultiplier != 1) {
        grantedRewards = grantedRewards.map(grantedReward => ({
            ...grantedReward,
            itemCount: grantedReward.itemCount * inventory.relicRewardItemCountMultiplier!
        }));
        reward = {
            ...reward,
            itemCount: reward.itemCount * inventory.relicRewardItemCountMultiplier
        };
    }
    logger.debug(`relic rolled`, { reward, grantedRewards });
    participant.Reward = reward.type;

    // Remove relic
    const miscItemChanges = [
        {
            ItemType: participant.VoidProjection,
            ItemCount: -1
        }
    ];
    addMiscItems(inventory, miscItemChanges);
    combineInventoryChanges(inventoryChanges, { MiscItems: miscItemChanges });

    // Give reward
    for (const grantedReward of grantedRewards) {
        combineInventoryChanges(
            inventoryChanges,
            await addItem(inventory, fromStoreItem(grantedReward.type), grantedReward.itemCount)
        );
    }

    const platinumValue =
        grantedRewards.reduce(
            (sum, grantedReward) => sum + getRelicPlatinumBonusForRarity(inventory, grantedReward.rarity),
            0
        ) * (inventory.relicRewardItemCountMultiplier ?? 1);
    if (platinumValue != 0) {
        inventory.pendingPremiumCredits ??= 0;
        inventory.pendingPremiumCredits += platinumValue;
    }

    // Client has picked its own reward (for lack of choice)
    participant.ChosenRewardOwner = participant.AccountId;

    return { ...reward, grantedRewards };
};

const getRelicPlatinumBonusForRarity = (inventory: TInventoryDatabaseDocument, rarity: TRarity): number => {
    switch (rarity) {
        case "COMMON":
            return inventory.relicPlatinumBonusCommon ?? 0;
        case "UNCOMMON":
            return inventory.relicPlatinumBonusUncommon ?? 0;
        case "RARE":
            return inventory.relicPlatinumBonusRare ?? 0;
        default:
            return 0;
    }
};

const refinementToWeights = {
    VPQ_BRONZE: {
        COMMON: 0.76,
        UNCOMMON: 0.22,
        RARE: 0.02,
        LEGENDARY: 0
    },
    VPQ_SILVER: {
        COMMON: 0.7,
        UNCOMMON: 0.26,
        RARE: 0.04,
        LEGENDARY: 0
    },
    VPQ_GOLD: {
        COMMON: 0.6,
        UNCOMMON: 0.34,
        RARE: 0.06,
        LEGENDARY: 0
    },
    VPQ_PLATINUM: {
        COMMON: 0.5,
        UNCOMMON: 0.4,
        RARE: 0.1,
        LEGENDARY: 0
    }
};

const getTypeCountForParticiantReward = (participant: IVoidTearParticipantInfo): ITypeCount => {
    const relic = ExportRelics[participant.VoidProjection];
    const reward = ExportRewards[relic.rewardManifest][0].find(x => x.type == participant.Reward)!;
    return {
        ItemType: reward.type,
        ItemCount: reward.itemCount
    };
};

export const ensureRelicRewardIsCorrect = async (
    inventory: TInventoryDatabaseDocument,
    wi: IVoidTearWaveInfo
): Promise<void> => {
    if (inventory.MissionRelicRewardGroups?.length) {
        const rewardGroup = inventory.MissionRelicRewardGroups.find(group => group.Wave == wi.Wave);
        if (rewardGroup) {
            const userParticipantInfo = wi.Participants.find(x => inventory.accountOwnerId.equals(x.AccountId))!;
            if (
                userParticipantInfo.ChosenRewardOwner &&
                userParticipantInfo.ChosenRewardOwner != userParticipantInfo.AccountId
            ) {
                const chosenParticipantInfo = wi.Participants.find(
                    x => x.AccountId == userParticipantInfo.ChosenRewardOwner
                )!;
                const chosenReward = getTypeCountForParticiantReward(chosenParticipantInfo);
                chosenReward.ItemCount *= inventory.relicRewardItemCountMultiplier ?? 1;

                logger.debug(`fixing grouped wave ${wi.Wave} reward for ${inventory.accountOwnerId.toString()}`, {
                    toRemove: rewardGroup.Rewards,
                    toAdd: chosenReward
                });
                for (const oldReward of rewardGroup.Rewards) {
                    await addItem(inventory, fromStoreItem(oldReward.ItemType), oldReward.ItemCount * -1);
                }
                await addItem(inventory, fromStoreItem(chosenReward.ItemType), chosenReward.ItemCount);
                rewardGroup.Rewards = [chosenReward];
            }
        }
        return;
    }

    if (inventory.MissionRelicRewards && inventory.MissionRelicRewards.length >= wi.Wave) {
        const userParticipantInfo = wi.Participants.find(x => inventory.accountOwnerId.equals(x.AccountId))!;
        const userReward = inventory.MissionRelicRewards[wi.Wave - 1];
        if (userParticipantInfo.ChosenRewardOwner) {
            const chosenParticipantInfo = wi.Participants.find(
                x => x.AccountId == userParticipantInfo.ChosenRewardOwner
            )!;
            const chosenReward = getTypeCountForParticiantReward(chosenParticipantInfo);
            chosenReward.ItemCount *= inventory.relicRewardItemCountMultiplier ?? 1;
            if (chosenReward.ItemType != userReward.ItemType || chosenReward.ItemCount != userReward.ItemCount) {
                logger.debug(`fixing up wave ${wi.Wave} reward for ${inventory.accountOwnerId.toString()}`, {
                    toRemove: userReward,
                    toAdd: chosenReward
                });
                await addItem(inventory, fromStoreItem(userReward.ItemType), userReward.ItemCount * -1);
                await addItem(inventory, fromStoreItem(chosenReward.ItemType), chosenReward.ItemCount);
                inventory.MissionRelicRewards[wi.Wave - 1] = chosenReward;
            }
        }
    }
};
