import { PublicRegistration } from "@/features/registrations/public-registration";

export default async function RegistrationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PublicRegistration key={id} eventId={id} />;
}
