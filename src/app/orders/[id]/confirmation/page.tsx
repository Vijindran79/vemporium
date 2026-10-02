import OrderConfirmation from '@/components/checkout/OrderConfirmation';

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  // Deliberately a thin server shell: the order is fetched client-side with the
  // guest capability header. Doing it here would mean putting that token in the
  // URL, which is where this design explicitly refuses to put it.
  return <OrderConfirmation orderId={id} />;
}