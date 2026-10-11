import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const jakarta = localFont({
  src: "./fonts/PlusJakartaSans.woff2",
  variable: "--font-jakarta",
  display: "swap",
});

const japanese = localFont({
  src: "./fonts/NotoSansJP.woff2",
  variable: "--font-japanese",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "Nihongo — A little Japanese, every day",
  description:
    "Learn to read hiragana and katakana with short, friendly lessons and multiple-choice practice. Start your Japanese journey, one character at a time.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${jakarta.variable} ${japanese.variable}`}>
      <body>{children}</body>
    </html>
  );
}
