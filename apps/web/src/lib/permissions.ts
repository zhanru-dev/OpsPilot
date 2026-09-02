import type { WorkspaceRole } from "./types";

const eventManagers: WorkspaceRole[] = ["ADMIN", "OPERATIONS_MANAGER"];
const contentManagers: WorkspaceRole[] = [
  ...eventManagers,
  "CONTENT_OPERATOR",
];

export function canManageEvents(role?: WorkspaceRole) {
  return Boolean(role && eventManagers.includes(role));
}

export function canManageContent(role?: WorkspaceRole) {
  return Boolean(role && contentManagers.includes(role));
}
