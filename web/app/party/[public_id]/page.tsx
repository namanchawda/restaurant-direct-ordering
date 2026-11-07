import { PartyOrderDetail } from "@/components/customer/PartyOrderDetail";

export default async function PartyOrderPage({ params }: { params: Promise<{ public_id: string }> }) {
  const { public_id } = await params;
  return <PartyOrderDetail key={public_id} publicId={public_id} />;
}
