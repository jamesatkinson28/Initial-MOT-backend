import express from "express";
import { authRequired } from "../middleware/auth.js";
import fetch from "node-fetch";

const router = express.Router();

/**
 * POST /api/iap/spec-unlock
 * Body:
 * {
 *   vrm: "B27TAM",
 *   sku: "spec_unlock_standard",
 *   platform: "ios" | "android"
 * }
 */
router.post("/spec-unlock", authRequired, async (req, res) => {
  try {
    const { vrm } = req.body;

    if (!vrm) {
      return res.status(400).json({
        success: false,
        error: "Missing VRM"
      });
    }

    // 🔁 Delegate to the authoritative spec unlock route
    const response = await fetch(
      `${process.env.API_BASE_URL}/api/spec/unlock-spec`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: req.headers.authorization
        },
        body: JSON.stringify({ vrm })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.json({
      success: true,
      ...data
    });
  } catch (err) {
    console.error("❌ IAP SPEC UNLOCK ERROR:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to unlock spec"
    });
  }
});

export default router;
