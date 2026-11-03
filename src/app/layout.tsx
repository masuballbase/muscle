import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "筋トレ記録アプリ",
  description: "日々のトレーニングを記録するアプリ",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
