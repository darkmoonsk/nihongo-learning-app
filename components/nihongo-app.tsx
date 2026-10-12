"use client";

import { useEffect, useRef, useState } from "react";
import { categories, groupById, groups, itemById } from "@/lib/kana/catalog";
import {
  completeSession,
  createQuestions,
  recordAnswer,
  scoreAnswers,
} from "@/lib/kana/quiz";
import type {
  Alphabet,
  Answer,
  KanaItem,
  Question,
  StudyGroup,
} from "@/lib/kana/types";
import { copy } from "@/lib/copy";
import { useProgress } from "@/lib/use-progress";
import { useAudio } from "@/lib/use-audio";
import type { AudioSources } from "@/lib/pronunciation-player";
import { AudioButton } from "./audio-button";

type View = "home" | "learn" | "chart" | "lesson" | "quiz" | "result";
interface Session {
  groupId: string | null;
  review: boolean;
  questions: Question[];
  index: number;
  choice: string | null;
  answers: Answer[];
}

function Arrow({ back = false }: { back?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      className={back ? "arrow-back" : ""}
    >
      <path
        d="M5 12h14m-6-6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function Spark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      viewBox="0 0 40 40"
      fill="none"
    >
      <path
        d="M20 2v36M2 20h36M7 7l26 26M7 33 33 7"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}
function AlphabetPicker({
  alphabet,
  onChange,
}: {
  alphabet: Alphabet;
  onChange: (alphabet: Alphabet) => void;
}) {
  return (
    <div
      className="alphabet-picker"
      role="group"
      aria-label="Choose an alphabet"
    >
      <button
        aria-pressed={alphabet === "hiragana"}
        onClick={() => onChange("hiragana")}
      >
        <span lang="ja" aria-hidden="true">
          あ
        </span>{" "}
        Hiragana
      </button>
      <button
        aria-pressed={alphabet === "katakana"}
        onClick={() => onChange("katakana")}
      >
        <span lang="ja" aria-hidden="true">
          ア
        </span>{" "}
        Katakana
      </button>
    </div>
  );
}

export default function NihongoApp({
  audioSources,
}: {
  audioSources: AudioSources;
}) {
  const { progress, ready, available, update } = useProgress();
  const [view, setCurrentView] = useState<View>("home");
  const [alphabet, setCurrentAlphabet] = useState<Alphabet>("hiragana");
  const [lesson, setLesson] = useState<StudyGroup>(groups[0]);
  const [session, setSession] = useState<Session | null>(null);
  const answeredQuestionRef = useRef<Session | null>(null);
  const [search, setSearchValue] = useState("");
  const [category, setCurrentCategory] = useState("all");
  const audio = useAudio(audioSources);
  function setView(next: View) {
    audio.stop();
    setCurrentView(next);
  }
  function setAlphabet(next: Alphabet) {
    audio.stop();
    setCurrentAlphabet(next);
  }
  function setSearch(next: string) {
    audio.stop();
    setSearchValue(next);
  }
  function setCategory(next: string) {
    audio.stop();
    setCurrentCategory(next);
  }
  function pronunciation(item: KanaItem) {
    return (
      <AudioButton
        item={item}
        available={!!audioSources[item.id]}
        state={audio.state}
        onPlay={audio.play}
      />
    );
  }
  const mainRef = useRef<HTMLElement>(null);
  const questionIndex = session?.index ?? 0;
  const previousLocation = useRef({ view, questionIndex });
  useEffect(() => {
    if (
      previousLocation.current.view === view &&
      previousLocation.current.questionIndex === questionIndex
    )
      return;
    previousLocation.current = { view, questionIndex };
    mainRef.current?.focus();
  }, [view, questionIndex]);
  const stopAudio = audio.stop;
  useEffect(() => {
    if (view !== "quiz" || !session || session.choice === null) return;
    const timer = window.setTimeout(() => {
      if (session.index === session.questions.length - 1) {
        update((previous) =>
          completeSession(previous, session.groupId, session.answers),
        );
        stopAudio();
        setCurrentView("result");
      } else {
        setSession({ ...session, index: session.index + 1, choice: null });
      }
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [view, session, update, stopAudio]);

  const completed = new Set(progress.completedGroupIds);
  const alphabetGroups = groups.filter((group) => group.alphabet === alphabet);
  const lastGroup = progress.lastGroupId
    ? groupById.get(progress.lastGroupId)
    : undefined;
  const recommended =
    lastGroup && !completed.has(lastGroup.id)
      ? lastGroup
      : (groups.find(
          (group) =>
            group.alphabet === (lastGroup?.alphabet ?? "hiragana") &&
            !completed.has(group.id),
        ) ??
        groups.find((group) => !completed.has(group.id)) ??
        groups[0]);

  function openLesson(group: StudyGroup) {
    setLesson(group);
    setAlphabet(group.alphabet);
    setView("lesson");
  }
  function start(group: StudyGroup | null, reviewPool?: KanaItem[]) {
    if (!ready) return;
    const pool =
      group?.items ??
      reviewPool ??
      progress.mistakes.flatMap((id) => {
        const item = itemById.get(id);
        return item ? [item] : [];
      });
    const questions = createQuestions(pool, progress.seenItemIds);
    if (!questions.length) return;
    if (group)
      update((previous) => ({
        ...previous,
        lastGroupId: group.id,
        seenItemIds: [
          ...new Set([
            ...previous.seenItemIds,
            ...group.items.map((item) => item.id),
          ]),
        ],
      }));
    setSession({
      groupId: group?.id ?? null,
      review: !group,
      questions,
      index: 0,
      choice: null,
      answers: [],
    });
    setView("quiz");
  }
  function answer(reading: string) {
    if (
      !session ||
      session.choice !== null ||
      answeredQuestionRef.current === session
    )
      return;
    answeredQuestionRef.current = session;
    const item = session.questions[session.index].item;
    const response = { itemId: item.id, correct: reading === item.reading };
    update((previous) => recordAnswer(previous, response, session.review));
    setSession({
      ...session,
      choice: reading,
      answers: [...session.answers, response],
    });
  }
  const question = session?.questions[session.index];
  const activeGroup = session?.groupId ? groupById.get(session.groupId) : null;
  const incorrect = session
    ? [
        ...new Set(
          session.answers
            .filter((answer) => !answer.correct)
            .map((answer) => answer.itemId),
        ),
      ]
    : [];

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <button
          className="brand"
          onClick={() => setView("home")}
          aria-label="Nihongo overview"
        >
          <span className="brand-mark" aria-hidden="true" lang="ja">
            に
          </span>
          {copy.brand}
          <span className="brand-dot">.</span>
        </button>
        <nav aria-label="Main navigation">
          {(["home", "learn", "chart"] as const).map((target) => (
            <button
              key={target}
              aria-current={view === target ? "page" : undefined}
              onClick={() => setView(target)}
            >
              {copy.nav[target]}
            </button>
          ))}
        </nav>
        <span className="header-note">
          <span aria-hidden="true" className="status-dot" /> Small steps, real
          progress
        </span>
      </header>
      <main
        id="main"
        ref={mainRef}
        tabIndex={-1}
        className={`main-content view-${view}`}
      >
        {!available && ready ? (
          <p className="storage-warning" role="status">
            {copy.storage}
          </p>
        ) : null}
        {view === "home" ? (
          <>
            <section className="hero">
              <div className="hero-copy">
                <span className="friendly-label">
                  <Spark /> Let’s learn Japanese
                </span>
                <h1>{copy.home.title}</h1>
                <p>{copy.home.intro}</p>
                <div className="hero-actions">
                  <button
                    className="button primary"
                    disabled={!ready}
                    onClick={() => openLesson(recommended)}
                  >
                    {copy.home.continue}
                    <Arrow />
                  </button>
                  <span>Just 10 questions at a time.</span>
                </div>
              </div>
              <div className="kana-art" aria-hidden="true">
                <span className="art-orbit" />
                <Spark className="art-spark" />
                <div className="art-card art-hiragana">
                  <span className="art-label">Hiragana</span>
                  <span lang="ja" className="art-glyph">
                    あ
                  </span>
                  <span className="art-reading">
                    a <span>the beginning of something</span>
                  </span>
                </div>
                <div className="art-card art-katakana">
                  <span className="art-label">Katakana</span>
                  <span lang="ja" className="art-glyph">
                    ア
                  </span>
                  <span className="art-reading">
                    a <span>a new way to see it</span>
                  </span>
                </div>
                <span className="art-caption">
                  Same sound. Two new friends.
                </span>
                <span className="art-dot" />
              </div>
            </section>
            <section
              className="journey-section"
              aria-labelledby="journey-title"
            >
              <div className="section-heading">
                <div>
                  <span className="section-kicker">One sound at a time</span>
                  <h2 id="journey-title">Choose your starting point.</h2>
                </div>
                <span className="quiet-note">
                  No rush. Every group is open.
                </span>
              </div>
              <div className="track-grid">
                {(["hiragana", "katakana"] as const).map((track) => {
                  const trackGroups = groups.filter(
                    (group) => group.alphabet === track,
                  );
                  const done = trackGroups.filter((group) =>
                    completed.has(group.id),
                  ).length;
                  return (
                    <button
                      key={track}
                      className={`track-card ${track}`}
                      onClick={() => {
                        setAlphabet(track);
                        setView("learn");
                      }}
                    >
                      <div
                        className="track-symbol"
                        lang="ja"
                        aria-hidden="true"
                      >
                        {track === "hiragana" ? "あ" : "ア"}
                      </div>
                      <div className="track-description">
                        <span className="track-tag">
                          {track === "hiragana"
                            ? "Your first alphabet"
                            : "Your next discovery"}
                        </span>
                        <h3>
                          {track === "hiragana" ? "Hiragana" : "Katakana"}
                        </h3>
                        <p>
                          {track === "hiragana"
                            ? "The foundation of Japanese. Soft shapes, everyday sounds."
                            : "A fresh set of shapes. Your gateway to borrowed words."}
                        </p>
                        <div className="track-progress">
                          <span>
                            {ready
                              ? `${done} of ${trackGroups.length} groups completed`
                              : "Loading your progress…"}
                          </span>
                          <Arrow />
                        </div>
                        <div className="progress-track" aria-hidden="true">
                          <span
                            style={{
                              width: `${(done / trackGroups.length) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
            <section className="home-bottom">
              <div className="review-card">
                <span className="review-icon" aria-hidden="true">
                  ↻
                </span>
                <div>
                  <h3>A second look makes it stick.</h3>
                  <p>
                    {progress.mistakes.length
                      ? `${progress.mistakes.length} ${progress.mistakes.length === 1 ? "character is" : "characters are"} ready for another try.`
                      : "Missed characters will appear here. Mistakes are part of learning."}
                  </p>
                </div>
                <button
                  className="button secondary"
                  disabled={!ready || !progress.mistakes.length}
                  onClick={() => start(null)}
                >
                  {copy.home.review}
                  <Arrow />
                </button>
              </div>
              <div className="study-note">
                <Spark />
                <div>
                  <h3>A little, often.</h3>
                  <p>
                    Learn a few sounds. Try them out. Come back whenever you
                    like.
                  </p>
                </div>
              </div>
            </section>
            <div className="home-stats">
              <span>
                <strong>{progress.sessions}</strong> sessions completed
              </span>
              <span>
                <strong>
                  {progress.answered
                    ? `${Math.round((progress.correct / progress.answered) * 100)}%`
                    : "—"}
                </strong>{" "}
                overall accuracy
              </span>
              <span>
                {available
                  ? "Saved on this browser. No account needed."
                  : "Progress stays in this session."}
              </span>
            </div>
          </>
        ) : null}

        {view === "learn" ? (
          <>
            <div className="page-heading">
              <div>
                <span className="section-kicker">
                  Build your reading skills
                </span>
                <h1>Your kana journey.</h1>
                <p>
                  Start at the beginning or follow your curiosity. Every group
                  is yours to explore.
                </p>
              </div>
              <AlphabetPicker alphabet={alphabet} onChange={setAlphabet} />
            </div>
            {categories.map((section) => {
              const sectionGroups = alphabetGroups.filter(
                (group) => group.category === section.id,
              );
              if (!sectionGroups.length) return null;
              return (
                <section
                  className="group-section"
                  key={section.id}
                  aria-labelledby={`section-${section.id}`}
                >
                  <div className="section-heading">
                    <div>
                      <h2 id={`section-${section.id}`}>{section.title}</h2>
                      <p>{section.description}</p>
                    </div>
                    <span className="quiet-note">
                      {
                        sectionGroups.filter((group) => completed.has(group.id))
                          .length
                      }{" "}
                      / {sectionGroups.length} complete
                    </span>
                  </div>
                  <div className="group-grid">
                    {sectionGroups.map((group) => (
                      <button
                        key={group.id}
                        className={`group-card ${alphabet}`}
                        onClick={() => openLesson(group)}
                      >
                        <span className="group-preview" lang="ja">
                          {group.items
                            .slice(
                              0,
                              group.category === "basic" ||
                                group.category === "voiced"
                                ? 3
                                : group.category === "context"
                                  ? 1
                                  : 2,
                            )
                            .map((item) => item.glyph)
                            .join(" ")}
                        </span>
                        <span className="group-title">
                          {group.title}
                          <span aria-hidden="true">
                            {completed.has(group.id) ? "✓" : "↗"}
                          </span>
                        </span>
                        <span className="group-detail">
                          {completed.has(group.id)
                            ? `Completed · Best ${progress.bestScores[group.id] ?? 0}%`
                            : `${group.items.length} ${group.category === "context" ? "word examples" : "sounds"} · 10 questions`}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </>
        ) : null}

        {view === "lesson" ? (
          <div className="lesson-page">
            <button className="text-button" onClick={() => setView("learn")}>
              <Arrow back /> Back to learning
            </button>
            <div className="lesson-heading">
              <span className={`pill ${lesson.alphabet}`}>
                {lesson.alphabet === "hiragana" ? "Hiragana" : "Katakana"}
              </span>
              <h1>{lesson.title}</h1>
              <p>{lesson.description} Take a look, then give them a try.</p>
            </div>
            {lesson.category === "voiced" ? (
              <p className="lesson-note">
                Dakuten (゛) voices a sound: k becomes g, s becomes z, t becomes
                d, and h becomes b. Handakuten (゜) changes h to p.
              </p>
            ) : null}
            {lesson.note ? <p className="lesson-note">{lesson.note}</p> : null}
            <div className={`lesson-tiles ${lesson.alphabet}`}>
              {lesson.items.map((item) => (
                <div
                  className={`kana-tile ${lesson.category === "context" ? "word-tile" : ""}`}
                  key={item.id}
                >
                  <span lang="ja">{item.glyph}</span>
                  <strong>{item.reading}</strong>
                  {pronunciation(item)}
                </div>
              ))}
            </div>
            <div className="lesson-start">
              <button
                className="button primary"
                disabled={!ready}
                onClick={() => start(lesson)}
              >
                Let’s practice
                <Arrow />
              </button>
              <p>10 questions. No timer. Room to make mistakes.</p>
            </div>
          </div>
        ) : null}

        {view === "quiz" && session && question ? (
          <div className="quiz-page">
            <div className="quiz-top">
              <button className="text-button" onClick={() => setView("learn")}>
                <Arrow back /> Back to learning
              </button>
              <span>
                {session.review ? "Review mistakes" : activeGroup?.title}
              </span>
              <strong>
                {session.index + 1} / {session.questions.length}
              </strong>
            </div>
            <div
              className="quiz-progress"
              role="progressbar"
              aria-label="Session progress"
              aria-valuemin={0}
              aria-valuemax={10}
              aria-valuenow={session.index}
            >
              <span
                style={{
                  width: `${(session.index / session.questions.length) * 100}%`,
                }}
              />
            </div>
            <div className="quiz-question">
              <span className={`pill ${question.item.alphabet}`}>
                {question.item.alphabet === "hiragana"
                  ? "Hiragana"
                  : "Katakana"}
              </span>
              <h1>
                {groupById.get(question.item.groupId)?.category === "context"
                  ? copy.quiz.wordPrompt
                  : copy.quiz.prompt}
              </h1>
              <div
                key={question.item.id + session.index}
                lang="ja"
                className={`question-glyph ${question.item.glyph.length > 2 ? "word-glyph" : ""}`}
              >
                {question.item.glyph}
              </div>
            </div>
            <div
              className="answer-options"
              role="group"
              aria-label="Reading options"
            >
              {question.options.map((option, index) => {
                const correct =
                  session.choice !== null && option === question.item.reading;
                const wrong = session.choice === option && !correct;
                return (
                  <button
                    className={`answer-button ${correct ? "correct" : wrong ? "incorrect" : ""}`}
                    key={option}
                    disabled={session.choice !== null}
                    onClick={() => answer(option)}
                  >
                    <span className="option-number" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span>{option}</span>
                    <span className="answer-icon" aria-hidden="true">
                      {correct ? "✓" : wrong ? "×" : ""}
                    </span>
                    {correct ? (
                      <span className="sr-only">Correct answer</span>
                    ) : wrong ? (
                      <span className="sr-only">Your answer, incorrect</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {session.choice !== null ? (
              <div
                className={`answer-feedback ${session.choice === question.item.reading ? "success" : "try-again"}`}
                role="status"
              >
                <div>
                  <strong>
                    {session.choice === question.item.reading
                      ? `✓ ${copy.quiz.correct}`
                      : `↻ ${copy.quiz.incorrect}`}
                  </strong>
                  <p>
                    <span lang="ja">{question.item.glyph}</span> is read{" "}
                    <b>{question.item.reading}</b>.
                  </p>
                </div>
              </div>
            ) : (
              <p className="quiz-hint">
                Choose the reading that feels right. You’ll learn with every
                answer.
              </p>
            )}
          </div>
        ) : null}

        {view === "result" && session ? (
          <div className="result-page">
            <div className="result-emblem" aria-hidden="true">
              <Spark />
              <span>✓</span>
              <Spark />
            </div>
            <span className="friendly-label">A little further than before</span>
            <h1>
              {scoreAnswers(session.answers) === 100
                ? "Look at you go!"
                : "That’s another step forward."}
            </h1>
            <p>
              {session.review
                ? "You gave those tricky sounds another try."
                : "Group completed. You can revisit it whenever you like."}
            </p>
            <div className="result-stats">
              <div>
                <strong>
                  {session.answers.filter((answer) => answer.correct).length}
                  <small> / 10</small>
                </strong>
                <span>correct answers</span>
              </div>
              <div>
                <strong>
                  {scoreAnswers(session.answers)}
                  <small>%</small>
                </strong>
                <span>session accuracy</span>
              </div>
            </div>
            <div className="result-review">
              <h2>
                {incorrect.length
                  ? "These deserve another look."
                  : "Every answer found its sound."}
              </h2>
              {incorrect.length ? (
                <div className="mistake-list">
                  {incorrect.map((id) => {
                    const item = itemById.get(id)!;
                    return (
                      <div key={id}>
                        <span lang="ja">{item.glyph}</span>
                        <strong>{item.reading}</strong>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p>
                  Keep exploring, or repeat this session to make the sounds feel
                  familiar.
                </p>
              )}
            </div>
            <div className="result-actions">
              <button
                className="button primary"
                onClick={() => openLesson(recommended)}
              >
                Continue learning
                <Arrow />
              </button>
              {session ? (
                <button
                  className="button secondary"
                  onClick={() =>
                    start(activeGroup ?? null, [
                      ...new Map(
                        session.questions.map((question) => [
                          question.item.id,
                          question.item,
                        ]),
                      ).values(),
                    ])
                  }
                >
                  Repeat session
                </button>
              ) : null}
              {progress.mistakes.length ? (
                <button className="text-button" onClick={() => start(null)}>
                  Review mistakes ({progress.mistakes.length})
                </button>
              ) : null}
            </div>
            <button
              className="text-button result-back"
              onClick={() => setView("learn")}
            >
              Explore all groups
            </button>
          </div>
        ) : null}

        {view === "chart" ? (
          <>
            <div className="page-heading">
              <div>
                <span className="section-kicker">
                  A handy place to come back to
                </span>
                <h1>Meet the characters.</h1>
                <p>
                  Every shape and sound, in one place. Select a group to learn
                  it.
                </p>
              </div>
              <AlphabetPicker
                alphabet={alphabet}
                onChange={(next) => {
                  setAlphabet(next);
                  setCategory("all");
                }}
              />
            </div>
            <div className="chart-filters">
              <label>
                Find a character or sound
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Try あ, shi, or kya"
                  type="search"
                />
              </label>
              <label>
                Show
                <select
                  aria-label="Show groups"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                >
                  <option value="all">All groups</option>
                  {categories
                    .filter((section) =>
                      alphabetGroups.some(
                        (group) => group.category === section.id,
                      ),
                    )
                    .map((section) => (
                      <option key={section.id} value={section.id}>
                        {section.title}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            {(() => {
              const query = search.trim().toLowerCase();
              const visibleGroups = alphabetGroups
                .filter(
                  (group) => category === "all" || group.category === category,
                )
                .map((group) => ({
                  ...group,
                  items: group.items.filter(
                    (item) =>
                      !query ||
                      item.glyph.includes(query) ||
                      item.reading.includes(query),
                  ),
                }))
                .filter((group) => group.items.length);
              return visibleGroups.length ? (
                visibleGroups.map((group) => (
                  <section className="chart-group" key={group.id}>
                    <div className="chart-heading">
                      <h2>
                        {group.title}
                        {group.category === "context" ? (
                          <span>Word examples</span>
                        ) : null}
                      </h2>
                      <button
                        className="text-button"
                        onClick={() => openLesson(groupById.get(group.id)!)}
                      >
                        Learn this group
                        <Arrow />
                      </button>
                    </div>
                    {group.note ? (
                      <p className="chart-note">{group.note}</p>
                    ) : null}
                    <div className={`chart-tiles ${alphabet}`}>
                      {group.items.map((item) => (
                        <div
                          className={`kana-tile ${group.category === "context" ? "word-tile" : ""}`}
                          key={item.id}
                        >
                          <span lang="ja">{item.glyph}</span>
                          <strong>{item.reading}</strong>
                        </div>
                      ))}
                    </div>
                  </section>
                ))
              ) : (
                <div className="empty-state">
                  <h2>No matching sounds yet.</h2>
                  <p>Try another character, reading, or group.</p>
                  <button
                    className="button secondary"
                    onClick={() => {
                      setSearch("");
                      setCategory("all");
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              );
            })()}
          </>
        ) : null}
      </main>
      <footer className="site-footer">
        <span>
          <span lang="ja">日本語</span> A little Japanese, every day.
        </span>
        <span>Made for curious minds.</span>
      </footer>
    </div>
  );
}
