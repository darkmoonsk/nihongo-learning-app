import { groupById, itemById } from "./catalog.ts";
import type { LearningProgress } from "./types.ts";

export const STORAGE_KEY = "nihongo:progress:v1";
export function emptyProgress(): LearningProgress {
  return {
    version: 1,
    completedGroupIds: [],
    bestScores: {},
    mistakes: [],
    seenItemIds: [],
    lastGroupId: null,
    sessions: 0,
    correct: 0,
    answered: 0,
  };
}

export function parseProgress(raw: string | null): LearningProgress {
  if (!raw) return emptyProgress();
  try {
    const value = JSON.parse(raw);
    if (!value || value.version !== 1) return emptyProgress();
    const validIds = (ids: unknown, valid: Map<string, unknown>) =>
      Array.isArray(ids)
        ? [
            ...new Set(
              ids.filter(
                (id): id is string => typeof id === "string" && valid.has(id),
              ),
            ),
          ]
        : [];
    const count = (number: unknown) =>
      typeof number === "number" && Number.isSafeInteger(number) && number >= 0
        ? number
        : 0;
    const answered = count(value.answered);
    return {
      version: 1,
      completedGroupIds: validIds(value.completedGroupIds, groupById),
      bestScores: Object.fromEntries(
        Object.entries(
          value.bestScores && typeof value.bestScores === "object"
            ? value.bestScores
            : {},
        ).filter(
          (entry): entry is [string, number] =>
            groupById.has(entry[0]) &&
            typeof entry[1] === "number" &&
            Number.isFinite(entry[1]) &&
            entry[1] >= 0 &&
            entry[1] <= 100,
        ),
      ),
      mistakes: validIds(value.mistakes, itemById),
      seenItemIds: validIds(value.seenItemIds, itemById),
      lastGroupId:
        typeof value.lastGroupId === "string" &&
        groupById.has(value.lastGroupId)
          ? value.lastGroupId
          : null,
      sessions: count(value.sessions),
      correct: Math.min(count(value.correct), answered),
      answered,
    };
  } catch {
    return emptyProgress();
  }
}

export function loadProgress(storage: Pick<Storage, "getItem">): {
  progress: LearningProgress;
  available: boolean;
} {
  try {
    return {
      progress: parseProgress(storage.getItem(STORAGE_KEY)),
      available: true,
    };
  } catch {
    return { progress: emptyProgress(), available: false };
  }
}

export function saveProgress(
  storage: Pick<Storage, "setItem">,
  progress: LearningProgress,
): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}
