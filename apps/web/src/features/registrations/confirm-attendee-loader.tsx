"use client";

import dynamic from "next/dynamic";
import { LoadingState } from "@/components/ui/states";

// Confirmation credentials exist only in the browser's URL fragment.
export const ConfirmAttendeeLoader = dynamic(
  () => import("./confirm-attendee").then((module) => module.ConfirmAttendee),
  { ssr: false, loading: () => <LoadingState label="Checking registration" /> },
);
