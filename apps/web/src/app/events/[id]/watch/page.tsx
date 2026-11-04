import type { Metadata } from "next";
import { WatchRoom } from "@/features/broadcast/watch-room";
export const metadata: Metadata = {
  title: "Watch event | OpsPilot",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function WatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WatchRoom eventId={id} />;
}
