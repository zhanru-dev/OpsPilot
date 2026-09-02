import { LiveSessionRoom } from "@/features/live-operations/live-session-room";

export default async function LiveSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LiveSessionRoom eventId={id} />;
}
