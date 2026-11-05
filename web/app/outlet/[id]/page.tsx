import { MenuScreen } from "@/components/customer/MenuScreen";

export default async function OutletPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MenuScreen key={id} outletId={id} />;
}
