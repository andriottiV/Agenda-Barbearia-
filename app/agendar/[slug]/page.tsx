import type { Metadata } from "next";
import { BookingApp } from "../../_components/booking-app";
import { createServerSupabaseClient } from "../../lib/supabase-server";

type BookingPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: BookingPageProps): Promise<Metadata> {
  const { slug } = await params;
  const supabase = createServerSupabaseClient();
  const { data: barbershop } = await supabase
    .from("barbershops")
    .select("name")
    .eq("slug", slug)
    .maybeSingle();
  const name =
    typeof barbershop?.name === "string" && barbershop.name.trim()
      ? barbershop.name.trim()
      : "Barbearia";
  const title = `Agendar horário - ${name}`;
  const description = `Agende seu horário na ${name} pelo HoraAi. Escolha serviço, data e horário em poucos segundos.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [
        {
          url: "/HoraAi-AppIconAB.png?v=3",
          width: 512,
          height: 512,
          alt: "HoraAi",
        },
      ],
      type: "website",
    },
  };
}

export default async function BookingPage({
  params,
}: BookingPageProps) {
  const { slug } = await params;
  return <BookingApp slug={slug} />;
}
