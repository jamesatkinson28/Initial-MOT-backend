// routes/spec.js
import express from "express";
import pg from "pg";
import axios from "axios";
import { authRequired } from "../middleware/auth.js";

const specRouter = express.Router();
export default specRouter;

// -----------------------------
// Database
// -----------------------------
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// -----------------------------
// GET FULL SPEC (requires unlocked)
// -----------------------------
// GET /api/spec-options?vrm=ABC123
specRouter.get("/spec-options", authRequired, async (req, res) => {
  try {
    const vrm = req.query.vrm?.toUpperCase();
    const userId = req.user?.id;

    if (!vrm) {
      return res.status(400).json({ error: "VRM is required" });
    }

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    // Check if user already unlocked
    const unlocked = await pool.query(
      "SELECT * FROM unlocked_specs WHERE user_id=$1 AND vrm=$2",
      [userId, vrm]
    );

    if (unlocked.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: "This vehicle’s full specification is locked.",
      });
    }

    // Fetch from VDGL
    const url = `${process.env.SPEC_API_BASE_URL}?ApiKey=${process.env.SPEC_API_KEY}&PackageName=${process.env.SPEC_PACKAGE_NAME}&Vrm=${vrm}`;

    const vdglRes = await axios.get(url);

    return res.json({
      success: true,
      data: vdglRes.data,
    });
  } catch (err) {
    console.error("SPEC OPTIONS ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to fetch full spec" });
  }
});

// -----------------------------
// UNLOCK SPEC FOR A USER
// -----------------------------
// POST /api/unlock-spec  { vrm }
specRouter.post("/unlock-spec", authRequired, async (req, res) => {
  try {
    const { vrm } = req.body || {};
    const userId = req.user?.id;

    if (!vrm) {
      return res
        .status(400)
        .json({ success: false, error: "VRM missing" });
    }

    if (!userId) {
      return res
        .status(401)
        .json({ success: false, error: "User not authenticated" });
    }

    // Save unlock if not already saved
    await pool.query(
      `
      INSERT INTO unlocked_specs(user_id, vrm)
      VALUES ($1, $2)
      ON CONFLICT (user_id, vrm) DO NOTHING
    `,
      [userId, vrm.toUpperCase()]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("UNLOCK SPEC ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      success: false,
      error: "Failed to unlock this vehicle spec",
    });
  }
});
