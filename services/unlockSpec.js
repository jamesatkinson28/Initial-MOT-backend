import { buildFingerprint } from "../routes/spec.js";
import { fetchSpecDataFromAPI } from "./specProvider.js";
import { fetchTyreDetails } from "./tyreParser.js";
import crypto from "crypto";

const DVLA_CACHE_TTL_HOURS = 24;

function nextWeeklyRetryDate() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

/**
 * Build a spec-shaped core identity object from DVLA lookup data
 * (NO provider data, NO DVSA free text)
 */
function buildCoreIdentityFromDvla(dvla) {
  if (!dvla) return null;

  return {
    identity: {
      make: dvla.make ?? null,
      monthOfFirstRegistration: dvla.monthOfFirstRegistration ?? null,
      engineCapacity:
        dvla.engineCapacity !== undefined
          ? Number(dvla.engineCapacity)
          : null,
      fuelType: dvla.fuelType ?? null,
      bodyStyle: dvla.wheelplan ?? null,
    },
  };
}

async function getPaidCreditBalance(db, userUuid, guestId) {
  const res = await db.query(
    `
    SELECT COALESCE(SUM(delta), 0)::int AS balance
    FROM unlock_credits_ledger
    WHERE (user_uuid = $1 OR ($1 IS NULL AND guest_id = $2))
    `,
    [userUuid, guestId]
  );
  return res.rows[0]?.balance ?? 0;
}


/**
 * MAIN UNLOCK FUNCTION
 */
export async function unlockSpec({
  db,
  vrm,
  user = null,
  guestId = null,
  transactionId = null,
  productId = null,
  platform = null,
  unlockSource = null, // "free" | "paid"
}) {  console.log("🔥 unlockSpec ENTERED", {
    vrm,
    hasUser: !!user,
    hasGuest: !!guestId,
    transactionId,
    productId,
    platform,
  });
  let isPremium = false;
  let isRetentionRetry = false;
  let activeEntitlement = null;
  
  if (!vrm) throw new Error("VRM required");
  if (!user && !guestId) {
    throw new Error("No user or guest identity provided");
  }
  
unlockSource =
  unlockSource ??
  (transactionId && productId ? "paid" : "free");
  
  const vrmUpper = vrm.toUpperCase();
  const userUuid = user ? user.id : null;

  // --------------------------------------------------
// TRANSACTION ID DEDUPE (AUTHORITATIVE)
// --------------------------------------------------
  if (transactionId) {
  const txCheck = await db.query(
    `
    SELECT snapshot_id
    FROM unlocked_specs
    WHERE transaction_id = $1
    `,
    [transactionId]
  );

  if (txCheck.rowCount > 0) {
    const snap = await db.query(
      `
      SELECT spec_json
      FROM vehicle_spec_snapshots
      WHERE id = $1
      `,
      [txCheck.rows[0].snapshot_id]
    );

    return {
      alreadyUnlocked: true,
      spec: snap.rows[0]?.spec_json || null,
    };
  }
}
console.log("💳 CREDIT BLOCK CHECK", {
  unlockSource,
  transactionId,
  productId,
});
// --------------------------------------------------
// PAID CREDIT GRANT + BALANCE CHECK
// --------------------------------------------------
if (unlockSource === "paid") {
  const bal = await getPaidCreditBalance(db, userUuid, guestId);
  if (bal <= 0) {
    throw new Error("NO_UNLOCK_CREDIT");
  }
}

  // --------------------------------------------------
  // LOCK USER ROW (monthly unlock tracking)
  // --------------------------------------------------
  let u = null;

  if (userUuid || guestId) {
    const ent = await db.query(
      `
      SELECT
	    original_transaction_id,
        latest_transaction_id
      FROM premium_entitlements
      WHERE premium_until > NOW()
        AND (
          user_uuid = $1
          OR guest_id = $2
        )
      ORDER BY premium_until DESC
      LIMIT 1
      `,
      [userUuid, guestId]
    );

    activeEntitlement = ent.rows[0] ?? null;
    isPremium = !!activeEntitlement;
  }

// --------------------------------------------------
// FREE UNLOCK REQUIRES ACTIVE PREMIUM
// --------------------------------------------------
  if (unlockSource === "free" && !isPremium) {
    throw new Error("Premium subscription required");
  
  }

  // --------------------------------------------------
  // BUILD CURRENT FINGERPRINT FROM DVLA CORE IDENTITY
  // --------------------------------------------------
  // --------------------------------------------------
  // LOAD DVLA CORE IDENTITY FROM CACHE (TTL enforced)
  // --------------------------------------------------

  const dvlaRow = await db.query(
    `
    SELECT dvla_json, fetched_at
    FROM dvla_lookup_cache
    WHERE vrm = $1
    `,
    [vrmUpper]
  );
 
  if (dvlaRow.rowCount === 0) {
    throw new Error("DVLA lookup data not available. Please search vehicle again.");
  }

  const fetchedAt = new Date(dvlaRow.rows[0].fetched_at);
  const ageHours = (Date.now() - fetchedAt.getTime()) / 36e5;

  if (ageHours > 24) {
    throw new Error("DVLA lookup data expired. Please refresh vehicle search.");
  }

  const coreIdentity = buildCoreIdentityFromDvla(dvlaRow.rows[0].dvla_json);

  if (!coreIdentity) {
    throw new Error("Failed to build DVLA core identity");
   }

  const currentFingerprint = buildFingerprint(coreIdentity);
  
  if (!currentFingerprint) {
    throw new Error("Fingerprint generation failed");
  }

// --------------------------------------------------
// ALREADY UNLOCKED BY OWNER (MATCHING FINGERPRINT ONLY)
// --------------------------------------------------

const existing = userUuid
  ? await db.query(`
      SELECT us.snapshot_id
      FROM unlocked_specs us
      JOIN vehicle_spec_snapshots vss
        ON vss.id = us.snapshot_id
      WHERE us.user_id = $1
        AND us.vrm = $2
        AND vss.fingerprint = $3
      LIMIT 1
    `,[userUuid, vrmUpper, currentFingerprint])
  : await db.query(`
      SELECT us.snapshot_id
      FROM unlocked_specs us
      JOIN vehicle_spec_snapshots vss
        ON vss.id = us.snapshot_id
      WHERE us.guest_id = $1
        AND us.vrm = $2
        AND vss.fingerprint = $3
      LIMIT 1
    `,[guestId, vrmUpper, currentFingerprint]);

if (existing.rowCount > 0) {
  const snap = await db.query(`
      SELECT spec_json
      FROM vehicle_spec_snapshots
      WHERE id=$1
    `,[existing.rows[0].snapshot_id]);

  return {
    alreadyUnlocked: true,
    spec: snap.rows[0]?.spec_json || null,
  };
}
  // --------------------------------------------------
// CHECK FOR EXISTING SNAPSHOT
// --------------------------------------------------

const lastSnapshot = await db.query(
  `
  SELECT id, fingerprint
  FROM vehicle_spec_snapshots
  WHERE vrm = $1
  ORDER BY created_at DESC
  LIMIT 1
  `,
  [vrmUpper]
);
console.log("📸 SNAPSHOT LOOKUP", {
  vrm: vrmUpper,
  found: lastSnapshot.rowCount > 0,
  fingerprintMatch:
    lastSnapshot.rowCount > 0 &&
    lastSnapshot.rows[0].fingerprint === currentFingerprint,
});

let snapshotId;
let plateReused = false;

if (
  lastSnapshot.rowCount > 0 &&
  lastSnapshot.rows[0].fingerprint === currentFingerprint
) {
  // ✅ Same vehicle, reuse snapshot
  snapshotId = lastSnapshot.rows[0].id;
  
} else {
  // 🚨 Plate reuse OR first time seen
  plateReused = lastSnapshot.rowCount > 0;
    if (plateReused) {
    console.warn("🚨 PLATE REUSE DETECTED", {
      vrm: vrmUpper,
      previousFingerprint: lastSnapshot.rows[0]?.fingerprint,
      currentFingerprint,
    });
  }
  
// --------------------------------------------------
// CHECK EXISTING RETENTION STATE
// --------------------------------------------------

const providerStatus = await db.query(
  `
  SELECT status_code, retry_after, free_retry_used
  FROM vrm_provider_status
  WHERE vrm = $1
  `,
  [vrmUpper]
);

if (providerStatus.rowCount > 0) {
  const row = providerStatus.rows[0];

  const now = new Date();
  const retryAfter = row.retry_after ? new Date(row.retry_after) : null;

  // ⛔ 1) Still inside retry window → block all attempts
  if (
    row.status_code === "PlateInRetentionLastVehicleReturned" &&
    retryAfter &&
    now < retryAfter
  ) {
    throw new Error("RETENTION_WAIT");
  }

  // 🚫 2) Retry window passed but free retry already used
  if (
    row.status_code === "PlateInRetentionLastVehicleReturned" &&
    retryAfter &&
    now >= retryAfter &&
    row.free_retry_used &&
    unlockSource === "free"
  ) {
    throw new Error("RETENTION_PAID_REQUIRED");
  }

  // ✅ 3) Allow ONE free retry
  if (
    row.status_code === "PlateInRetentionLastVehicleReturned" &&
    retryAfter &&
    now >= retryAfter &&
    !row.free_retry_used &&
    unlockSource === "free"
  ) {
    await db.query(
      `
      UPDATE vrm_provider_status
      SET free_retry_used = true
      WHERE vrm = $1
      `,
      [vrmUpper]
    );

    isRetentionRetry = true;
  }
}

// --------------------------------------------------
// Fetch provider spec
// --------------------------------------------------

const result = await fetchSpecDataFromAPI(vrmUpper);

// 1️⃣ Handle retention FIRST
if (result?.statusCode === "PlateInRetentionLastVehicleReturned") {


  await db.query(
    `
    INSERT INTO vrm_provider_status
      (vrm, status_code, last_checked_at, retry_after, free_retry_used)
    VALUES ($1, $2, NOW(), $3, false)
    ON CONFLICT (vrm)
    DO UPDATE SET
      status_code     = EXCLUDED.status_code,
      last_checked_at = NOW(),
      retry_after     = EXCLUDED.retry_after
      -- DO NOT reset free_retry_used here
    `,
    [vrmUpper, result.statusCode, nextWeeklyRetryDate()]
  );
  
  if (!result?.spec) {
    throw new Error("SPEC_NULL");
  }

  result.spec = {
    ...result.spec,
    _meta: {
      ...(result.spec._meta || {}),
      retention: true,
      retryAfter: nextWeeklyRetryDate().toISOString(),
      provider_status_code: result.statusCode,
    },
  };
}

// 2️⃣ Clear retention if provider returns full success
if (
  result?.statusCode === "Success" ||
  result?.statusCode === "SuccessWithResultsBlockWarnings"
) {
  await db.query(
    `DELETE FROM vrm_provider_status WHERE vrm = $1`,
    [vrmUpper]
  );
}

// 3️⃣ Throw SPEC_NULL only if not retention
if (!result?.spec) {
  throw new Error("SPEC_NULL");
}

  const engineCode =
    result.spec?.engine?.engine_code ?? null;
	
  // 🛞 TYRE CONFIGURATIONS — PUT IT HERE
  let tyreData = null;

  try {
    const tyreConfigs = await fetchTyreDetails(vrmUpper);

    tyreData = tyreConfigs?.length
      ? {
          configurations: tyreConfigs,
          source: "TyreDetails",
          fetched_at: new Date().toISOString(),
        }
      : null;
  } catch (err) {
    console.warn("⚠️ TyreDetails fetch failed", err.message);
  }
	
  // Create new snapshot
  const snapInsert = await db.query(
    `
    INSERT INTO vehicle_spec_snapshots (vrm, spec_json, fingerprint, engine_code, tyre_data)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
    `,
    [vrmUpper, result.spec, currentFingerprint, engineCode, tyreData]
  );

  snapshotId = snapInsert.rows[0].id;
}

  if (!snapshotId) {
    throw new Error("Snapshot resolution failed");
  }
  
  const specRow = await db.query(
    `
    SELECT spec_json
    FROM vehicle_spec_snapshots
    WHERE id = $1
    `,
    [snapshotId]
  );

  const spec = specRow.rows[0]?.spec_json || null;
  
  // --------------------------------------------------
// RESERVE MONTHLY FREE UNLOCK (PREMIUM ONLY)
// --------------------------------------------------
if (unlockSource === "free" && !isRetentionRetry) {
  if (!isPremium) {
    throw new Error("Premium subscription required");
  }


  if (userUuid) {
    const res = await db.query(
      `
      UPDATE premium_entitlements
      SET monthly_unlocks_used = monthly_unlocks_used + 1
      WHERE user_uuid = $1
        AND premium_until > NOW()
        AND monthly_unlocks_used < 3
      RETURNING monthly_unlocks_used
      `,
      [userUuid]
    );

    if (res.rowCount === 0) {
      throw new Error("Monthly free unlock limit reached");
    }
  } else if (guestId) {
    const res = await db.query(
      `
      UPDATE premium_entitlements
      SET monthly_unlocks_used = monthly_unlocks_used + 1
      WHERE guest_id = $1
        AND premium_until > NOW()
        AND monthly_unlocks_used < 3
      RETURNING monthly_unlocks_used
      `,
      [guestId]
    );

    if (res.rowCount === 0) {
      throw new Error("Monthly free unlock limit reached");
    }
  }
}



  // --------------------------------------------------
  // LINK USER → SNAPSHOT
  // --------------------------------------------------
const entitlementOriginal =
  unlockSource === "free"
    ? activeEntitlement?.original_transaction_id
    : null;

const entitlementPeriod =
  unlockSource === "free"
    ? activeEntitlement?.latest_transaction_id
    : null;

// --------------------------------------------------
// LINK USER → SNAPSHOT
// --------------------------------------------------

const unlockInsert = await db.query(
  `
  INSERT INTO unlocked_specs (
    user_id,
    guest_id,
    vrm,
    snapshot_id,
    unlock_type,
    source,
    transaction_id,
    product_id,
    platform,
    entitlement_original_transaction_id,
    entitlement_transaction_id
  )
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
  ON CONFLICT DO NOTHING
  RETURNING id
  `,
  [
    userUuid,
    user ? null : guestId,
    vrmUpper,
    snapshotId,
    unlockSource,
    unlockSource === "paid" ? "iap" : "subscription",
    unlockSource === "paid" ? transactionId : null,
    productId,
    platform,
    entitlementOriginal,
    entitlementPeriod,
  ]
);

const didInsertUnlock = unlockInsert.rowCount > 0;

// --------------------------------------------------
// PAID CREDIT CONSUME (ONLY IF ROW INSERTED)
// --------------------------------------------------
if (unlockSource === "paid" && didInsertUnlock) {
  await db.query(
    `
    INSERT INTO unlock_credits_ledger
      (user_uuid, guest_id, transaction_id, platform, product_id, delta, reason)
    VALUES ($1,$2,$3,$4,$5,-1,'consume_on_unlock')
    `,
    [
      userUuid,
      userUuid ? null : guestId,
      null,
      platform,
      productId,
    ]
  );
}
return {
  alreadyUnlocked: false,
  spec,
  retention: !!spec?._meta?.retention,
  retryAfter: spec?._meta?.retryAfter ?? null,
};

}
