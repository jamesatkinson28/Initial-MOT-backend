// routes/garage.js
import express from "express";
import { query } from "../db/client.js";
import { authRequired } from "../middleware/auth.js";

export const garageRouter = express.Router();

const normaliseVrm = (vrm) =>
  vrm ? vrm.replace(/\s+/g, "").toUpperCase() : "";

// GET /garage
garageRouter.get("/", authRequired, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, vrm, label, created_at
       FROM garage_items
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    return res.json({ items: rows });
  } catch (err) {
    console.error("GET /garage error:", err.message);
    return res.status(500).json({ error: "Failed to load garage items." });
  }
});

// POST /garage  { vrm, label? }
garageRouter.post("/", authRequired, async (req, res) => {
  try {
    const vrm = normaliseVrm(req.body?.vrm);
    const label = req.body?.label || null;

    if (!vrm) {
      return res.status(400).json({ error: "VRM is required." });
    }

    const { rows } = await query(
      `INSERT INTO garage_items (user_id, vrm, label)
       VALUES ($1, $2, $3)
       RETURNING id, vrm, label, created_at`,
      [req.user.id, vrm, label]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error("POST /garage error:", err.message);
    return res.status(500).json({ error: "Failed to save garage item." });
  }
});

// DELETE /garage/:id
garageRouter.delete("/:id", authRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "Invalid id." });
    }

    const result = await query(
      `DELETE FROM garage_items
       WHERE id = $1 AND user_id = $2`,
      [id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Garage item not found." });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("DELETE /garage error:", err.message);
    return res.status(500).json({ error: "Failed to delete garage item." });
  }
});
