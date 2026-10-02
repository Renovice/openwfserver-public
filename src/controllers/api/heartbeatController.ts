import type { RequestHandler } from "express";
import { getAccountIdForRequest } from "../../services/loginService.ts";

// U44 client telemetry acknowledgement. Do not persist or interpret the PS payload.
export const heartbeatController: RequestHandler = async (req, res) => {
    await getAccountIdForRequest(req);
    res.end();
};
