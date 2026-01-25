import express from "express";
import { authRequired } from "../middleware/auth.js";
import fetch from "node-fetch";

const router = express.Router();

router.post("/spec-unlock", authRequired, async (req, res) => {
  try {
    const { vrm } = req.body;

    if (!vrm) {
      return res.status(400).json({
        success: false,
        error: "Missing VRM"
      });
    }

    const baseUrl = process.env.API_BASE_URL;
    if (!baseUrl) {
      throw new Error("API_BASE_URL not set");
    }

    const response = await fetch(
      `${baseUrl}/api/unlock-spec`,
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

    return res.status(response.status).json(data);
  } catch (err) {
    console.error("❌ IAP SPEC UNLOCK ERROR:", err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

export default router;
