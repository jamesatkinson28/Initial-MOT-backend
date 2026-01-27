import { buildFingerprint } from "../routes/spec.js";
import { fetchSpecDataFromAPI } from "./specProvider.js";

const DVLA_CACHE_TTL_HOURS = 24;
/**
 * Build a spec-shaped core identity object from DVLA lookup data
 * (NO provider data, NO DVSA free text)
 */
function buildCoreIdentityFromDvla(dvlaVehicle) {
  if (!dvlaVehicle) return null;

  return {
    identity: {
      make: dvlaVehicle.make || null,
      model: dvlaVehicle.model || null, // DVLA short model if present
      year_of_manufacture: dvlaVehicle.manufactureDate
        ? new Date(dvlaVehicle.manufactureDate).getFullYear()
        : null,
      body_style: dvlaVehicle.bodyType || null,
    },
    engine: {
      engine_cc: dvlaVehicle.engineCapacity
        ? Number(dvlaVehicle.engineCapacity)
        : null,
      fuel_type: dvlaVehicle.fuelType || null,
    },
  };
}

/**
 * MAIN UNLOCK FUNCTION
 */
export async function unlockSpec({ db, vrm, user, dvlaVehicle }) {
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
  // SNAPSHOT RESOLUTION (NO API UNLESS NEEDED)
  // --------------------------------------------------
  const latestSnapshot = await db.query(
    `
    SELECT id, fingerprint, spec_json
    FROM vehicle_spec_snapshots
    WHERE vrm=$1
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [vrmUpper]
  );

  let snapshotId;
  let spec;

  if (latestSnapshot.rowCount === 0) {
    // 🆕 First ever unlock for this VRM
    const result = await fetchSpecDataFromAPI(vrmUpper);
    if (!result?.spec) throw new Error("Spec fetch failed");

    spec = result.spec;

    const ins = await db.query(
      `
      INSERT INTO vehicle_spec_snapshots (vrm, spec_json, fingerprint)
      VALUES ($1, $2, $3)
      RETURNING id
      `,
      [vrmUpper, spec, currentFingerprint]
    );

    snapshotId = ins.rows[0].id;

  } else if (latestSnapshot.rows[0].fingerprint === currentFingerprint) {
    // ✅ Same vehicle → reuse snapshot, NO PROVIDER CALL
    snapshotId = latestSnapshot.rows[0].id;
    spec = latestSnapshot.rows[0].spec_json;

  } else {
    // 🔁 Plate reused / identity changed
    const result = await fetchSpecDataFromAPI(vrmUpper);
    if (!result?.spec) throw new Error("Spec fetch failed");

    spec = result.spec;

    const ins = await db.query(
      `
      INSERT INTO vehicle_spec_snapshots (vrm, spec_json, fingerprint)
      VALUES ($1, $2, $3)
      RETURNING id
      `,
      [vrmUpper, spec, currentFingerprint]
    );

    snapshotId = ins.rows[0].id;
  }

  if (!snapshotId) {
    throw new Error("Snapshot resolution failed");
  }

  // --------------------------------------------------
  // LINK USER → SNAPSHOT
  // --------------------------------------------------
  await db.query(
    `
    INSERT INTO unlocked_specs (user_id, vrm, snapshot_id)
    VALUES ($1, $2, $3)
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

  return { unlocked: true, spec };
}
