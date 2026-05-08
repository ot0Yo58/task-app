import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "タスク管理",
  description: "ローカル保存のタスク管理アプリ",
  applicationName: "タスク管理",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "タスク管理",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/95 text-slate-100 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <a href="/" className="text-sm font-bold text-white">
              タスク管理
            </a>

            <nav className="flex gap-2 text-sm">
              <a
                href="/"
                className="rounded-full border border-indigo-400/40 px-3 py-1 text-indigo-200 hover:bg-indigo-500/20"
              >
                タスク一覧
              </a>

              <a
                href="/ai"
                className="rounded-full border border-purple-400/40 px-3 py-1 text-purple-200 hover:bg-purple-500/20"
              >
                AIチャット
              </a>
            </nav>
          </div>
        </header>

        {children}
      </body>
    </html>
  );
}