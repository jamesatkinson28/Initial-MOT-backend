import express from "express";

const router = express.Router();

router.post("/google-rtdn", async (req, res) => {
  try {
    const message = req.body?.message;

    if (!message?.data) {
      return res.status(200).send("No message");
    }

    const decoded = JSON.parse(
      Buffer.from(message.data, "base64").toString()
    );

    console.log("📩 Google RTDN:", decoded);

    res.status(200).send("ok");
  } catch (err) {
    console.error("RTDN error:", err);
    res.status(500).send("error");
  }
});

export default router;