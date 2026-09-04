import type { Metadata } from "next";
import { ConfirmAttendeeLoader } from "@/features/registrations/confirm-attendee-loader";

export const metadata: Metadata = {
  title: "Confirm registration | OpsPilot",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function ConfirmRegistrationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ConfirmAttendeeLoader eventId={id} />;
}
