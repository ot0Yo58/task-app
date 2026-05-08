"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type AiMessage = {
  id: string;
  role: "user" | "assistant" | string;
  message: string;
  createdAt: string;
  processedAt: string;
};

function formatMessageTime(value: string) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");

  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
}

function sortMessages(messages: AiMessage[]) {
  return [...messages].sort((a, b) => {
    const aTime = Date.parse(a.createdAt);
    const bTime = Date.parse(b.createdAt);

    if (Number.isFinite(aTime) && Number.isFinite(bTime)) {
      return aTime - bTime;
    }

    return String(a.createdAt).localeCompare(String(b.createdAt));
  });
}

export default function AiChatPage() {
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("未接続");
  const [lastFetchedAt, setLastFetchedAt] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fetchingRef = useRef(false);

  const fetchMessages = useCallback(async () => {
    if (fetchingRef.current) return;

    fetchingRef.current = true;

    try {
      const res = await fetch(`/api/ai-messages?limit=80&ts=${Date.now()}`, {
        method: "GET",
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache",
        },
      });

      const data = await res.json();

      if (!data.ok) {
        setStatus(`取得エラー: ${data.error || "unknown"}`);
        return;
      }

      const nextMessages = Array.isArray(data.messages)
        ? sortMessages(data.messages)
        : [];

      setMessages(nextMessages);
      setStatus("接続中");
      setLastFetchedAt(formatMessageTime(new Date().toISOString()));
    } catch {
      setStatus("取得に失敗しました");
    } finally {
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchMessages();

    const timer = window.setInterval(() => {
      fetchMessages();
    }, 3000);

    const handleFocus = () => {
      fetchMessages();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchMessages();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    const message = input.trim();

    if (!message) return;

    setLoading(true);
    setInput("");

    try {
      const res = await fetch(`/api/ai-messages?ts=${Date.now()}`, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
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

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>状態：{status}</span>

            {lastFetchedAt && <span>最終取得：{lastFetchedAt}</span>}

            <button
              type="button"
              onClick={fetchMessages}
              className="rounded-full border border-slate-600 px-3 py-1 text-slate-200 hover:bg-slate-800"
            >
              手動更新
            </button>
          </div>
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
                      {isUser ? "あなた" : "ローカルAI"} /{" "}
                      {formatMessageTime(item.createdAt)}
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
                setInput(
                  "ディープモードで考えて、今のタスクの優先順位を整理して",
                )
              }
              className="rounded-full border border-purple-400/40 px-3 py-1 text-xs text-purple-200"
            >
              ディープ分析
            </button>

            <button
              type="button"
              onClick={() => setInput("このタスク管理AIの次の一手を教えて")}
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
              {loading ? "送信中" : "送信"}
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