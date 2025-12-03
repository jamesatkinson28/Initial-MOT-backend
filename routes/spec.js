const express = require("express");
const router = express.Router();
const axios = require("axios");
const db = require("../db");
const authMiddleware = require("../middleware/auth");

// ENV variables
const SPEC_API_BASE_URL = process.env.SPEC_API_BASE_URL;
const SPEC_API_KEY = process.env.SPEC_API_KEY;
const SPEC_PACKAGE_NAME = process.env.SPEC_PACKAGE_NAME;

// --- Helpers ---
async function hasUnlockedBefore(userId, vrm) {
  const result = await db.query(
    "SELECT * FROM unlocked_specs WHERE user_id = $1 AND vrm = $2 LIMIT 1",
    [userId, vrm]
  );
  return result.rows.length > 0;
}

async function saveUnlock(userId, vrm) {
  await db.query(
    "INSERT INTO unlocked_specs (user_id, vrm) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [userId, vrm]
  );
}

async function resetMonthlyUnlocks(user) {
  const now = new Date();
  const lastReset = user.last_unlock_reset ? new Date(user.last_unlock_reset) : null;

  if (!lastReset || now.getMonth() !== lastReset.getMonth()) {
    await db.query(
      "UPDATE users SET monthly_unlocks_remaining = 3, last_unlock_reset = NOW() WHERE id = $1",
      [user.id]
    );
    user.monthly_unlocks_remaining = 3;
  }
}

// --- Route: Unlock Spec ---
router.post("/unlock", authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    const { vrm } = req.body;

    if (!vrm) {
      return res.status(400).json({ error: "VRM is required" });
    }

    const formattedVRM = vrm.replace(/\s+/g, "").toUpperCase();

    // Reset monthly unlocks if new month
    await resetMonthlyUnlocks(user);

    console.log("User premium:", user.premium);
    console.log("Monthly remaining:", user.monthly_unlocks_remaining);

    // Already unlocked?
    if (await hasUnlockedBefore(user.id, formattedVRM)) {
      console.log("Already unlocked before — returning immediately");
      return res.json({ unlocked: true, alreadyUnlocked: true });
    }

    // Non-premium users pay per unlock (1 unlock from quota)
    if (!user.premium) {
      if (user.monthly_unlocks_remaining <= 0) {
        return res.status(403).json({
          error: "No unlocks remaining for this month"
        });
      }

      await db.query(
        "UPDATE users SET monthly_unlocks_remaining = monthly_unlocks_remaining - 1 WHERE id = $1",
        [user.id]
      );
    }

    // ------- CALL VDGL API -------
    const url = `${SPEC_API_BASE_URL}/r2/lookup`;

    const vdglResponse = await axios.get(url, {
      params: {
        ApiKey: SPEC_API_KEY,
        PackageName: SPEC_PACKAGE_NAME,
        Vrm: formattedVRM
      }
    });

    const data = vdglResponse.data;

    // If API returned failure
    if (!data?.ResponseInformation?.IsSuccessStatusCode) {
      return res.status(400).json({
        error: "VDGL API error",
        details: data?.ResponseInformation?.StatusMessage || "Unknown"
      });
    }

    // Save unlock
    await saveUnlock(user.id, formattedVRM);

    return res.json({
      unlocked: true,
      spec: data
    });

  } catch (err) {
    console.error("Spec unlock error", err);

    return res.status(500).json({
      error: "Server error",
      details: err.message
    });
  }
});

module.exports = router;
