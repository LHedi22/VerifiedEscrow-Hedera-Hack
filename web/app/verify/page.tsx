"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// App Flow §5.5: a single input, and the three-line explainer.
export default function VerifyLookup() {
  const router = useRouter();
  const [id, setId] = useState("");
  const valid = /^\d+$/.test(id.trim());

  return (
    <div style={{ maxWidth: 640, margin: "24px auto" }}>
      <h1>Verify a record</h1>
      <p className="muted" style={{ marginTop: 0 }}>Check that what this app shows is what was anchored on Hedera. No login needed.</p>
      <form
        className="card row"
        style={{ marginTop: 20, gap: 12, alignItems: "flex-end" }}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) router.push(`/verify/${id.trim()}`);
        }}
      >
        <label className="field" style={{ flex: 1 }}>
          <span className="label">Escrow ID</span>
          <input className="input mono" inputMode="numeric" placeholder="e.g. 7" value={id} autoFocus
                 onChange={(e) => setId(e.target.value)} data-testid="escrow-input" />
        </label>
        <button className="btn primary lg" disabled={!valid}>Verify</button>
      </form>
      <ol className="explainer">
        <li>We fetch the record this app shows from its database.</li>
        <li>We fetch the original record straight from Hedera&apos;s public mirror node. The topic and contract addresses are built into this page, so the server can&apos;t redirect the check.</li>
        <li>Your browser hashes both and compares.</li>
      </ol>
    </div>
  );
}
