export type Alphabet = "hiragana" | "katakana";
export type Category = "basic" | "voiced" | "combined" | "foreign" | "context";

export interface KanaItem {
  id: string;
  alphabet: Alphabet;
  groupId: string;
  glyph: string;
  reading: string;
}

export interface StudyGroup {
  id: string;
  alphabet: Alphabet;
  category: Category;
  title: string;
  description: string;
  note?: string;
  items: KanaItem[];
}

export interface Question {
  item: KanaItem;
  options: string[];
}

export interface LearningProgress {
  version: 1;
  completedGroupIds: string[];
  bestScores: Record<string, number>;
  mistakes: string[];
  seenItemIds: string[];
  lastGroupId: string | null;
  sessions: number;
  correct: number;
  answered: number;
}

export interface Answer {
  itemId: string;
  correct: boolean;
}
