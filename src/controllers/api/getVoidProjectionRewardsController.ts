import { getJSONfromString } from "../../helpers/stringHelpers.ts";
import { crackRelic, ensureRelicRewardIsCorrect, getGrantedRelicRewardTypeCounts } from "../../helpers/relicHelper.ts";
import { getInventory } from "../../services/inventoryService.ts";
import { getAccountForRequest } from "../../services/loginService.ts";
import type { IVoidTearParticipantInfo, IVoidTearWaveInfo } from "../../types/requestTypes.ts";
import type { RequestHandler } from "express";
import { logger } from "../../utils/logger.ts";
import { getPrivateServerTuning } from "../../services/privateServerTuningService.ts";

export const getVoidProjectionRewardsController: RequestHandler = async (req, res) => {
    const account = await getAccountForRequest(req);
    const accountId = account._id.toString();
    const data = getJSONfromString<IVoidProjectionRewardRequest | IVoidProjectionRewardsLegacyRequest>(
        String(req.body)
    );
    logger.debug(`getVoidProjectionRewards request:`, data);

    const currentWave = "CurrentWave" in data ? data.CurrentWave : data.VoidTearParticipantsCurrWave.Wave;
    const participantInfo =
        "ParticipantInfo" in data
            ? data.ParticipantInfo
            : data.VoidTearParticipantsCurrWave.Participants.find(p => p.AccountId == accountId);

    if (
        participantInfo &&
        participantInfo.QualifiesForReward &&
        !participantInfo.HaveRewardResponse &&
        !participantInfo.Reward
    ) {
        const inventory = await getInventory(accountId, undefined);
        const reward = await crackRelic(inventory, participantInfo, {}, getPrivateServerTuning(account));
        inventory.MissionRelicRewardGroups ??= [];
        inventory.MissionRelicRewardGroups = inventory.MissionRelicRewardGroups.filter(
            group => group.Wave < currentWave
        );
        inventory.MissionRelicRewardGroups.push({
            Wave: currentWave,
            Rewards: getGrantedRelicRewardTypeCounts(reward)
        });
        inventory.MissionRelicRewards = undefined;
        if (data.VoidTearParticipantsPrevWave) {
            await ensureRelicRewardIsCorrect(inventory, data.VoidTearParticipantsPrevWave);
        }
        await inventory.save();
    }

    if ("CurrentWave" in data) {
        res.json({
            CurrentWave: data.CurrentWave,
            ParticipantInfo: data.ParticipantInfo,
            DifficultyTier: data.DifficultyTier
        } satisfies IVoidProjectionRewardResponse);
    } else {
        res.json({
            VoidTearParticipantsCurrWave: data.VoidTearParticipantsCurrWave
        } satisfies IVoidProjectionRewardsLegacyResponse);
    }
};

interface IVoidProjectionRewardRequest {
    CurrentWave: number;
    ParticipantInfo: IVoidTearParticipantInfo;
    VoidTearParticipantsPrevWave?: IVoidTearWaveInfo;
    VoidTier: string;
    DifficultyTier: number;
    VoidProjectionRemovalHash: string;
}
interface IVoidProjectionRewardResponse {
    CurrentWave: number;
    ParticipantInfo: IVoidTearParticipantInfo;
    DifficultyTier: number;
}

// Legacy format seen in U27.3, unsure when it changed
interface IVoidProjectionRewardsLegacyRequest {
    VoidTearParticipantsCurrWave: IVoidTearWaveInfo;
    VoidTearParticipantsPrevWave?: IVoidTearWaveInfo;
    VoidTier: string;
    VoidProjectionRemovalHash: string;
}

interface IVoidProjectionRewardsLegacyResponse {
    VoidTearParticipantsCurrWave: IVoidTearWaveInfo;
}
