import { pickMergeTarget } from "./merge.js";

export function classifySendConflict(tickets, window) {
  const ticket = pickMergeTarget(tickets ?? []);
  if (!ticket) return { action: "send" };
  if (window?.state === "open") return { action: "assign", ticket };
  return { action: "stale", ticket };
}
