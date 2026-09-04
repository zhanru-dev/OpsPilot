import { EventInvitations } from "@/features/registrations/event-invitations";

export default async function InvitationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EventInvitations key={id} eventId={id} />;
}
