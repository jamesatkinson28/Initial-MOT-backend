import express from "express";
import { authRequired } from "../middleware/auth.js";
import { query } from "../db/db.js";

const router = express.Router();

// SAVE VEHICLE
router.post("/save", authRequired, async (req, res) => {
  try {
    const { vrm, label } = req.body;

    if (!vrm) {
      return res.status(400).json({ error: "VRM is required" });
    }

    const result = await query(
      `INSERT INTO garage_items (user_id, vrm, label)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [req.user.id, vrm.toUpperCase(), label || null]
    );

    res.json({ success: true, entry: result.rows[0] });

  } catch (err) {
    console.error("GARAGE SAVE ERROR:", err);
    res.status(500).json({ error: "Failed to save vehicle" });
  }
});

// LIST VEHICLES
router.get("/list", authRequired, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, vrm, label, created_at
       FROM garage_items
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    res.json({ vehicles: result.rows });

  } catch (err) {
    console.error("GARAGE LIST ERROR:", err);
    res.status(500).json({ error: "Failed to list vehicles" });
  }
});

// DELETE VEHICLE
router.delete("/delete/:id", authRequired, async (req, res) => {
  try {
    const { id } = req.params;

    await query(
      `DELETE FROM garage_items
       WHERE id = $1 AND user_id = $2`,
      [id, req.user.id]
    );

    res.json({ success: true });

  } catch (err) {
    console.error("GARAGE DELETE ERROR:", err);
    res.status(500).json({ error: "Failed to delete vehicle" });
  }
});

export default router;
