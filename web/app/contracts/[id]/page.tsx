import ContractDetail from "./ContractDetail";

// `/contracts/:id` uses the DB id (App Flow §1).
export default function Page({ params }: { params: { id: string } }) {
  const id = /^\d+$/.test(params.id) ? Number(params.id) : null;
  if (id === null) return <div className="card">Contract IDs are whole numbers.</div>;
  return <ContractDetail id={id} />;
}
