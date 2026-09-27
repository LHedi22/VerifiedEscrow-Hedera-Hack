"use client";

import { useEffect, useState } from "react";
import { recordHash } from "canonical";

export type Fixture = { name: string; json: string; expected: string };
type Row = { name: string; expected: string; actual: string; ok: boolean };

export default function SelfTest({ fixtures }: { fixtures: Fixture[] }) {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    setRows(
      fixtures.map(({ name, json, expected }) => {
        const actual = recordHash(JSON.parse(json));
        return { name, expected, actual, ok: actual === expected };
      }),
    );
  }, [fixtures]);

  if (!rows) return <main>Hashing…</main>;
  const pass = rows.length === 6 && rows.every((r) => r.ok);

  return (
    <main style={{ fontFamily: "monospace", padding: 16 }}>
      <h1 id="selftest-status" data-status={pass ? "PASS" : "FAIL"} style={{ color: pass ? "green" : "red" }}>
        Self-test {pass ? "PASS" : "FAIL"} ({rows.filter((r) => r.ok).length}/{rows.length})
      </h1>
      <table>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} data-ok={r.ok}>
              <td>{r.ok ? "OK" : "MISMATCH"}</td>
              <td>{r.name}</td>
              <td>{r.actual}</td>
              {!r.ok && <td>expected {r.expected}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
