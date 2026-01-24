import { query } from "../db/db.js";

// Helper already written by you — move it here
async function createSpecSnapshot(vrm, spec) {
  const result = await query(
    `
    INSERT INTO vehicle_spec_snapshots (
      vrm,
      spec_json,
      vin,
      engine_code
    )
    VALUES ($1, $2, $3, $4)
    RETURNING *
    `,
    [
      vrm,
      spec,
      spec?.identity?.vin ?? null,
      spec?.engine?.engine_code ?? null,
    ]
  );

  return result.rows[0];
}

export async function unlockSpecForUser({ userId, vrm, spec }) {
  const vrmUpper = vrm.toUpperCase();

  await query("BEGIN");

  try {
    // 1️⃣ Already unlocked?
    const existing = await query(
      `
      SELECT snapshot_id
      FROM unlocked_specs
      WHERE user_id = $1 AND vrm = $2
      `,
      [userId, vrmUpper]
    );

    if (existing.rowCount > 0) {
	  const snap = await query(
		`
		SELECT s.spec_json
		FROM unlocked_specs u
		JOIN vehicle_spec_snapshots s ON s.id = u.snapshot_id
		WHERE u.user_id = $1 AND u.vrm = $2
		`,
		[userId, vrmUpper]
	  );

	  const spec = snap.rows[0]?.spec_json;

	  await query("ROLLBACK");

	  return {
		alreadyUnlocked: true,
		snapshotId: existing.rows[0].snapshot_id,
		spec,
	  };
	}


    // 2️⃣ Snapshot reuse
    const latestSnapshotRes = await query(
      `
      SELECT *
      FROM vehicle_spec_snapshots
      WHERE vrm = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [vrmUpper]
    );

    let snapshot;

    if (
      latestSnapshotRes.rowCount > 0 &&
      JSON.stringify(latestSnapshotRes.rows[0].spec_json) ===
        JSON.stringify(spec)
    ) {
      snapshot = latestSnapshotRes.rows[0];
    } else {
      snapshot = await createSpecSnapshot(vrmUpper, spec);
    }

    // 3️⃣ Persist unlock
    await query(
      `
      INSERT INTO unlocked_specs (user_id, vrm, snapshot_id)
      VALUES ($1, $2, $3)
	  ON CONFLICT (user_id, vrm) DO NOTHING
      `,
      [userId, vrmUpper, snapshot.id]
    );
	
	const confirmed = await query(
	  `
	  SELECT snapshot_id
	  FROM unlocked_specs
	  WHERE user_id = $1 AND vrm = $2
	  `,
	  [userId, vrmUpper]
	);

	const finalSnapshotId = confirmed.rows[0]?.snapshot_id;

	await query("COMMIT");

	return {
	  alreadyUnlocked:
		existing.rowCount > 0 || finalSnapshotId !== snapshot.id,
	  snapshotId: finalSnapshotId,
	  spec: snapshot.spec_json,
	};
  } catch (err) {
    await query("ROLLBACK");
    throw err;
  }
}
