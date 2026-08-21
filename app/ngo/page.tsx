"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type NgoCase = {
  id: string;
  status: "dispatched" | "paid";
  incident_day: string;
  dispatched_at: string;
  approved_at: string | null;
  device_id: string;
  worker_name: string | null;
  worker_id: string | null;
  contractor: string | null;
  recorded_at: string;
  risk_score: number;
  pm25: number | null;
  gas_ppm: number | null;
  heart_rate: number | null;
  spo2: number | null;
  worker_balance: number;
  amount: number | null;
};

type NgoData = {
  stats: {
    users: number;
    rag_pickers: number;
    affected: number;
    awaiting_approval: number;
  };
  account: {
    name: string;
    initialBalance: number;
    balance: number;
    totalPaid: number;
    updatedAt: string;
  };
  cases: NgoCase[];
  payouts: Array<{
    id: string;
    created_at: string;
    amount: number;
    status: string;
    worker_name: string | null;
    worker_id: string | null;
  }>;
  settlementMode: "internal-ledger";
  contractors: Array<{
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    registration_date: string;
    bank_account_name: string | null;
    bank_account_number: string | null;
    bank_ifsc: string | null;
    workers: Array<{
      device_id: string;
      worker_name: string;
      worker_id: string;
    }>;
  }>;
};

const rupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export default function NgoDashboard() {
  const [data, setData] = useState<NgoData | null>(null);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [busyCase, setBusyCase] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [authRequired, setAuthRequired] = useState(false);
  const [pin, setPin] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/ngo", { cache: "no-store" });
      if (response.status === 401) {
        setAuthRequired(true);
        setData(null);
        setError("");
        return;
      }
      if (!response.ok) throw new Error();
      setData(await response.json());
      setAuthRequired(false);
      setError("");
    } catch {
      setError("The NGO response data could not be loaded.");
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5_000);
    return () => clearInterval(timer);
  }, [load]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/ngo/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error || "NGO sign-in failed");
      return;
    }
    setPin("");
    await load();
  }

  async function approveAndPay(aidCase: NgoCase) {
    const amount = amounts[aidCase.id] ?? 1_000;
    setBusyCase(aidCase.id);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/ngo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve-and-pay",
          caseId: Number(aidCase.id),
          amountRupees: amount,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Payment failed");
      setMessage(
        `${rupees.format(amount)} was credited to ${aidCase.worker_name ?? aidCase.worker_id ?? aidCase.device_id}'s internal worker account.`,
      );
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Payment could not be recorded.",
      );
    } finally {
      setBusyCase(null);
    }
  }

  return (
    <main className="ngo-shell">
      <aside>
        <div className="brand">
          <span className="shield">✦</span>
          <span>
            SURAKSHA
            <br />
            <b>WATCH</b>
          </span>
        </div>
        <p className="org">NGO RESPONSE DESK</p>
        <a className="nav" href="/">
          <span className="icon">◉</span>
          Worker monitoring
        </a>
        <a className="nav active" href="/ngo">
          <span className="icon">✚</span>
          NGO response
        </a>
        <a className="nav" href="/contractors">
          <span className="icon">▣</span>
          Contractors
        </a>
        <div className="sidebar-bottom">
          <b>Automatic response</b>
          <small>Risk ≥75 triggers help dispatch</small>
        </div>
      </aside>

      <section className="content ngo-content">
        <header>
          <div>
            <p className="eyebrow">NGO OPERATIONS · POSTGRESQL LEDGER</p>
            <h1>Rag Picker Assistance Panel</h1>
          </div>
          <div className="live-time">
            Auto-refresh
            <br />
            <b>Every 5 seconds</b>
          </div>
        </header>

        {error ? <div className="notice error">{error}</div> : null}
        {message ? (
          <div className="notice">
            ✓ {message}
            <button onClick={() => setMessage("")}>×</button>
          </div>
        ) : null}

        {authRequired ? (
          <form className="panel ngo-login" onSubmit={signIn}>
            <small>RESTRICTED NGO ACCESS</small>
            <h2>Sign in to view financial and bank information</h2>
            <p>
              Contractor and worker bank details are protected by an NGO-only
              HTTP-only session.
            </p>
            <label>
              NGO access PIN
              <input
                aria-label="NGO access PIN"
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                required
              />
            </label>
            <button className="primary">Sign in to NGO panel</button>
          </form>
        ) : !data ? (
          <article className="panel waiting">
            <div className="pulse-dot" />
            <h2>Loading NGO response data</h2>
          </article>
        ) : (
          <>
            <section className="ngo-stats" aria-label="NGO summary">
              <Summary label="REGISTERED USERS" value={data.stats.users} />
              <Summary label="RAG PICKERS" value={data.stats.rag_pickers} />
              <Summary
                label="THRESHOLD CROSSED"
                value={data.stats.affected}
                tone="danger"
              />
              <Summary
                label="AWAITING APPROVAL"
                value={data.stats.awaiting_approval}
                tone="warn"
              />
            </section>

            <section className="ngo-grid">
              <div className="ngo-cases">
                <div className="section-title">
                  <div>
                    <small>AUTOMATIC HELP DISPATCH</small>
                    <h2>Affected rag pickers</h2>
                  </div>
                  <span>Risk threshold: 75/100</span>
                </div>

                {data.cases.length ? (
                  data.cases.map((aidCase) => (
                    <article className="panel case-card" key={aidCase.id}>
                      <div className="case-head">
                        <div>
                          <span className={`case-status ${aidCase.status}`}>
                            {aidCase.status === "paid"
                              ? "✓ COMPENSATION RECORDED"
                              : "● HELP DISPATCHED"}
                          </span>
                          <h2>{aidCase.worker_name ?? "Unnamed rag picker"}</h2>
                          <p>
                            {aidCase.worker_id ?? aidCase.device_id} ·{" "}
                            {aidCase.contractor ?? "No contractor"}
                          </p>
                        </div>
                        <strong className="danger-text">
                          {aidCase.risk_score ?? "—"}
                          <small>/100 risk</small>
                        </strong>
                      </div>
                      <div className="case-metrics">
                        <span>
                          Mixed particles
                          <b>{aidCase.pm25?.toFixed(1) ?? "—"} µg/m³</b>
                        </span>
                        <span>
                          Heart rate
                          <b>{aidCase.heart_rate?.toFixed(0) ?? "—"} BPM</b>
                        </span>
                        <span>
                          SpO₂
                          <b>{aidCase.spo2?.toFixed(0) ?? "—"}%</b>
                        </span>
                        <span>
                          Worker balance
                          <b>{rupees.format(aidCase.worker_balance)}</b>
                        </span>
                      </div>
                      <p className="dispatch-time">
                        Health assistance dispatched automatically on{" "}
                        {new Date(aidCase.dispatched_at).toLocaleString(
                          "en-IN",
                        )}
                      </p>
                      {aidCase.status === "dispatched" ? (
                        <div className="approval-row">
                          <label>
                            Compensation
                            <span>
                              ₹
                              <input
                                aria-label={`Compensation for ${aidCase.worker_name ?? aidCase.device_id}`}
                                type="number"
                                min="1"
                                max={data.account.balance}
                                value={amounts[aidCase.id] ?? 1_000}
                                onChange={(event) =>
                                  setAmounts((current) => ({
                                    ...current,
                                    [aidCase.id]: Number(event.target.value),
                                  }))
                                }
                              />
                            </span>
                          </label>
                          <button
                            className="primary"
                            disabled={busyCase === aidCase.id}
                            onClick={() => approveAndPay(aidCase)}
                          >
                            {busyCase === aidCase.id
                              ? "Recording transfer…"
                              : "Approve condition & transfer"}
                          </button>
                        </div>
                      ) : (
                        <p className="paid-line">
                          Paid {rupees.format(aidCase.amount ?? 0)} ·{" "}
                          {aidCase.approved_at
                            ? new Date(aidCase.approved_at).toLocaleString(
                                "en-IN",
                              )
                            : "Recorded"}
                        </p>
                      )}
                    </article>
                  ))
                ) : (
                  <article className="panel empty-cases">
                    <h2>No workers have crossed the risk threshold</h2>
                    <p>
                      New wear-verified incidents will appear automatically.
                    </p>
                  </article>
                )}
              </div>

              <div className="fund-panel">
                <article className="panel fund-card">
                  <small>NGO RELIEF ACCOUNT</small>
                  <h2>{data.account.name}</h2>
                  <b>{rupees.format(data.account.balance)}</b>
                  <p>Available internal ledger balance</p>
                  <div className="fund-bar">
                    <i
                      style={{
                        width: `${Math.max(0, (data.account.balance / data.account.initialBalance) * 100)}%`,
                      }}
                    />
                  </div>
                  <div className="fund-split">
                    <span>
                      Initial{" "}
                      <b>{rupees.format(data.account.initialBalance)}</b>
                    </span>
                    <span>
                      Paid <b>{rupees.format(data.account.totalPaid)}</b>
                    </span>
                  </div>
                  <p className="ledger-note">
                    Demo settlement ledger only. No bank or UPI provider is
                    connected.
                  </p>
                </article>

                <article className="panel payout-card">
                  <small>COMPENSATION LEDGER</small>
                  <h2>Recent transfers</h2>
                  {data.payouts.length ? (
                    data.payouts.map((payout) => (
                      <div className="payout-row" key={payout.id}>
                        <span>
                          <b>{payout.worker_name ?? payout.worker_id}</b>
                          <small>
                            {new Date(payout.created_at).toLocaleString(
                              "en-IN",
                            )}
                          </small>
                        </span>
                        <strong>{rupees.format(payout.amount)}</strong>
                      </div>
                    ))
                  ) : (
                    <p>No compensation has been recorded yet.</p>
                  )}
                </article>
              </div>
            </section>
            <section className="panel ngo-directory">
              <div className="section-title">
                <div>
                  <small>NGO-ONLY TRANSPARENCY VIEW</small>
                  <h2>Contractors, bank details and registered workers</h2>
                </div>
              </div>
              <div className="directory-grid">
                {data.contractors.map((contractor) => (
                  <article className="directory-card" key={contractor.id}>
                    <h2>{contractor.name}</h2>
                    <p>
                      {contractor.phone ?? "No phone"} ·{" "}
                      {contractor.email ?? "No email"}
                    </p>
                    <dl>
                      <div>
                        <dt>Account name</dt>
                        <dd>
                          {contractor.bank_account_name ?? "Not provided"}
                        </dd>
                      </div>
                      <div>
                        <dt>Account number</dt>
                        <dd>
                          {contractor.bank_account_number ?? "Not provided"}
                        </dd>
                      </div>
                      <div>
                        <dt>IFSC</dt>
                        <dd>{contractor.bank_ifsc ?? "Not provided"}</dd>
                      </div>
                    </dl>
                    <b>
                      {contractor.workers.length} registered rag picker
                      {contractor.workers.length === 1 ? "" : "s"}
                    </b>
                    <ul>
                      {contractor.workers.map((worker) => (
                        <li key={worker.device_id}>
                          {worker.worker_name || "Unnamed"}{" "}
                          <span>{worker.worker_id || worker.device_id}</span>
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}
      </section>
    </main>
  );
}

function Summary({
  label,
  value,
  tone = "safe",
}: {
  label: string;
  value: number;
  tone?: "safe" | "warn" | "danger";
}) {
  return (
    <article className="panel summary-card">
      <small>{label}</small>
      <b className={tone}>{value.toLocaleString("en-IN")}</b>
    </article>
  );
}
