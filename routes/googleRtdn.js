import express from "express";
import { query } from "../db/db.js";

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const message = req.body?.message;

    if (!message?.data) {
      return res.status(200).send("No message");
    }

    const decoded = JSON.parse(
      Buffer.from(message.data, "base64").toString()
    );

    console.log("📩 GOOGLE RTDN:", decoded);

    const sub = decoded?.subscriptionNotification;

    if (sub) {
      const { notificationType, purchaseToken, subscriptionId } = sub;

      console.log("GOOGLE SUB EVENT:", {
        notificationType,
        purchaseToken,
        subscriptionId,
      });

      // CANCELLED
      if (notificationType === 3) {
        await query(
          `
          UPDATE premium_entitlements
          SET
            status = 'cancelled',
            last_notification_type = 'CANCELLED',
            last_notification_at = NOW()
          WHERE transaction_id = $1
          `,
          [purchaseToken]
        );
      }

      // EXPIRED
      if (notificationType === 12) {
        await query(
          `
          UPDATE premium_entitlements
          SET
            premium_until = LEAST(premium_until, NOW()),
            status = 'expired',
            last_notification_type = 'EXPIRED',
            last_notification_at = NOW()
          WHERE transaction_id = $1
          `,
          [purchaseToken]
        );
      }

      // RENEWED
      if (notificationType === 2) {
        await query(
          `
          UPDATE premium_entitlements
          SET
            status = 'active',
            last_notification_type = 'RENEWED',
            last_notification_at = NOW()
          WHERE transaction_id = $1
          `,
          [purchaseToken]
        );
      }
    }

    res.status(200).send("ok");
  } catch (err) {
    console.error("GOOGLE RTDN ERROR:", err);
    res.status(500).send("error");
  }
});

export default router;