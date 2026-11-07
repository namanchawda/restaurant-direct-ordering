import { MenuScreen } from "@/components/customer/MenuScreen";

export default async function OutletPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <h1 className="sr-only">Menu</h1>
      <MenuScreen key={id} outletId={id} />
    </>
  );
}
