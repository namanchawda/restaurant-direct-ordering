import { MenuScreen } from "@/components/customer/MenuScreen";
import { PageShell } from "@/components/customer/PageShell";

export default async function OutletPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <PageShell title="The menu" tone="tan">
      <MenuScreen key={id} outletId={id} />
    </PageShell>
  );
}