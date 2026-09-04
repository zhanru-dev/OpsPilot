import { EventRegistrations } from "@/features/registrations/event-registrations";

export default async function RegistrationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EventRegistrations key={id} eventId={id} />;
}
