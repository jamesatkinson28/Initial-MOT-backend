import express from "express";
import fetch from "node-fetch";
import { withTransaction } from "../db/db.js";
import { unlockSpec } from "../services/unlockSpec.js";

const router = express.Router();

router.post("/spec-unlock", async (req, res) => {
  try {
    const { vrm, guestId, transactionId, productId, platform } = req.body;
	console.log("📦 /spec-unlock payload", {
      vrm,
      guestId,
      transactionId,
      productId,
      platform,
      hasUser: !!req.user,
    });
    console.log("➡️ /spec-unlock hit", {
      vrm,
      hasUser: !!req.user,
      guestId,
      transactionId,
    });

    const result = await withTransaction(async (db) => {
      return unlockSpec({
        db,
        vrm,
        user: req.user ?? null,
        guestId: guestId ?? null,
        transactionId: transactionId ?? null,
        productId: productId ?? null,
        platform: platform ?? null,
      });
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    console.error("❌ IAP SPEC UNLOCK ERROR:", err);

    const message = err?.message || "";

    if (
      message.toLowerCase().includes("retention") ||
      message.toLowerCase().includes("dvla") ||
      message.toLowerCase().includes("temporarily unavailable")
    ) {
      return res.status(409).json({
        success: false,
        retention: true,
        retryAfterDays: 7,
        message:
          "This registration is currently being updated by DVLA. Please try again in a few days.",
      });
    }

    return res.status(500).json({
      success: false,
      error: message || "Failed to unlock specification",
    });
  }
});


export default router;
