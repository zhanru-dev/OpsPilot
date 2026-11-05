import { AlertTriangle, CheckCircle2 } from "lucide-react";

export type Feedback = { message: string; tone: "success" | "error" };

const toneClass: Record<Feedback["tone"], string> = {
  success: "border-[#b8dac5] bg-[var(--success-soft)] text-[var(--success)]",
  error: "border-[#efb5b5] bg-[var(--danger-soft)] text-[var(--danger)]",
};

// Short-lived confirmation or error message for the last operation.
export function FeedbackToast({ feedback }: { feedback: Feedback | null }) {
  if (!feedback) return null;
  const Icon = feedback.tone === "success" ? CheckCircle2 : AlertTriangle;
  return (
    <div
      role={feedback.tone === "error" ? "alert" : "status"}
      className={`fixed right-5 top-20 z-40 flex max-w-[calc(100vw-2.5rem)] items-center gap-2 rounded-md border px-4 py-3 text-sm font-semibold shadow-lg ${toneClass[feedback.tone]}`}
    >
      <Icon className="size-4 shrink-0" />
      {feedback.message}
    </div>
  );
}
