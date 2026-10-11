import test from "node:test";
import assert from "node:assert/strict";
import { groups, items } from "../lib/kana/catalog.ts";
import {
  createQuestions,
  recordAnswer,
  completeSession,
  scoreAnswers,
} from "../lib/kana/quiz.ts";
import {
  emptyProgress,
  parseProgress,
  loadProgress,
  saveProgress,
  STORAGE_KEY,
} from "../lib/kana/progress.ts";

function seeded(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

test("catalog covers 46 unique basics per alphabet, voiced forms, combinations and borrowed sounds", () => {
  assert.equal(new Set(groups.map((g) => g.id)).size, groups.length);
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  for (const alphabet of ["hiragana", "katakana"]) {
    const basics = groups
      .filter((g) => g.alphabet === alphabet && g.category === "basic")
      .flatMap((g) => g.items);
    assert.equal(basics.length, 46);
    assert.equal(new Set(basics.map((i) => i.glyph)).size, 46);
    assert.equal(
      groups
        .filter((g) => g.alphabet === alphabet && g.category === "voiced")
        .flatMap((g) => g.items).length,
      25,
    );
    assert.equal(
      groups
        .filter((g) => g.alphabet === alphabet && g.category === "combined")
        .flatMap((g) => g.items).length,
      33,
    );
  }
  for (const glyph of ["ファ", "ティ", "ドゥ", "チェ", "ヴァ", "ヴォ"])
    assert.ok(items.some((i) => i.glyph === glyph));
  for (const item of items) {
    assert.ok(item.glyph && item.reading);
    assert.equal(
      groups.find((g) => g.id === item.groupId)?.alphabet,
      item.alphabet,
    );
    assert.ok(!["っ", "ッ", "ー"].includes(item.glyph));
  }
  assert.equal(items.find((i) => i.glyph === "し")?.reading, "shi");
  assert.equal(items.find((i) => i.glyph === "ぢ")?.reading, "ji");
  assert.equal(items.find((i) => i.glyph === "づ")?.reading, "zu");
  assert.equal(items.find((i) => i.glyph === "コーヒー")?.reading, "kōhī");
});

test("every group generates ten unambiguous questions without consecutive repeats", () => {
  for (const group of groups)
    for (let seed = 1; seed <= 20; seed++) {
      const questions = createQuestions(group.items, [], seeded(seed));
      assert.equal(questions.length, 10);
      for (let index = 0; index < questions.length; index++) {
        const question = questions[index];
        assert.equal(question.options.length, 4);
        assert.equal(new Set(question.options).size, 4);
        assert.ok(question.options.includes(question.item.reading));
        assert.ok(group.items.includes(question.item));
        if (index)
          assert.notEqual(question.item.id, questions[index - 1].item.id);
      }
      assert.equal(
        new Set(questions.slice(0, group.items.length).map((q) => q.item.id))
          .size,
        group.items.length,
      );
    }
});

test("questions prefer learned sounds and shuffle the answer position", () => {
  const vowels = groups[0].items;
  const positions = new Set();
  for (let seed = 1; seed < 15; seed++)
    for (const question of createQuestions(vowels, [], seeded(seed))) {
      assert.ok(
        question.options.every((option) =>
          vowels.some((item) => item.reading === option),
        ),
      );
      positions.add(question.options.indexOf(question.item.reading));
    }
  assert.equal(positions.size, 4);
});

test("empty and single-item review pools remain usable", () => {
  assert.deepEqual(createQuestions([]), []);
  const questions = createQuestions([items[0]]);
  assert.equal(questions.length, 10);
  assert.ok(
    questions.every(
      (q) => q.item === items[0] && new Set(q.options).size === 4,
    ),
  );
});

test("mistakes are unique, ordinary success keeps them, review success removes them", () => {
  let progress = emptyProgress();
  const itemId = items[0].id;
  progress = recordAnswer(progress, { itemId, correct: false }, false);
  progress = recordAnswer(progress, { itemId, correct: false }, false);
  assert.deepEqual(progress.mistakes, [itemId]);
  progress = recordAnswer(progress, { itemId, correct: true }, false);
  assert.deepEqual(progress.mistakes, [itemId]);
  progress = recordAnswer(progress, { itemId, correct: true }, true);
  assert.deepEqual(progress.mistakes, []);
  assert.equal(progress.answered, 4);
  assert.equal(progress.correct, 2);
});

test("completion is independent of score and the best score never regresses", () => {
  const id = groups[0].id;
  const answers = Array.from({ length: 10 }, (_, i) => ({
    itemId: items[0].id,
    correct: i < 8,
  }));
  assert.equal(scoreAnswers(answers), 80);
  let progress = completeSession(emptyProgress(), id, answers);
  progress = completeSession(
    progress,
    id,
    answers.map((a) => ({ ...a, correct: false })),
  );
  assert.deepEqual(progress.completedGroupIds, [id]);
  assert.equal(progress.bestScores[id], 80);
  assert.equal(progress.sessions, 2);
  const reviewed = completeSession(progress, null, answers);
  assert.deepEqual(reviewed.completedGroupIds, progress.completedGroupIds);
  assert.deepEqual(reviewed.bestScores, progress.bestScores);
  assert.equal(reviewed.sessions, 3);
});

test("storage round trip preserves progress and recovers from invalid data", () => {
  const progress = {
    ...emptyProgress(),
    completedGroupIds: [groups[0].id],
    mistakes: [items[0].id],
    lastGroupId: groups[0].id,
    seenItemIds: [items[0].id],
  };
  let raw: string | null = null;
  const storage = {
    setItem(key: string, value: string) {
      assert.equal(key, STORAGE_KEY);
      raw = value;
    },
    getItem(key: string) {
      assert.equal(key, STORAGE_KEY);
      return raw;
    },
  };
  assert.equal(saveProgress(storage, progress), true);
  assert.deepEqual(loadProgress(storage), { progress, available: true });
  for (const invalid of [null, "{", "null", "[]", '{"version":2}'])
    assert.deepEqual(parseProgress(invalid), emptyProgress());
  const recovered = parseProgress(
    JSON.stringify({
      version: 1,
      completedGroupIds: ["unknown", groups[0].id, groups[0].id],
      mistakes: [null, "unknown"],
      bestScores: { [groups[0].id]: 300 },
      correct: 999,
      answered: 2,
    }),
  );
  assert.deepEqual(recovered.completedGroupIds, [groups[0].id]);
  assert.deepEqual(recovered.bestScores, {});
  assert.equal(recovered.correct, 2);
});

test("denied reads and writes fall back without throwing", () => {
  const storage = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("quota");
    },
  };
  assert.deepEqual(loadProgress(storage), {
    progress: emptyProgress(),
    available: false,
  });
  assert.equal(saveProgress(storage, emptyProgress()), false);
});
