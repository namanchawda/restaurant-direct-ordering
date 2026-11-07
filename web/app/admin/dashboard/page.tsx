import { OperationsDashboard } from "@/components/admin/OperationsDashboard";

export default function DashboardPage() {
  return (
    <>
      <h1 className="sr-only">Dashboard</h1>
      <OperationsDashboard scope="admin" />
    </>
  );
}
