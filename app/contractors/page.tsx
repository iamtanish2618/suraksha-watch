"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Worker = {
  device_id: string;
  worker_name: string | null;
  worker_id: string | null;
  phone: string | null;
  email: string | null;
  joining_date: string | null;
  last_seen_at: string | null;
  wearing: boolean;
  firmware_version: string | null;
};

type Contractor = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  registration_date: string;
  workers: Worker[];
};

const initialContractor = {
  name: "",
  phone: "",
  email: "",
  registrationDate: new Date().toISOString().slice(0, 10),
  bankAccountName: "",
  bankAccountNumber: "",
  bankIfsc: "",
};

const initialWorker = {
  deviceId: "",
  workerName: "",
  workerId: "",
  phone: "",
  email: "",
  joiningDate: new Date().toISOString().slice(0, 10),
  contractorId: "",
};

export default function ContractorsPage() {
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [showForm, setShowForm] = useState<"contractor" | "worker" | null>(
    null,
  );
  const [editingContractorId, setEditingContractorId] = useState<string | null>(
    null,
  );
  const [contractorForm, setContractorForm] = useState(initialContractor);
  const [workerForm, setWorkerForm] = useState(initialWorker);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/contractors", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const result = await response.json();
      setContractors(result.contractors);
      setError("");
    } catch {
      setError("The contractor directory could not be loaded.");
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5_000);
    return () => clearInterval(timer);
  }, [load]);

  async function submit(
    event: FormEvent<HTMLFormElement>,
    body: Record<string, unknown>,
    success: string,
  ) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/contractors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save");
      setNotice(success);
      setShowForm(null);
      setContractorForm(initialContractor);
      setEditingContractorId(null);
      setWorkerForm(initialWorker);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main>
      <aside>
        <div className="brand">
          <span className="shield">✦</span>
          <span>
            SURAKSHA
            <br />
            <b>WATCH</b>
          </span>
        </div>
        <p className="org">CONTRACTOR DIRECTORY</p>
        <a className="nav" href="/">
          <span className="icon">◉</span>
          Worker monitoring
        </a>
        <a className="nav" href="/ngo">
          <span className="icon">✚</span>
          NGO response
        </a>
        <a className="nav active" href="/contractors">
          <span className="icon">▣</span>
          Contractors
        </a>
        <div className="sidebar-bottom">
          <b>Shared verification directory</b>
          <small>Contractors and assigned rag pickers</small>
        </div>
      </aside>

      <section className="content contractor-content">
        <header>
          <div>
            <p className="eyebrow">SHARED REGISTRY · POSTGRESQL</p>
            <h1>Contractors & Registered Rag Pickers</h1>
          </div>
          <div className="header-actions">
            <button
              className="outline add-record"
              onClick={() => {
                setEditingContractorId(null);
                setContractorForm(initialContractor);
                setShowForm("contractor");
              }}
            >
              ＋ Contractor
            </button>
            <button
              className="primary add-record"
              onClick={() => setShowForm("worker")}
            >
              ＋ Rag picker
            </button>
          </div>
        </header>

        {error ? <div className="notice error">{error}</div> : null}
        {notice ? (
          <div className="notice">
            ✓ {notice}
            <button onClick={() => setNotice("")}>×</button>
          </div>
        ) : null}

        {showForm === "contractor" ? (
          <form
            className="panel registry-form"
            onSubmit={(event) =>
              submit(
                event,
                {
                  action: editingContractorId
                    ? "update-contractor"
                    : "add-contractor",
                  contractorId: editingContractorId,
                  ...contractorForm,
                },
                editingContractorId
                  ? "Contractor details updated."
                  : "Contractor added to the shared registry.",
              )
            }
          >
            <div className="form-title">
              <div>
                <small>
                  {editingContractorId ? "EDIT CONTRACTOR" : "NEW CONTRACTOR"}
                </small>
                <h2>Registration and settlement details</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowForm(null);
                  setEditingContractorId(null);
                }}
              >
                ×
              </button>
            </div>
            <div className="registry-fields">
              <Field
                label="Contractor name"
                required
                value={contractorForm.name}
                onChange={(name) => setContractorForm((x) => ({ ...x, name }))}
              />
              <Field
                label="Phone number"
                value={contractorForm.phone}
                onChange={(phone) =>
                  setContractorForm((x) => ({ ...x, phone }))
                }
              />
              <Field
                label="Email address"
                type="email"
                value={contractorForm.email}
                onChange={(email) =>
                  setContractorForm((x) => ({ ...x, email }))
                }
              />
              <Field
                label="Registration date"
                type="date"
                value={contractorForm.registrationDate}
                onChange={(registrationDate) =>
                  setContractorForm((x) => ({ ...x, registrationDate }))
                }
              />
              <Field
                label="Bank account name"
                value={contractorForm.bankAccountName}
                onChange={(bankAccountName) =>
                  setContractorForm((x) => ({ ...x, bankAccountName }))
                }
              />
              <Field
                label="Bank account number"
                value={contractorForm.bankAccountNumber}
                onChange={(bankAccountNumber) =>
                  setContractorForm((x) => ({ ...x, bankAccountNumber }))
                }
              />
              <Field
                label="IFSC code"
                value={contractorForm.bankIfsc}
                onChange={(bankIfsc) =>
                  setContractorForm((x) => ({ ...x, bankIfsc }))
                }
              />
            </div>
            <p className="privacy-note">
              Bank details are stored but omitted from the contractor-directory
              API and rendered only in the NGO transparency view.
            </p>
            <button className="primary" disabled={saving}>
              {saving
                ? "Saving…"
                : editingContractorId
                  ? "Update contractor"
                  : "Save contractor"}
            </button>
          </form>
        ) : null}

        {showForm === "worker" ? (
          <form
            className="panel registry-form"
            onSubmit={(event) =>
              submit(
                event,
                { action: "add-worker", ...workerForm },
                "Rag picker linked to the selected contractor.",
              )
            }
          >
            <div className="form-title">
              <div>
                <small>NEW USER</small>
                <h2>Register a rag picker and device</h2>
              </div>
              <button type="button" onClick={() => setShowForm(null)}>
                ×
              </button>
            </div>
            <div className="registry-fields">
              <Field
                label="Worker name"
                required
                value={workerForm.workerName}
                onChange={(workerName) =>
                  setWorkerForm((x) => ({ ...x, workerName }))
                }
              />
              <Field
                label="Worker / Aadhaar-linked ID"
                value={workerForm.workerId}
                onChange={(workerId) =>
                  setWorkerForm((x) => ({ ...x, workerId }))
                }
              />
              <Field
                label="ESP32 device ID"
                required
                value={workerForm.deviceId}
                onChange={(deviceId) =>
                  setWorkerForm((x) => ({ ...x, deviceId }))
                }
              />
              <Field
                label="Phone number"
                value={workerForm.phone}
                onChange={(phone) => setWorkerForm((x) => ({ ...x, phone }))}
              />
              <Field
                label="Email address"
                type="email"
                value={workerForm.email}
                onChange={(email) => setWorkerForm((x) => ({ ...x, email }))}
              />
              <Field
                label="Joining date"
                type="date"
                value={workerForm.joiningDate}
                onChange={(joiningDate) =>
                  setWorkerForm((x) => ({ ...x, joiningDate }))
                }
              />
              <label>
                Contractor
                <select
                  required
                  value={workerForm.contractorId}
                  onChange={(event) =>
                    setWorkerForm((x) => ({
                      ...x,
                      contractorId: event.target.value,
                    }))
                  }
                >
                  <option value="">Select contractor</option>
                  {contractors.map((contractor) => (
                    <option key={contractor.id} value={contractor.id}>
                      {contractor.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button className="primary" disabled={saving}>
              {saving ? "Saving…" : "Register rag picker"}
            </button>
          </form>
        ) : null}

        <section className="contractor-list" aria-label="Contractor directory">
          {contractors.map((contractor) => (
            <article className="panel contractor-card" key={contractor.id}>
              <div className="contractor-head">
                <div className="contractor-avatar">
                  {contractor.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <small>REGISTERED CONTRACTOR</small>
                  <h2>{contractor.name}</h2>
                  <p>
                    {contractor.phone ?? "Phone not provided"} ·{" "}
                    {contractor.email ?? "Email not provided"}
                  </p>
                </div>
                <b>
                  {contractor.workers.length}
                  <small>workers</small>
                </b>
                <button
                  className="edit-contractor"
                  onClick={() => {
                    setEditingContractorId(contractor.id);
                    setContractorForm({
                      ...initialContractor,
                      name: contractor.name,
                      phone: contractor.phone ?? "",
                      email: contractor.email ?? "",
                      registrationDate: contractor.registration_date.slice(
                        0,
                        10,
                      ),
                    });
                    setShowForm("contractor");
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  Edit details
                </button>
              </div>
              <p className="registration-date">
                Registered{" "}
                {new Date(contractor.registration_date).toLocaleDateString(
                  "en-IN",
                )}
              </p>
              <div className="worker-list">
                {contractor.workers.length ? (
                  contractor.workers.map((worker) => {
                    const online = worker.last_seen_at
                      ? Date.now() - new Date(worker.last_seen_at).getTime() <
                        15_000
                      : false;
                    return (
                      <div className="registered-worker" key={worker.device_id}>
                        <span className="mini-avatar">
                          {worker.worker_name?.slice(0, 1) ?? "?"}
                        </span>
                        <div>
                          <b>{worker.worker_name ?? "Unnamed rag picker"}</b>
                          <small>
                            {worker.worker_id ?? "No worker ID"} ·{" "}
                            {worker.device_id}
                          </small>
                        </div>
                        <em className={online ? "safe-text" : "danger-text"}>
                          ● {online ? "Online" : "Offline"}
                        </em>
                      </div>
                    );
                  })
                ) : (
                  <p>No rag pickers registered under this contractor.</p>
                )}
              </div>
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        type={type}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
