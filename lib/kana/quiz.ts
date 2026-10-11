import { items } from "./catalog.ts";
import type { Answer, KanaItem, LearningProgress, Question } from "./types.ts";

export function shuffle<T>(values: readonly T[], random = Math.random): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function createQuestions(
  pool: KanaItem[],
  seenIds: string[] = [],
  random = Math.random,
): Question[] {
  if (!pool.length) return [];
  const seen = new Set([...seenIds, ...pool.map((item) => item.id)]);
  const sequence: KanaItem[] = [];
  while (sequence.length < 10) {
    const batch = shuffle(pool, random);
    if (batch.length > 1 && batch[0].id === sequence.at(-1)?.id) {
      [batch[0], batch[1]] = [batch[1], batch[0]];
    }
    sequence.push(...batch);
  }
  return sequence.slice(0, 10).map((item) => {
    const candidates = items.filter(
      (other) =>
        other.alphabet === item.alphabet && other.reading !== item.reading,
    );
    const preferred = shuffle(
      candidates.filter((other) => seen.has(other.id)),
      random,
    );
    const remaining = shuffle(
      candidates.filter((other) => !seen.has(other.id)),
      random,
    );
    const wrong = [
      ...new Set([...preferred, ...remaining].map((other) => other.reading)),
    ].slice(0, 3);
    return { item, options: shuffle([item.reading, ...wrong], random) };
  });
}

export function scoreAnswers(answers: Answer[]) {
  return Math.round(
    (answers.filter((answer) => answer.correct).length /
      Math.max(answers.length, 1)) *
      100,
  );
}

export function recordAnswer(
  progress: LearningProgress,
  answer: Answer,
  review: boolean,
): LearningProgress {
  const mistakes = new Set(progress.mistakes);
  if (!answer.correct) mistakes.add(answer.itemId);
  else if (review) mistakes.delete(answer.itemId);
  return {
    ...progress,
    mistakes: [...mistakes],
    answered: progress.answered + 1,
    correct: progress.correct + Number(answer.correct),
  };
}

export function completeSession(
  progress: LearningProgress,
  groupId: string | null,
  answers: Answer[],
): LearningProgress {
  return {
    ...progress,
    sessions: progress.sessions + 1,
    completedGroupIds: groupId
      ? [...new Set([...progress.completedGroupIds, groupId])]
      : progress.completedGroupIds,
    bestScores: groupId
      ? {
          ...progress.bestScores,
          [groupId]: Math.max(
            progress.bestScores[groupId] ?? 0,
            scoreAnswers(answers),
          ),
        }
      : progress.bestScores,
  };
}
