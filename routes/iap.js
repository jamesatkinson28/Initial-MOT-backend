import express from "express";
import { authRequired } from "../middleware/auth.js";
import fetch from "node-fetch";
import { withTransaction } from "../db/db.js";
import { unlockSpec } from "../services/unlockSpec.js";

const router = express.Router();

router.post("/spec-unlock", authRequired, async (req, res) => {
  try {
    const { vrm } = req.body;

    const result = await withTransaction(async (db) => {
      return unlockSpec({
        db,
        vrm,
        user: req.user
      });
    });

    return res.json({ success: true, ...result });
  } catch (err) {
  console.error("❌ IAP SPEC UNLOCK ERROR:", err);

  // 🚫 DVLA retention / update window
  if (err?.code === "DVLA_RETENTION") {
    return res.status(409).json({
      success: false,
      retention: true,
      retryAfterDays: err.retryAfterDays ?? 7,
      message:
        "This registration is currently being updated by DVLA. Please try again in a few days.",
    });
  }

  // ❌ Genuine backend failure
  return res.status(500).json({
    success: false,
    error: err?.message || "Failed to unlock specification",
  });
}


});

export default router;
