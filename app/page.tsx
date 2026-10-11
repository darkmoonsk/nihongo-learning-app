import NihongoApp from "@/components/nihongo-app";
import manifest from "@/public/audio/ja/manifest.json";
import { items } from "@/lib/kana/catalog";
import type { AudioSources } from "@/lib/pronunciation-player";

export default function Home() {
  const sources: AudioSources = {};
  for (const item of items) {
    const entry = manifest.items[item.id as keyof typeof manifest.items];
    if (entry?.text === item.glyph && entry.url === `/audio/ja/${item.id}.mp3`)
      sources[item.id] = entry.url;
  }
  return <NihongoApp audioSources={sources} />;
}
