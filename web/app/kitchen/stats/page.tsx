import { OperationsDashboard } from "@/components/admin/OperationsDashboard";

export default function KitchenStatsPage() {
  return (
    <>
      <h1 className="sr-only">Kitchen stats</h1>
      <OperationsDashboard scope="kitchen" />
    </>
  );
}
