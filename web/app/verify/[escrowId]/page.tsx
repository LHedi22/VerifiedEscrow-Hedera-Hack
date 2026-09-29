import VerifyResult from "./VerifyResult";

// `/verify/:escrowId` uses the ON-CHAIN escrow ID (App Flow §1). Public: no persona.
export default function Page({ params }: { params: { escrowId: string } }) {
  const id = /^\d+$/.test(params.escrowId) ? Number(params.escrowId) : null;
  if (id === null) return <div className="card">Escrow IDs are whole numbers.</div>;
  return <VerifyResult escrowId={id} />;
}
