import { BookingApp } from "../../_components/booking-app";

export default async function BookingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <BookingApp slug={slug} />;
}
