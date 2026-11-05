import { OrderStatusScreen } from "@/components/customer/OrderStatusScreen";

export default async function OrderPage({
  params,
}: {
  params: Promise<{ public_id: string }>;
}) {
  const { public_id } = await params;
  return <OrderStatusScreen key={public_id} publicId={public_id} />;
}
