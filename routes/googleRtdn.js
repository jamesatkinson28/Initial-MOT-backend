router.post("/google-rtdn", async (req, res) => {
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

    if (!sub) {
      return res.json({ ok: true });
    }

    const { notificationType, purchaseToken, subscriptionId } = sub;

    console.log("GOOGLE SUB EVENT:", {
      notificationType,
      purchaseToken,
      subscriptionId,
    });

    // ----------------------------------------
    // CANCELLED
    // ----------------------------------------
    // User cancelled auto-renew. Access continues
    // until expiry, so we DO NOT revoke access.
    // ----------------------------------------

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

      console.log("GOOGLE IAP CANCELLED:", purchaseToken);
      return res.json({ ok: true });
    }

    // ----------------------------------------
    // EXPIRED
    // ----------------------------------------
    // Subscription fully expired
    // ----------------------------------------

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

      console.log("GOOGLE IAP EXPIRED:", purchaseToken);
      return res.json({ ok: true });
    }

    // ----------------------------------------
    // RENEWED
    // ----------------------------------------
    // Subscription successfully renewed
    // ----------------------------------------

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

      console.log("GOOGLE IAP RENEWED:", purchaseToken);
      return res.json({ ok: true });
    }

    // ----------------------------------------
    // PURCHASED (first purchase)
    // ----------------------------------------

    if (notificationType === 4) {
      await query(
        `
        UPDATE premium_entitlements
        SET
          status = 'active',
          last_notification_type = 'PURCHASED',
          last_notification_at = NOW()
        WHERE transaction_id = $1
        `,
        [purchaseToken]
      );

      console.log("GOOGLE IAP PURCHASED:", purchaseToken);
      return res.json({ ok: true });
    }

    return res.json({ ok: true });

  } catch (err) {
    console.error("GOOGLE RTDN ERROR:", err);
    return res.status(500).json({ ok: false });
  }
});