"use client";

import { useEffect, useRef, useState } from "react";

type AiMessage = {
  id: string;
  role: "user" | "assistant" | string;
  message: string;
  createdAt: string;
  processedAt: string;
};

export default function AiChatPage() {
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("未接続");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const fetchMessages = async () => {
    try {
      const res = await fetch("/api/ai-messages", {
        method: "GET",
        cache: "no-store",
      });

      const data = await res.json();

      if (!data.ok) {
        setStatus(`取得エラー: ${data.error || "unknown"}`);
        return;
      }

      setMessages(data.messages || []);
      setStatus("接続中");
    } catch {
      setStatus("取得に失敗しました");
    }
  };

  useEffect(() => {
    fetchMessages();

    const timer = window.setInterval(() => {
      fetchMessages();
    }, 5000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    const message = input.trim();

    if (!message) return;

    setLoading(true);
    setInput("");

    try {
      const res = await fetch("/api/ai-messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message }),
      });

      const data = await res.json();

      if (!data.ok) {
        setStatus(`送信エラー: ${data.error || "unknown"}`);
        return;
      }

      await fetchMessages();
      setStatus("送信しました。PCのAI Workerが処理すると返信が表示されます。");
    } catch {
      setStatus("送信に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-4">
        <header className="mb-4 rounded-2xl border border-indigo-400/20 bg-slate-900/80 p-4 shadow-lg">
          <p className="text-xs text-indigo-300">Local LLM Chat</p>
          <h1 className="text-2xl font-bold text-white">AI秘書チャット</h1>
          <p className="mt-2 text-sm text-slate-300">
            スマホから送った内容を、PCのOllamaが処理して返信します。
          </p>
          <p className="mt-2 text-xs text-slate-400">状態：{status}</p>
        </header>

        <section className="flex-1 space-y-3 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900/50 p-3">
          {messages.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">
              まだメッセージはありません。
            </div>
          ) : (
            messages.map((item) => {
              const isUser = item.role === "user";

              return (
                <div
                  key={item.id}
                  className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${
                      isUser
                        ? "bg-indigo-500 text-white"
                        : "border border-slate-700 bg-slate-800 text-slate-100"
                    }`}
                  >
                    <div className="mb-1 text-[11px] opacity-70">
                      {isUser ? "あなた" : "ローカルAI"} / {item.createdAt}
                    </div>
                    {item.message}
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </section>

        <footer className="mt-4 rounded-2xl border border-slate-800 bg-slate-900 p-3">
          <div className="mb-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                setInput("通常モードで考えて、今日やることを3つ教えて")
              }
              className="rounded-full border border-indigo-400/40 px-3 py-1 text-xs text-indigo-200"
            >
              今日やること
            </button>

            <button
              type="button"
              onClick={() =>
                setInput("ディープモードで考えて、今のタスクの優先順位を整理して")
              }
              className="rounded-full border border-purple-400/40 px-3 py-1 text-xs text-purple-200"
            >
              ディープ分析
            </button>

            <button
              type="button"
              onClick={() =>
                setInput("このタスク管理AIの次の一手を教えて")
              }
              className="rounded-full border border-slate-600 px-3 py-1 text-xs text-slate-200"
            >
              次の一手
            </button>
          </div>

          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  sendMessage();
                }
              }}
              placeholder="AIに聞きたいことを入力。例：通常モードで考えて、今日何すればいい？"
              className="min-h-24 flex-1 resize-none rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400"
            />

            <button
              type="button"
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              送信
            </button>
          </div>

          <p className="mt-2 text-xs text-slate-500">
            Ctrl + Enter でも送信できます。返信にはPC側のAI Worker起動が必要です。
          </p>
        </footer>
      </div>
    </main>
  );
}