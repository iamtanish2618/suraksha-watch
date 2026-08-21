import { NextRequest, NextResponse } from "next/server";
import { db, ensureSchema } from "../../../lib/db";
import { isNgoAuthenticated } from "../../../lib/ngo-auth";

export const dynamic = "force-dynamic";

function moneyFromPaise(value: string | number) {
  return Number(value) / 100;
}

export async function GET() {
  if (!(await isNgoAuthenticated()))
    return NextResponse.json(
      { error: "NGO sign-in required" },
      { status: 401 },
    );
  try {
    await ensureSchema();
    const [
      accountResult,
      statsResult,
      casesResult,
      payoutsResult,
      contractorsResult,
    ] = await Promise.all([
      db.query("SELECT * FROM ngo_accounts WHERE id=1"),
      db.query(`
          SELECT
            count(*)::int AS users,
            count(*) FILTER (WHERE worker_id IS NOT NULL AND worker_id <> '')::int AS rag_pickers,
            (SELECT count(DISTINCT device_id)::int FROM ngo_cases) AS affected,
            (SELECT count(*)::int FROM ngo_cases WHERE status='dispatched') AS awaiting_approval
          FROM devices
        `),
      db.query(`
          SELECT c.id,c.status,c.incident_day,c.dispatched_at,c.approved_at,
                 d.id AS device_id,d.worker_name,d.worker_id,d.contractor,
                 t.recorded_at,t.risk_score,t.pm25,t.gas_ppm,t.heart_rate,t.spo2,
                 COALESCE(w.balance_paise,0) AS worker_balance_paise,
                 p.amount_paise
          FROM ngo_cases c
          JOIN devices d ON d.id=c.device_id
          LEFT JOIN telemetry t ON t.id=c.telemetry_id
          LEFT JOIN worker_accounts w ON w.device_id=c.device_id
          LEFT JOIN ngo_payouts p ON p.case_id=c.id
          ORDER BY CASE WHEN c.status='dispatched' THEN 0 ELSE 1 END,
                   c.created_at DESC
        `),
      db.query(`
          SELECT p.id,p.created_at,p.amount_paise,p.status,d.worker_name,d.worker_id
          FROM ngo_payouts p
          JOIN devices d ON d.id=p.device_id
          ORDER BY p.created_at DESC LIMIT 50
        `),
      db.query(`
          SELECT c.id,c.name,c.phone,c.email,c.registration_date,
                 c.bank_account_name,c.bank_account_number,c.bank_ifsc,
                 COALESCE(
                   json_agg(json_build_object(
                     'device_id',d.id,'worker_name',d.worker_name,'worker_id',d.worker_id
                   ) ORDER BY d.worker_name) FILTER (WHERE d.id IS NOT NULL),
                   '[]'::json
                 ) AS workers
          FROM contractors c
          LEFT JOIN devices d ON d.contractor_id=c.id
          GROUP BY c.id ORDER BY c.name
        `),
    ]);

    const account = accountResult.rows[0];
    return NextResponse.json({
      stats: statsResult.rows[0],
      account: {
        name: account.name,
        initialBalance: moneyFromPaise(account.initial_balance_paise),
        balance: moneyFromPaise(account.balance_paise),
        totalPaid:
          moneyFromPaise(account.initial_balance_paise) -
          moneyFromPaise(account.balance_paise),
        updatedAt: account.updated_at,
      },
      cases: casesResult.rows.map((row) => ({
        ...row,
        worker_balance: moneyFromPaise(row.worker_balance_paise),
        amount: row.amount_paise ? moneyFromPaise(row.amount_paise) : null,
        worker_balance_paise: undefined,
        amount_paise: undefined,
      })),
      payouts: payoutsResult.rows.map((row) => ({
        ...row,
        amount: moneyFromPaise(row.amount_paise),
        amount_paise: undefined,
      })),
      contractors: contractorsResult.rows,
      settlementMode: "internal-ledger",
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Could not load NGO response data" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await isNgoAuthenticated()))
    return NextResponse.json(
      { error: "NGO sign-in required" },
      { status: 401 },
    );
  const body = await request.json().catch(() => null);
  if (body?.action !== "approve-and-pay")
    return NextResponse.json({ error: "Unsupported action" }, { status: 422 });

  const caseId = Number(body.caseId);
  const amountRupees = Number(body.amountRupees);
  if (!Number.isInteger(caseId) || caseId < 1)
    return NextResponse.json(
      { error: "Valid caseId required" },
      { status: 422 },
    );
  if (!Number.isFinite(amountRupees) || amountRupees < 1)
    return NextResponse.json(
      { error: "Compensation must be at least ₹1" },
      { status: 422 },
    );

  const amountPaise = Math.round(amountRupees * 100);
  const client = await db.connect();
  try {
    await ensureSchema();
    await client.query("BEGIN");
    const caseResult = await client.query(
      "SELECT * FROM ngo_cases WHERE id=$1 FOR UPDATE",
      [caseId],
    );
    const accountResult = await client.query(
      "SELECT * FROM ngo_accounts WHERE id=1 FOR UPDATE",
    );
    const aidCase = caseResult.rows[0];
    const account = accountResult.rows[0];
    if (!aidCase) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }
    if (aidCase.status === "paid") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "This case has already been paid" },
        { status: 409 },
      );
    }
    if (Number(account.balance_paise) < amountPaise) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "NGO account has insufficient funds" },
        { status: 409 },
      );
    }

    await client.query(
      `UPDATE ngo_accounts
       SET balance_paise=balance_paise-$1,updated_at=now() WHERE id=1`,
      [amountPaise],
    );
    await client.query(
      `INSERT INTO worker_accounts(device_id,balance_paise)
       VALUES($1,$2)
       ON CONFLICT(device_id) DO UPDATE SET
         balance_paise=worker_accounts.balance_paise+EXCLUDED.balance_paise,
         updated_at=now()`,
      [aidCase.device_id, amountPaise],
    );
    const payout = await client.query(
      `INSERT INTO ngo_payouts(case_id,device_id,amount_paise)
       VALUES($1,$2,$3) RETURNING id,created_at`,
      [caseId, aidCase.device_id, amountPaise],
    );
    await client.query(
      `UPDATE ngo_cases SET status='paid',approved_at=now(),approved_by=$2
       WHERE id=$1`,
      [caseId, "NGO operator"],
    );
    await client.query("COMMIT");
    return NextResponse.json({
      paid: true,
      payoutId: payout.rows[0].id,
      amount: amountRupees,
      recordedAt: payout.rows[0].created_at,
      settlementMode: "internal-ledger",
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(error);
    return NextResponse.json(
      { error: "Could not complete compensation" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
