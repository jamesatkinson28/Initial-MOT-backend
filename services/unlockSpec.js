import { buildFingerprint } from "../routes/spec.js";
import { fetchSpecDataFromAPI } from "./specProvider.js";


export async function unlockSpec({ db, vrm, user }) {
  if (!vrm) {
    throw new Error("VRM required");
  }

  const vrmUpper = vrm.toUpperCase();
  const user_id = user.id;

  // Already unlocked?
  const existing = await db.query(
    `SELECT snapshot_id FROM unlocked_specs WHERE user_id=$1 AND vrm=$2`,
    [user_id, vrmUpper]
  );

  if (existing.rowCount > 0) {
    const snap = await db.query(
      `SELECT spec_json FROM vehicle_spec_snapshots WHERE id=$1`,
      [existing.rows[0].snapshot_id]
    );
    return { spec: snap.rows[0]?.spec_json };
  }

  // Fetch spec (cache first)
  let spec;
  const cached = await db.query(
    `SELECT spec_json FROM vehicle_specs WHERE vrm=$1`,
    [vrmUpper]
  );

  if (cached.rowCount > 0) {
    spec = cached.rows[0].spec_json;
  } else {
    const result = await fetchSpecDataFromAPI(vrmUpper);
    if (!result?.spec) throw new Error("Spec fetch failed");
    spec = result.spec;
  }

  const fingerprint = buildFingerprint(spec);
  if (!fingerprint) throw new Error("Fingerprint failed");

  const snapRes = await db.query(
    `
    INSERT INTO vehicle_spec_snapshots (vrm, spec_json, fingerprint)
    VALUES ($1, $2, $3)
    RETURNING id
    `,
    [vrmUpper, spec, fingerprint]
  );

  const snapshotId = snapRes.rows[0]?.id;
  if (!snapshotId) throw new Error("Snapshot insert failed");

  await db.query(
    `INSERT INTO unlocked_specs (user_id, vrm, snapshot_id)
     VALUES ($1, $2, $3)`,
    [user_id, vrmUpper, snapshotId]
  );

  await db.query(
    `
    INSERT INTO vehicle_specs (vrm, spec_json)
    VALUES ($1, $2)
    ON CONFLICT (vrm)
    DO UPDATE SET spec_json=$2, updated_at=NOW()
    `,
    [vrmUpper, spec]
  );

  return { spec };
}
