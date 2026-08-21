import { NextRequest, NextResponse } from "next/server";
import { db, ensureSchema } from "../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSchema();
    const result = await db.query(`
      SELECT c.id,c.name,c.phone,c.email,c.registration_date,c.created_at,
             COALESCE(
               json_agg(
                 json_build_object(
                   'device_id',d.id,'worker_name',d.worker_name,'worker_id',d.worker_id,
                   'phone',d.worker_phone,'email',d.worker_email,
                   'joining_date',d.joining_date,'last_seen_at',d.last_seen_at,
                   'wearing',d.wearing,'firmware_version',d.firmware_version
                 ) ORDER BY d.worker_name
               ) FILTER (WHERE d.id IS NOT NULL), '[]'::json
             ) AS workers
      FROM contractors c
      LEFT JOIN devices d ON d.contractor_id=c.id
      GROUP BY c.id
      ORDER BY c.name
    `);
    return NextResponse.json({ contractors: result.rows });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Could not load contractors" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (
    !body ||
    !["add-contractor", "update-contractor", "add-worker"].includes(body.action)
  )
    return NextResponse.json({ error: "Unsupported action" }, { status: 422 });

  try {
    await ensureSchema();
    if (body.action === "add-contractor") {
      if (typeof body.name !== "string" || !body.name.trim())
        return NextResponse.json(
          { error: "Contractor name is required" },
          { status: 422 },
        );
      const result = await db.query(
        `INSERT INTO contractors(name,phone,email,registration_date,
          bank_account_name,bank_account_number,bank_ifsc)
         VALUES($1,$2,$3,COALESCE($4::date,CURRENT_DATE),$5,$6,$7)
         RETURNING id,name,phone,email,registration_date`,
        [
          body.name.trim(),
          body.phone?.trim() || null,
          body.email?.trim() || null,
          body.registrationDate || null,
          body.bankAccountName?.trim() || null,
          body.bankAccountNumber?.trim() || null,
          body.bankIfsc?.trim() || null,
        ],
      );
      return NextResponse.json(result.rows[0], { status: 201 });
    }

    if (body.action === "update-contractor") {
      if (
        !Number.isInteger(Number(body.contractorId)) ||
        typeof body.name !== "string" ||
        !body.name.trim()
      )
        return NextResponse.json(
          { error: "Contractor and name are required" },
          { status: 422 },
        );
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(
          `UPDATE contractors SET name=$2,phone=$3,email=$4,
             registration_date=COALESCE($5::date,registration_date),
             bank_account_name=COALESCE(NULLIF($6,''),bank_account_name),
             bank_account_number=COALESCE(NULLIF($7,''),bank_account_number),
             bank_ifsc=COALESCE(NULLIF($8,''),bank_ifsc),updated_at=now()
           WHERE id=$1 RETURNING id,name,phone,email,registration_date`,
          [
            Number(body.contractorId),
            body.name.trim(),
            body.phone?.trim() || null,
            body.email?.trim() || null,
            body.registrationDate || null,
            body.bankAccountName?.trim() || "",
            body.bankAccountNumber?.trim() || "",
            body.bankIfsc?.trim() || "",
          ],
        );
        if (!result.rowCount) {
          await client.query("ROLLBACK");
          return NextResponse.json(
            { error: "Contractor was not found" },
            { status: 404 },
          );
        }
        await client.query(
          "UPDATE devices SET contractor=$2 WHERE contractor_id=$1",
          [Number(body.contractorId), body.name.trim()],
        );
        await client.query("COMMIT");
        return NextResponse.json(result.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }

    if (
      typeof body.deviceId !== "string" ||
      !body.deviceId.trim() ||
      typeof body.workerName !== "string" ||
      !body.workerName.trim() ||
      !Number.isInteger(Number(body.contractorId))
    )
      return NextResponse.json(
        { error: "Device ID, worker name and contractor are required" },
        { status: 422 },
      );

    const result = await db.query(
      `INSERT INTO devices(id,worker_name,worker_id,worker_phone,worker_email,
        joining_date,contractor_id,contractor)
       SELECT $1,$2,$3,$4,$5,COALESCE($6::date,CURRENT_DATE),c.id,c.name
       FROM contractors c WHERE c.id=$7
       ON CONFLICT(id) DO UPDATE SET
         worker_name=EXCLUDED.worker_name,worker_id=EXCLUDED.worker_id,
         worker_phone=EXCLUDED.worker_phone,worker_email=EXCLUDED.worker_email,
         joining_date=EXCLUDED.joining_date,contractor_id=EXCLUDED.contractor_id,
         contractor=EXCLUDED.contractor
       RETURNING id,worker_name,worker_id,contractor`,
      [
        body.deviceId.trim(),
        body.workerName.trim(),
        body.workerId?.trim() || null,
        body.phone?.trim() || null,
        body.email?.trim() || null,
        body.joiningDate || null,
        Number(body.contractorId),
      ],
    );
    if (!result.rowCount)
      return NextResponse.json(
        { error: "Contractor was not found" },
        { status: 404 },
      );
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    console.error(error);
    const message =
      error instanceof Error && "code" in error && error.code === "23505"
        ? "A contractor with that name already exists"
        : "Could not save this record";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
