import type { Alphabet, Category, StudyGroup } from "./types.ts";

type Row = [string, string, string, string];

const basic: Row[] = [
  ["vowels", "The vowels", "あいうえお", "a i u e o"],
  ["k", "The K row", "かきくけこ", "ka ki ku ke ko"],
  ["s", "The S row", "さしすせそ", "sa shi su se so"],
  ["t", "The T row", "たちつてと", "ta chi tsu te to"],
  ["n", "The N row", "なにぬねの", "na ni nu ne no"],
  ["h", "The H row", "はひふへほ", "ha hi fu he ho"],
  ["m", "The M row", "まみむめも", "ma mi mu me mo"],
  ["y", "The Y row", "やゆよ", "ya yu yo"],
  ["r", "The R row", "らりるれろ", "ra ri ru re ro"],
  ["w-n", "The final sounds", "わをん", "wa wo n"],
];
const voiced: Row[] = [
  ["g", "The G row", "がぎぐげご", "ga gi gu ge go"],
  ["z", "The Z row", "ざじずぜぞ", "za ji zu ze zo"],
  ["d", "The D row", "だぢづでど", "da ji zu de do"],
  ["b", "The B row", "ばびぶべぼ", "ba bi bu be bo"],
  ["p", "The P row", "ぱぴぷぺぽ", "pa pi pu pe po"],
];
const combined: Row[] = [
  ["ky", "K + small Y", "きゃ きゅ きょ", "kya kyu kyo"],
  ["sh", "Sh + small Y", "しゃ しゅ しょ", "sha shu sho"],
  ["ch", "Ch + small Y", "ちゃ ちゅ ちょ", "cha chu cho"],
  ["ny", "N + small Y", "にゃ にゅ にょ", "nya nyu nyo"],
  ["hy", "H + small Y", "ひゃ ひゅ ひょ", "hya hyu hyo"],
  ["my", "M + small Y", "みゃ みゅ みょ", "mya myu myo"],
  ["ry", "R + small Y", "りゃ りゅ りょ", "rya ryu ryo"],
  ["gy", "G + small Y", "ぎゃ ぎゅ ぎょ", "gya gyu gyo"],
  ["j", "J + small Y", "じゃ じゅ じょ", "ja ju jo"],
  ["by", "B + small Y", "びゃ びゅ びょ", "bya byu byo"],
  ["py", "P + small Y", "ぴゃ ぴゅ ぴょ", "pya pyu pyo"],
];
const foreign: Row[] = [
  ["f", "The F sounds", "ファ フィ フェ フォ", "fa fi fe fo"],
  ["foreign-sh", "She, je & che", "シェ ジェ チェ", "she je che"],
  [
    "foreign-td",
    "Extra T & D sounds",
    "ティ ディ トゥ ドゥ テュ デュ",
    "ti di tu du tyu dyu",
  ],
  ["foreign-w", "Extra W sounds", "ウィ ウェ ウォ", "wi we wo"],
  ["v", "The V sounds", "ヴァ ヴィ ヴ ヴェ ヴォ", "va vi vu ve vo"],
  ["foreign-ts", "Extra Ts sounds", "ツァ ツィ ツェ ツォ", "tsa tsi tse tso"],
];

function katakana(text: string) {
  return Array.from(text, (char) => {
    const code = char.codePointAt(0)!;
    return code >= 0x3041 && code <= 0x3096
      ? String.fromCodePoint(code + 0x60)
      : char;
  }).join("");
}

function makeGroup(
  alphabet: Alphabet,
  category: Category,
  row: Row,
): StudyGroup {
  const [key, title, glyphs, readings] = row;
  const id = `${alphabet}-${category}-${key}`;
  const characters = glyphs.includes(" ")
    ? glyphs.split(" ")
    : Array.from(glyphs);
  return {
    id,
    alphabet,
    category,
    title,
    description:
      category === "basic"
        ? "Start with these everyday sounds."
        : category === "voiced"
          ? "A small mark makes a new sound."
          : category === "combined"
            ? "Two characters, one syllable."
            : category === "foreign"
              ? "Sounds borrowed from other languages."
              : "Read these sounds in a word.",
    note:
      key === "d"
        ? "ぢ / ヂ share the reading ji with じ / ジ. づ / ヅ share zu with ず / ズ. The spelling depends on the word."
        : key === "w-n"
          ? "を / ヲ is written wo in this chart, but the object particle is pronounced o. ん / ン is the syllabic n."
          : category === "combined"
            ? "The small ゃ, ゅ, ょ (ャ, ュ, ョ) join the preceding sound. きゃ is kya; full-sized きや is kiya."
            : key === "v"
              ? "ヴ represents a borrowed v sound. In everyday speech, some speakers use a b-like sound."
              : undefined,
    items: characters.map((glyph, index) => ({
      id: `${id}-${index}`,
      alphabet,
      groupId: id,
      glyph: alphabet === "katakana" ? katakana(glyph) : glyph,
      reading: readings.split(" ")[index],
    })),
  };
}

export const groups: StudyGroup[] = (["hiragana", "katakana"] as const).flatMap(
  (alphabet) => {
    const rows = [
      ...basic.map((row) => makeGroup(alphabet, "basic", row)),
      ...voiced.map((row) => makeGroup(alphabet, "voiced", row)),
      ...combined.map((row) => makeGroup(alphabet, "combined", row)),
      ...(alphabet === "katakana"
        ? foreign.map((row) => makeGroup(alphabet, "foreign", row))
        : []),
    ];
    const smallTsu = makeGroup(
      alphabet,
      "context",
      alphabet === "hiragana"
        ? [
            "small-tsu",
            "A little pause: small っ",
            "きって まって がっこう ざっし",
            "kitte matte gakkō zasshi",
          ]
        : [
            "small-tsu",
            "A little pause: small ッ",
            "キット カップ ベッド バッグ",
            "kitto kappu beddo baggu",
          ],
    );
    smallTsu.note =
      "Small っ / ッ has no reading by itself. It adds a short pause before the next consonant, written as a doubled consonant in romaji. きって (kitte) means stamp; カップ (kappu) means cup.";
    rows.push(smallTsu);
    if (alphabet === "katakana") {
      const long = makeGroup(alphabet, "context", [
        "long-vowels",
        "Hold the vowel: ー",
        "コーヒー スーパー ケーキ タクシー",
        "kōhī sūpā kēki takushī",
      ]);
      long.note =
        "ー lengthens the vowel before it; it has no reading by itself. In Hepburn, a macron marks a long vowel: コーヒー is kōhī (coffee), スーパー is sūpā (supermarket). がっこう is gakkō (school); its う lengthens the o sound.";
      rows.push(long);
    }
    return rows;
  },
);

export const items = groups.flatMap((group) => group.items);
export const itemById = new Map(items.map((item) => [item.id, item]));
export const groupById = new Map(groups.map((group) => [group.id, group]));
export const categories: {
  id: Category;
  title: string;
  description: string;
}[] = [
  {
    id: "basic",
    title: "The essentials",
    description: "Your first 46 characters. A little practice goes a long way.",
  },
  {
    id: "voiced",
    title: "A change of sound",
    description:
      "Meet dakuten and handakuten, the small marks that change a sound.",
  },
  {
    id: "combined",
    title: "Better together",
    description: "Combine a character with a small Y sound.",
  },
  {
    id: "foreign",
    title: "Sounds from elsewhere",
    description: "Katakana combinations for borrowed words.",
  },
  {
    id: "context",
    title: "Small details, big difference",
    description: "Learn pauses and longer sounds through short words.",
  },
];
