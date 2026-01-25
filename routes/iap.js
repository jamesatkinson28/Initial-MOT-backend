import express from "express";
import { authRequired } from "../middleware/auth.js";

const router = express.Router();

/**
 * POST /api/iap/spec-unlock
 * Body:
 * { vrm, sku, platform, ... }
 */
router.post("/spec-unlock", authRequired, async (req, res) => {
  try {
    const { vrm } = req.body;

    if (!vrm) {
      return res.status(400).json({ success: false, error: "Missing VRM" });
    }

    // ✅ internally forward to the authoritative spec unlock route
    req.url = "/unlock-spec";
    req.originalUrl = "/api/spec/unlock-spec"; // optional, helps logs
    req.body = { vrm };

    // call the spec router handler by delegating request to the /api/spec router
    // NOTE: this assumes you mounted the spec router at /api/spec
    return req.app._router.handle(req, res, () => {});
  } catch (err) {
    console.error("❌ IAP SPEC UNLOCK ERROR:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to unlock spec"
    });
  }
});

export default router;
