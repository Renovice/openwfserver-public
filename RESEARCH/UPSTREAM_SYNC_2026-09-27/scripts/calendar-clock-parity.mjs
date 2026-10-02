// Run from the server root: node --experimental-strip-types RESEARCH/UPSTREAM_SYNC_2026-09-27/scripts/calendar-clock-parity.mjs
import assert from 'node:assert/strict';
import {model} from 'mongoose';
import {loadConfig,config} from '../../../src/services/configService.ts';
import {initLogger,deinitLogger} from '../../../src/utils/logger.ts';
import {getWorldState,getWorldStateTime,getCurrentCalendarSeason} from '../../../src/services/worldStateService.ts';
import {advanceEventClock,ensureEventClocksLoaded} from '../../../src/services/eventClockService.ts';
import {getCalendarProgress} from '../../../src/services/inventoryService.ts';
loadConfig();config.logger.files=false;config.logger.consoleLevel='error';initLogger();
// Only this test process: in-memory persistence, no database connection or account writes.
const clocks=model('EventClock');clocks.findById=async()=>null;clocks.findByIdAndUpdate=async()=>null;
await ensureEventClocksLoaded();
const time=Date.now();const originalNow=Date.now;Date.now=()=>time;
try {
 const before=getCurrentCalendarSeason();
 await advanceEventClock('calendar',getWorldStateTime().timeMs);
 const after=getCurrentCalendarSeason();
 assert.notDeepEqual(after,before);
 const ws=getWorldState(config.fallbackBuildLabel);
 assert.deepEqual(ws.KnownCalendarSeasons[0],after);
 const inventory={CalendarProgress:undefined};
 assert.ok(getCalendarProgress(inventory,after));
 console.log(JSON.stringify({calendarClockParity:'PASS',baroOffers:ws.VoidTraders.map(v=>v.Manifest?.length)}));
} finally {Date.now=originalNow;deinitLogger();}
process.exit(0);
