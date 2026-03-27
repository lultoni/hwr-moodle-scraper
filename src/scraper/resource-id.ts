import type { Activity } from "./courses.js";

/** Get the stable resource ID for an activity, falling back to a deterministic composite key. */
export function getResourceId(activity: Activity, courseId: number, sectionId: string): string {
  return activity.resourceId ?? `${courseId}-${sectionId}-${activity.activityName}`;
}
