"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type AiMode = "normal" | "deep";

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

function stripControlBlock(message: string) {
  return message
    .replace(
      /^\[\[TASK_AI_CONTROL\]\][\s\S]*?\[\[END_TASK_AI_CONTROL\]\]\n?/,
      "",
    )
    .trim();
}

function buildWorkerMessage({
  mode,
  confirmBeforeEdit,
  message,
}: {
  mode: AiMode;
  confirmBeforeEdit: boolean;
  message: string;
}) {
  const modeLabel = mode === "deep" ? "ディープモード" : "通常モード";

  const confirmRule = confirmBeforeEdit
    ? [
        "タスク編集確認ルール：有効",
        "タスクの追加・編集・クローズ・再オープン・履歴追加・次回対応日時変更など、タスク管理データを書き換える操作が必要な場合は、すぐに実行しないでください。",
        "まず『編集確認』として、変更予定の内容を箇条書きで提示してください。",
        "ユーザーが『実行して』『OK』『それで登録して』『反映して』など、明確に承認した場合だけ実行してください。",
        "削除系の操作は実行禁止です。削除が必要そうな場合も、提案だけにしてください。",
      ].join("\n")
    : [
        "タスク編集確認ルール：無効",
        "ただし、削除系の操作は実行禁止です。",
      ].join("\n");

  return [
    "[[TASK_AI_CONTROL]]",
    `mode=${mode}`,
    `${modeLabel}で考えてください。`,
    confirmRule,
    "[[END_TASK_AI_CONTROL]]",
    message,
  ].join("\n");
}

export default function AiChatPage() {
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<AiMode>("normal");
  const [confirmBeforeEdit, setConfirmBeforeEdit] = useState(true);
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

    const workerMessage = buildWorkerMessage({
      mode,
      confirmBeforeEdit,
      message,
    });

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
        body: JSON.stringify({ message: workerMessage }),
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

  const currentModeLabel = mode === "deep" ? "ディープモード" : "通常モード";

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-4">
        <header className="mb-4 rounded-2xl border border-indigo-400/20 bg-slate-900/80 p-4 shadow-lg">
          <p className="text-xs text-indigo-300">Local LLM Chat</p>

          <h1 className="text-2xl font-bold text-white">AI秘書チャット</h1>

          <p className="mt-2 text-sm text-slate-300">
            スマホから送った内容を、PCのOllamaが処理して返信します。
          </p>

          <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
            <p className="mb-2 text-xs font-bold text-slate-300">
              現在モード：{currentModeLabel}
            </p>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("normal")}
                className={`rounded-xl border px-3 py-2 text-sm font-bold ${
                  mode === "normal"
                    ? "border-indigo-400 bg-indigo-500 text-white"
                    : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
                }`}
              >
                通常モード
              </button>

              <button
                type="button"
                onClick={() => setMode("deep")}
                className={`rounded-xl border px-3 py-2 text-sm font-bold ${
                  mode === "deep"
                    ? "border-purple-400 bg-purple-500 text-white"
                    : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
                }`}
              >
                ディープモード
              </button>
            </div>

            <button
              type="button"
              onClick={() => setConfirmBeforeEdit((current) => !current)}
              className={`mt-3 w-full rounded-xl border px-3 py-2 text-left text-xs ${
                confirmBeforeEdit
                  ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-200"
                  : "border-yellow-400/60 bg-yellow-500/10 text-yellow-100"
              }`}
            >
              編集前確認：{confirmBeforeEdit ? "ON" : "OFF"}
              <span className="mt-1 block text-[11px] opacity-80">
                ONの場合、AIがタスクを編集する前に「変更予定の内容」を確認するよう指示します。
              </span>
            </button>
          </div>

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
              const displayMessage = stripControlBlock(item.message);

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

                    {displayMessage}
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
              onClick={() => {
                setMode("normal");
                setInput("今日やることを3つ教えて");
              }}
              className="rounded-full border border-indigo-400/40 px-3 py-1 text-xs text-indigo-200"
            >
              今日やること
            </button>

            <button
              type="button"
              onClick={() => {
                setMode("deep");
                setInput("今のタスクの優先順位を整理して");
              }}
              className="rounded-full border border-purple-400/40 px-3 py-1 text-xs text-purple-200"
            >
              ディープ分析
            </button>

            <button
              type="button"
              onClick={() => {
                setMode("normal");
                setInput("このタスク管理AIの次の一手を教えて");
              }}
              className="rounded-full border border-slate-600 px-3 py-1 text-xs text-slate-200"
            >
              次の一手
            </button>

            <button
              type="button"
              onClick={() => {
                setMode("deep");
                setConfirmBeforeEdit(true);
                setInput("タスクを編集したい。まず変更予定の内容を確認して");
              }}
              className="rounded-full border border-emerald-400/40 px-3 py-1 text-xs text-emerald-200"
            >
              編集確認
            </button>
          </div>

          <div className="mb-2 rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-400">
            送信時に自動で「{currentModeLabel}」として送ります。
            {confirmBeforeEdit
              ? " タスク編集が必要な場合は、AIに先に確認内容を出すよう指示します。"
              : " 編集前確認はOFFです。削除系は禁止のままです。"}
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
              placeholder="AIに聞きたいことを入力。例：明日9時に〇〇へ電話するタスクを追加したい"
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