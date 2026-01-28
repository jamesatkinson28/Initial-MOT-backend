import { buildFingerprint } from "../routes/spec.js";
import { fetchSpecDataFromAPI } from "./specProvider.js";

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



/**
 * MAIN UNLOCK FUNCTION
 */
export async function unlockSpec({ db, vrm, user }) {
  if (!vrm) throw new Error("VRM required");

  const vrmUpper = vrm.toUpperCase();
  const user_id = user.id;


  // --------------------------------------------------
  // LOCK USER ROW (monthly unlock tracking)
  // --------------------------------------------------
  const userRow = await db.query(
    `
    SELECT premium, premium_until, monthly_unlocks_used
    FROM users
    WHERE id=$1
    FOR UPDATE
    `,
    [user_id]
  );

  const u = userRow.rows[0];
  const isPremium =
    u.premium &&
    (!u.premium_until || new Date(u.premium_until) > new Date());

  // --------------------------------------------------
  // ALREADY UNLOCKED?
  // --------------------------------------------------
  const existing = await db.query(
    `
    SELECT snapshot_id
    FROM unlocked_specs
    WHERE user_id=$1 AND vrm=$2
    `,
    [user_id, vrmUpper]
  );

  if (existing.rowCount > 0) {
    const snap = await db.query(
      `
      SELECT spec_json
      FROM vehicle_spec_snapshots
      WHERE id=$1
      `,
      [existing.rows[0].snapshot_id]
    );

    return {
      alreadyUnlocked: true,
      spec: snap.rows[0]?.spec_json || null,
    };
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
  
  const providerStatus = await db.query(
  `
  SELECT status_code, retry_after
  FROM vrm_provider_status
  WHERE vrm = $1
  `,
  [vrmUpper]
);

if (
  providerStatus.rowCount > 0 &&
  providerStatus.rows[0].retry_after &&
  new Date(providerStatus.rows[0].retry_after) > new Date()
) {
  throw new Error(
    "This registration is temporarily unavailable due to DVLA updates."
  );
}

  // Fetch provider spec (only now)
  const result = await fetchSpecDataFromAPI(vrmUpper);
  if (result?.statusCode === "PlateInRetentionLastVehicleReturned") {
	    console.warn("🛑 PROVIDER RETENTION", {
    vrm: vrmUpper,
    statusCode: result.statusCode,
  });
  await db.query(
    `
    INSERT INTO vrm_provider_status
      (vrm, status_code, last_checked_at, retry_after)
    VALUES ($1, $2, NOW(), $3)
    ON CONFLICT (vrm)
    DO UPDATE SET
      status_code = EXCLUDED.status_code,
      last_checked_at = NOW(),
      retry_after = EXCLUDED.retry_after
    `,
    [vrmUpper, result.statusCode, nextWeeklyRetryDate()]
  );

  throw new Error(
    "This registration is currently in retention. Please try again later."
  );
}


  if (!result?.spec) {
    throw new Error("Failed to fetch spec for new vehicle");
  }

  // Create new snapshot
  const snapInsert = await db.query(
    `
    INSERT INTO vehicle_spec_snapshots (vrm, spec_json, fingerprint)
    VALUES ($1, $2, $3)
    RETURNING id
    `,
    [vrmUpper, result.spec, currentFingerprint]
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
  // LINK USER → SNAPSHOT
  // --------------------------------------------------
  await db.query(
    `
    INSERT INTO unlocked_specs (user_id, vrm, snapshot_id)
    VALUES ($1, $2, $3)
	ON CONFLICT (user_id, vrm) DO NOTHING
    `,
    [user_id, vrmUpper, snapshotId]
  );

  // --------------------------------------------------
  // INCREMENT MONTHLY FREE UNLOCKS (PREMIUM ONLY)
  // --------------------------------------------------
  if (isPremium && u.monthly_unlocks_used < 3) {
    await db.query(
      `
      UPDATE users
      SET monthly_unlocks_used = monthly_unlocks_used + 1
      WHERE id=$1
      `,
      [user_id]
    );
  }

  return {
    unlocked: true,
   spec,
    plateReused,
  };

}
