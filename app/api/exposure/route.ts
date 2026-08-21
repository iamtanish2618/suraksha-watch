import { NextRequest, NextResponse } from "next/server";
import { db, ensureSchema } from "../../../lib/db";

export const dynamic = "force-dynamic";
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_ZONE = "Asia/Kolkata";

export async function GET(request: NextRequest) {
  try {
    await ensureSchema();
    const date = request.nextUrl.searchParams.get("date");
    const deviceId = request.nextUrl.searchParams.get("deviceId");

    if (date) {
      if (!DAY_PATTERN.test(date)) {
        return NextResponse.json(
          { error: "date must use YYYY-MM-DD" },
          { status: 422 },
        );
      }
      const limit = Math.min(
        1000,
        Math.max(1, Number(request.nextUrl.searchParams.get("limit") || 500)),
      );
      const offset = Math.max(
        0,
        Number(request.nextUrl.searchParams.get("offset") || 0),
      );
      const params = [date, deviceId, limit, offset];
      const where = `wear_detected = true
        AND recorded_at >= ($1::date::timestamp AT TIME ZONE '${TIME_ZONE}')
        AND recorded_at < (($1::date + 1)::timestamp AT TIME ZONE '${TIME_ZONE}')
        AND ($2::text IS NULL OR device_id=$2)`;
      const [rows, count] = await Promise.all([
        db.query(
          `SELECT recorded_at,pm25,particle_sensor,dust_raw,dust_voltage,gas_ppm,
            heart_rate,spo2,battery_pct,battery_voltage,solar_voltage,latitude,
            longitude,risk_score,alert_reasons
           FROM telemetry WHERE ${where}
           ORDER BY recorded_at ASC LIMIT $3 OFFSET $4`,
          params,
        ),
        db.query(
          `SELECT count(*)::int AS total FROM telemetry WHERE ${where}`,
          [date, deviceId],
        ),
      ]);
      return NextResponse.json({ rows: rows.rows, total: count.rows[0].total });
    }

    const days = Math.min(
      60,
      Math.max(1, Number(request.nextUrl.searchParams.get("days") || 60)),
    );
    const result = await db.query(
      `SELECT
         (recorded_at AT TIME ZONE '${TIME_ZONE}')::date::text AS day,
         count(*)::int AS sample_count,
         avg(risk_score)::double precision AS average_risk,
         min(risk_score)::int AS minimum_risk,
         max(risk_score)::int AS maximum_risk,
         avg(pm25)::double precision AS average_particles,
         avg(dust_voltage)::double precision AS average_optical_voltage,
         avg(gas_ppm)::double precision AS average_gas,
         avg(battery_voltage)::double precision AS average_battery_voltage,
         avg(solar_voltage)::double precision AS average_solar_voltage,
         count(*) FILTER (WHERE risk_score >= 75)::int AS high_risk_samples,
         min(recorded_at) AS first_packet_at,
         max(recorded_at) AS last_packet_at
       FROM telemetry
       WHERE wear_detected = true
         AND recorded_at >= now() - ($1 || ' days')::interval
         AND ($2::text IS NULL OR device_id=$2)
       GROUP BY (recorded_at AT TIME ZONE '${TIME_ZONE}')::date
       ORDER BY day DESC`,
      [days, deviceId],
    );
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Could not load exposure averages" },
      { status: 500 },
    );
  }
}
