import { Pool } from "pg";

const globalDb = globalThis as unknown as {
  surakshaPool?: Pool;
  schemaReady?: Promise<void>;
};

function poolConfig() {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) return { connectionString: rawUrl, max: 10 };

  const connectionUrl = new URL(rawUrl);
  const sslMode = connectionUrl.searchParams.get("sslmode");
  if (!sslMode || sslMode === "disable")
    return { connectionString: rawUrl, max: 10 };

  // Neon certificates are publicly trusted. Supplying TLS explicitly avoids
  // pg's deprecated sslmode=require compatibility alias and keeps full
  // certificate verification enabled across future pg major versions.
  connectionUrl.searchParams.delete("sslmode");
  return {
    connectionString: connectionUrl.toString(),
    max: 10,
    ssl: { rejectUnauthorized: true },
  };
}

export const db =
  globalDb.surakshaPool ??
  new Pool(poolConfig());
if (process.env.NODE_ENV !== "production") globalDb.surakshaPool = db;

export function ensureSchema() {
  if (!globalDb.schemaReady)
    globalDb.schemaReady = (async () => {
      await db.query(`
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        worker_name TEXT,
        worker_id TEXT,
        contractor TEXT,
        shift_started_at TIMESTAMPTZ,
        last_seen_at TIMESTAMPTZ,
        firmware_version TEXT,
        wearing BOOLEAN NOT NULL DEFAULT false,
        worker_phone TEXT,
        worker_email TEXT,
        joining_date DATE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS wearing BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS worker_phone TEXT;
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS worker_email TEXT;
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS joining_date DATE;
      CREATE TABLE IF NOT EXISTS contractors (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        phone TEXT,
        email TEXT,
        registration_date DATE NOT NULL DEFAULT CURRENT_DATE,
        bank_account_name TEXT,
        bank_account_number TEXT,
        bank_ifsc TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS contractor_id BIGINT REFERENCES contractors(id);
      INSERT INTO contractors(name)
      SELECT DISTINCT contractor FROM devices
      WHERE contractor IS NOT NULL AND contractor <> ''
      ON CONFLICT(name) DO NOTHING;
      UPDATE devices d SET contractor_id=c.id
      FROM contractors c
      WHERE d.contractor_id IS NULL AND d.contractor=c.name;
      CREATE TABLE IF NOT EXISTS thresholds (
        id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        pm25 DOUBLE PRECISION NOT NULL DEFAULT 60,
        pm10 DOUBLE PRECISION NOT NULL DEFAULT 100,
        gas_ppm DOUBLE PRECISION NOT NULL DEFAULT 200,
        minimum_battery DOUBLE PRECISION NOT NULL DEFAULT 20,
        heart_rate_low DOUBLE PRECISION NOT NULL DEFAULT 50,
        heart_rate_high DOUBLE PRECISION NOT NULL DEFAULT 120,
        spo2_low DOUBLE PRECISION NOT NULL DEFAULT 94,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      INSERT INTO thresholds (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
      CREATE TABLE IF NOT EXISTS telemetry (
        id BIGSERIAL PRIMARY KEY,
        device_id TEXT NOT NULL REFERENCES devices(id),
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        pm25 DOUBLE PRECISION,
        pm10 DOUBLE PRECISION,
        particle_sensor TEXT,
        dust_raw INTEGER,
        dust_voltage DOUBLE PRECISION,
        gas_ppm DOUBLE PRECISION,
        gas_raw INTEGER,
        heart_rate DOUBLE PRECISION,
        spo2 DOUBLE PRECISION,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        gps_valid BOOLEAN NOT NULL DEFAULT false,
        battery_pct DOUBLE PRECISION,
        battery_voltage DOUBLE PRECISION,
        solar_voltage DOUBLE PRECISION,
        motion TEXT NOT NULL CHECK (motion IN ('normal','anomaly','fall')),
        accel_x DOUBLE PRECISION,
        accel_y DOUBLE PRECISION,
        accel_z DOUBLE PRECISION,
        risk_score INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
        wear_detected BOOLEAN NOT NULL DEFAULT false,
        alert_reasons TEXT[] NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS telemetry_device_time_idx ON telemetry(device_id, recorded_at DESC);
      ALTER TABLE telemetry ADD COLUMN IF NOT EXISTS particle_sensor TEXT;
      ALTER TABLE telemetry ADD COLUMN IF NOT EXISTS dust_raw INTEGER;
      ALTER TABLE telemetry ADD COLUMN IF NOT EXISTS dust_voltage DOUBLE PRECISION;
      ALTER TABLE telemetry ADD COLUMN IF NOT EXISTS wear_detected BOOLEAN NOT NULL DEFAULT false;
      UPDATE telemetry
      SET wear_detected = true
      WHERE wear_detected = false AND heart_rate BETWEEN 35 AND 220;
      ALTER TABLE telemetry DROP CONSTRAINT IF EXISTS telemetry_motion_check;
      ALTER TABLE telemetry ADD CONSTRAINT telemetry_motion_check CHECK (motion IN ('normal','anomaly','fall','unavailable'));
      CREATE TABLE IF NOT EXISTS alerts (
        id BIGSERIAL PRIMARY KEY,
        device_id TEXT NOT NULL REFERENCES devices(id),
        telemetry_id BIGINT REFERENCES telemetry(id),
        severity TEXT NOT NULL,
        message TEXT NOT NULL,
        acknowledged_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS health_visits (
        id BIGSERIAL PRIMARY KEY,
        device_id TEXT NOT NULL REFERENCES devices(id),
        status TEXT NOT NULL DEFAULT 'dispatched',
        outcome TEXT,
        medical_test_url TEXT,
        scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS ngo_accounts (
        id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        name TEXT NOT NULL DEFAULT 'Suraksha NGO Relief Fund',
        initial_balance_paise BIGINT NOT NULL DEFAULT 1000000,
        balance_paise BIGINT NOT NULL DEFAULT 1000000 CHECK (balance_paise >= 0),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      INSERT INTO ngo_accounts (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
      CREATE TABLE IF NOT EXISTS ngo_cases (
        id BIGSERIAL PRIMARY KEY,
        device_id TEXT NOT NULL REFERENCES devices(id),
        telemetry_id BIGINT REFERENCES telemetry(id),
        incident_day DATE NOT NULL,
        status TEXT NOT NULL DEFAULT 'dispatched' CHECK (status IN ('dispatched','paid')),
        dispatched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        approved_at TIMESTAMPTZ,
        approved_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(device_id, incident_day)
      );
      CREATE TABLE IF NOT EXISTS worker_accounts (
        device_id TEXT PRIMARY KEY REFERENCES devices(id),
        balance_paise BIGINT NOT NULL DEFAULT 0 CHECK (balance_paise >= 0),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS ngo_payouts (
        id BIGSERIAL PRIMARY KEY,
        case_id BIGINT NOT NULL UNIQUE REFERENCES ngo_cases(id),
        device_id TEXT NOT NULL REFERENCES devices(id),
        amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
        status TEXT NOT NULL DEFAULT 'recorded' CHECK (status = 'recorded'),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      INSERT INTO ngo_cases (device_id, telemetry_id, incident_day)
      SELECT DISTINCT ON (device_id, (recorded_at AT TIME ZONE 'Asia/Kolkata')::date)
        device_id, id, (recorded_at AT TIME ZONE 'Asia/Kolkata')::date
      FROM telemetry
      WHERE wear_detected = true AND risk_score >= 75
      ORDER BY device_id, (recorded_at AT TIME ZONE 'Asia/Kolkata')::date, risk_score DESC, recorded_at ASC
      ON CONFLICT (device_id, incident_day) DO NOTHING;
    `);
    })().catch((error) => {
      globalDb.schemaReady = undefined;
      throw error;
    });
  return globalDb.schemaReady;
}
