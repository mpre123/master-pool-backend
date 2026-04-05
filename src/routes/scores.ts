import { Router, type IRouter } from "express";
import { triggerSyncNow } from "../lib/scoreSync.js";

const router: IRouter = Router();

// POST /api/scores/sync — manually trigger a score sync
// Body: { eventId?: string }
router.post("/scores/sync", async (req, res) => {
  try {
    const eventId = (req.body as { eventId?: string })?.eventId
    const result = await triggerSyncNow(eventId)
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

export default router;
