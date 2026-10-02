import { checkCalendarAutoAdvance, getCalendarProgress, getInventory } from "../../services/inventoryService.ts";
import { getAccountForRequest } from "../../services/loginService.ts";
import { handleStoreItemAcquisition } from "../../services/purchaseService.ts";
import { getCurrentCalendarSeason } from "../../services/worldStateService.ts";
import { advanceEventClock } from "../../services/eventClockService.ts";
import { getPrivateServerTuning, positivePrivateServerMultiplier } from "../../services/privateServerTuningService.ts";
import type { IInventoryChanges } from "../../types/purchaseTypes.ts";
import type { RequestHandler } from "express";

// GET request; query parameters: CompletedEventIdx=0&Iteration=4&Version=19&Season=CST_SUMMER
export const completeCalendarEventController: RequestHandler = async (req, res) => {
    const account = await getAccountForRequest(req);
    const inventory = await getInventory(account._id, undefined);
    const currentSeason = getCurrentCalendarSeason();
    const calendarProgress = getCalendarProgress(inventory, currentSeason);
    let inventoryChanges: IInventoryChanges = {};
    const dayIndex = calendarProgress.SeasonProgress.LastCompletedDayIdx + 1;
    const day = currentSeason.Days[dayIndex];
    if (day.events.length != 0) {
        if (day.events[0].type == "CET_CHALLENGE") {
            throw new Error(`completeCalendarEvent should not be used for challenges`);
        }
        const selection = day.events[parseInt(req.query.CompletedEventIdx as string)];
        if (selection.type == "CET_REWARD") {
            const rewardMultiplier = positivePrivateServerMultiplier(
                getPrivateServerTuning(account)?.calendar1999RewardMultiplier
            );
            inventoryChanges = (await handleStoreItemAcquisition(selection.reward!, inventory, rewardMultiplier))
                .InventoryChanges;
        } else if (selection.type == "CET_UPGRADE") {
            calendarProgress.YearProgress.Upgrades.push(selection.upgrade!);
        } else if (selection.type != "CET_PLOT") {
            throw new Error(`unexpected selection type: ${selection.type}`);
        }
    }
    calendarProgress.SeasonProgress.LastCompletedDayIdx = dayIndex;
    checkCalendarAutoAdvance(inventory, currentSeason);
    // Child clock: finished the last day of this season -> advance to next week's season. getCalendarProgress resets
    // the player's per-season progress on the next request (the SeasonType is week % 4, so it changes), keeping the
    // day lookup in bounds.
    if (calendarProgress.SeasonProgress.LastCompletedDayIdx >= currentSeason.Days.length - 1) {
        await advanceEventClock("calendar", Date.now());
    }
    await inventory.save();
    res.json({
        InventoryChanges: inventoryChanges,
        CalendarProgress: inventory.CalendarProgress
    });
};
