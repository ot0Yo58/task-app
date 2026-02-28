"use client";

import React, { useEffect, useMemo, useState } from "react";

/**
 * ---- Spec implemented ----
 * - Tasks: open/closed
 * - Close moves to closed list; auto-delete closed tasks after 2 years
 * - Task sorting (open list): dueDate blank first, else dueDate ascending
 * - Visual alerts (open list):
 *    - overdue => red
 *    - within 30 minutes => yellow
 * - History entries:
 *    - type: email/phone/other (radio with icons)
 *    - subject: used for all types
 *    - editable
 *    - soft delete first; permanent delete after 12 hours; can restore within 12 hours
 * - LocalStorage persistence + safe migration from older shapes
 */

type HistoryType = "email" | "phone" | "other";

type HistoryEntry = {
  id: string;
  type: HistoryType;
  subject: string;
  note: string;
  at: string; // ISO
  deletedAt?: string; // ISO for soft delete
};

type TaskState = "open" | "closed";

type Task = {
  id: number;
  text: string;
  dueDate: string; // datetime-local value e.g. "2026-02-23T18:30"
  status: string; // free input
  state: TaskState;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  closedAt?: string; // ISO (only when closed)
  history: HistoryEntry[];
};

const STORAGE_KEY = "tasks";

// 2 years (approx) & 12 hours in ms
const TWO_YEARS_MS = 730 * 24 * 60 * 60 * 1000;
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const THIRTY_MIN_MS = 30 * 60 * 1000;

function normalizeDateInput(v: string) {
  // 数字だけでも入れられるようにする（例: 20260223 → 2026-02-23）
  const s = v.trim();
  const digits = s.replace(/\D/g, "");
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  return s;
}

function normalizeTimeInput(v: string) {
  // 例: 1645 → 16:45
  const s = v.trim();
  const digits = s.replace(/\D/g, "");
  if (digits.length === 4) {
    return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
  }
  return s;
}

function isValidDateYYYYMMDD(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function isValidTimeHHmm(v: string) {
  if (!/^\d{2}:\d{2}$/.test(v)) return false;
  const [h, m] = v.split(":").map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function combineDateTimeLocalFromText(date: string, time: string) {
  const d = normalizeDateInput(date);
  const t = normalizeTimeInput(time);
  if (!isValidDateYYYYMMDD(d) || !isValidTimeHHmm(t)) return "";
  return `${d}T${t}`;
}

function splitDateTimeLocalToText(value: string) {
  if (!value) return { date: "", time: "" };
  const [date, time] = value.split("T");
  return { date: date ?? "", time: time ?? "" };
}

function nowIso() {
  return new Date().toISOString();
}

function isObject(x: unknown): x is Record<string, any> {
  return !!x && typeof x === "object";
}

function parseDueToMs(dueDate: string): number | null {
  if (!dueDate) return null;

  // dueDate: "YYYY-MM-DDTHH:mm"
  const [datePart, timePart] = dueDate.split("T");
  if (!datePart || !timePart) return null;

  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);

  if (
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d) ||
    !Number.isFinite(hh) ||
    !Number.isFinite(mm)
  ) {
    return null;
  }

  // ★ ローカル時刻として生成（UTCズレを防ぐ）
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

function safeUUID() {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    // @ts-ignore
    return crypto.randomUUID() as string;
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function typeIcon(t: HistoryType) {
  if (t === "email") return "📧";
  if (t === "phone") return "📞";
  return "📝";
}

function formatDateTimeLocal(value: string) {
  if (!value) return "未設定";
  return value.replace("T", " ");
}

function formatIsoToYmdHm(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function remainingMsUntilHardDelete(deletedAtIso: string) {
  const deletedAtMs = Date.parse(deletedAtIso);
  if (!Number.isFinite(deletedAtMs)) return 0;
  const elapsed = Date.now() - deletedAtMs;
  return Math.max(0, TWELVE_HOURS_MS - elapsed);
}

function formatRemaining(ms: number) {
  const totalMinutes = Math.ceil(ms / (60 * 1000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h <= 0) return `${m}分`;
  return `${h}時間${m}分`;
}

function normalizeHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((h) => isObject(h))
    .map((h) => {
      const type: HistoryType =
        h.type === "email" || h.type === "phone" || h.type === "other" ? h.type : "other";
      const subject = typeof h.subject === "string" ? h.subject : "";
      const note = typeof h.note === "string" ? h.note : "";
      const at = typeof h.at === "string" ? h.at : nowIso();
      const id = typeof h.id === "string" ? h.id : safeUUID();
      const deletedAt = typeof h.deletedAt === "string" ? h.deletedAt : undefined;
      return { id, type, subject, note, at, deletedAt };
    });
}

function normalizeTasks(raw: unknown): Task[] {
  if (!Array.isArray(raw)) return [];

  const tasks: Task[] = [];
  for (const item of raw) {
    if (!isObject(item) || typeof item.id !== "number") continue;

    const text = typeof item.text === "string" ? item.text : "";
    const dueDate = typeof item.dueDate === "string" ? item.dueDate : "";
    const status = typeof item.status === "string" ? item.status : "";
    const state: TaskState = item.state === "closed" ? "closed" : "open";

    const createdAt = typeof item.createdAt === "string" ? item.createdAt : nowIso();
    const updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : createdAt;

    const closedAt = typeof item.closedAt === "string" ? item.closedAt : undefined;

    const history = normalizeHistory(item.history);

    tasks.push({
      id: item.id,
      text,
      dueDate,
      status,
      state,
      createdAt,
      updatedAt,
      closedAt,
      history,
    });
  }
  return tasks;
}

function loadTasks(): Task[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return [];
    const raw = JSON.parse(saved);
    return normalizeTasks(raw);
  } catch {
    return [];
  }
}

function saveTasks(tasks: Task[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function cleanup(tasks: Task[]): Task[] {
  const now = Date.now();

  // 1) Remove closed tasks older than 2 years from closedAt
  let cleaned = tasks.filter((t) => {
    if (t.state !== "closed") return true;
    if (!t.closedAt) return true;
    const closedMs = Date.parse(t.closedAt);
    if (!Number.isFinite(closedMs)) return true;
    return now - closedMs < TWO_YEARS_MS;
  });

  // 2) Hard-delete history entries soft-deleted more than 12 hours ago
  cleaned = cleaned.map((t) => {
    const nextHistory = t.history.filter((h) => {
      if (!h.deletedAt) return true;
      const delMs = Date.parse(h.deletedAt);
      if (!Number.isFinite(delMs)) return false;
      return now - delMs < TWELVE_HOURS_MS;
    });
    if (nextHistory.length === t.history.length) return t;
    return { ...t, history: nextHistory };
  });

  return cleaned;
}

function taskRowTone(task: Task) {
  const dueMs = parseDueToMs(task.dueDate);
  if (dueMs === null) return "normal";
  const diff = dueMs - Date.now();
  if (diff < 0) return "overdue";
  if (diff <= THIRTY_MIN_MS) return "soon";
  return "normal";
}

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);

  // List view
  const [tab, setTab] = useState<TaskState>("open");

  // Add form
  const [newText, setNewText] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [newStatus, setNewStatus] = useState("");

  // Modal edit
  const [editingId, setEditingId] = useState<number | null>(null);
  const editingTask = useMemo(
    () => tasks.find((t) => t.id === editingId) ?? null,
    [tasks, editingId]
  );

  // Task edit fields
  const [editText, setEditText] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editStatus, setEditStatus] = useState("");

  // History add fields
  const [histType, setHistType] = useState<HistoryType>("email");
  const [histSubject, setHistSubject] = useState("");
  const [histNote, setHistNote] = useState("");

  // History editing state
  const [historyEditingId, setHistoryEditingId] = useState<string | null>(null);
  const [histEditType, setHistEditType] = useState<HistoryType>("email");
  const [histEditSubject, setHistEditSubject] = useState("");
  const [histEditNote, setHistEditNote] = useState("");

  // Initial load + cleanup
  useEffect(() => {
    const loaded = cleanup(loadTasks());
    setTasks(loaded);
    saveTasks(loaded);
  }, []);

  // Service Worker register (PWA)
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // Persist on change
  useEffect(() => {
    saveTasks(tasks);
  }, [tasks]);

  // Periodic cleanup
  useEffect(() => {
    const id = window.setInterval(() => {
      setTasks((prev) => {
        const next = cleanup(prev);
        if (JSON.stringify(next) === JSON.stringify(prev)) return prev;
        return next;
      });
    }, 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  // When modal opens, copy fields
  useEffect(() => {
    if (!editingTask) return;
    setEditText(editingTask.text);
    setEditDueDate(editingTask.dueDate);
    setEditStatus(editingTask.status);

    // reset history add & edit
    setHistType("email");
    setHistSubject("");
    setHistNote("");

    setHistoryEditingId(null);
    setHistEditType("email");
    setHistEditSubject("");
    setHistEditNote("");
  }, [editingTask?.id]);

  const openTasksSorted = useMemo(() => {
    const open = tasks.filter((t) => t.state === "open");

    return [...open].sort((a, b) => {
      const aBlank = !a.dueDate;
      const bBlank = !b.dueDate;
      if (aBlank && !bBlank) return -1;
      if (!aBlank && bBlank) return 1;
      if (aBlank && bBlank) return b.id - a.id;
      return a.dueDate.localeCompare(b.dueDate) || b.id - a.id;
    });
  }, [tasks]);

  const closedTasksSorted = useMemo(() => {
    const closed = tasks.filter((t) => t.state === "closed");
    return [...closed].sort((a, b) => {
      const aMs = a.closedAt ? Date.parse(a.closedAt) : 0;
      const bMs = b.closedAt ? Date.parse(b.closedAt) : 0;
      return bMs - aMs || b.id - a.id;
    });
  }, [tasks]);

  const list = tab === "open" ? openTasksSorted : closedTasksSorted;

  function addTask() {
    const text = newText.trim();
    if (!text) return;

    const iso = nowIso();
    const task: Task = {
      id: Date.now(),
      text,
      dueDate: newDueDate,
      status: newStatus.trim(),
      state: "open",
      createdAt: iso,
      updatedAt: iso,
      history: [],
    };

    setTasks((prev) => [...prev, task]);

    setNewText("");
    setNewDueDate("");
    setNewStatus("");
  }

  function updateTask(id: number, patch: Partial<Task>) {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        return { ...t, ...patch, updatedAt: nowIso() };
      })
    );
  }

  function deleteTask(id: number) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    if (editingId === id) setEditingId(null);
  }

  function closeTask(id: number) {
    const iso = nowIso();
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        if (t.state === "closed") return t;
        const newHistory: HistoryEntry[] = [
          ...t.history,
          {
            id: safeUUID(),
            type: "other",
            subject: "クローズ",
            note: "タスクをクローズしました。",
            at: iso,
          },
        ];
        return {
          ...t,
          state: "closed",
          closedAt: iso,
          updatedAt: iso,
          history: newHistory,
        };
      })
    );
    setEditingId(null);
    setTab("closed");
  }

  function reopenTask(id: number) {
    const iso = nowIso();
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        if (t.state === "open") return t;
        const newHistory: HistoryEntry[] = [
          ...t.history,
          {
            id: safeUUID(),
            type: "other",
            subject: "再オープン",
            note: "タスクを再オープンしました。",
            at: iso,
          },
        ];
        return {
          ...t,
          state: "open",
          closedAt: undefined,
          updatedAt: iso,
          history: newHistory,
        };
      })
    );
    setEditingId(null);
    setTab("open");
  }

  function saveTaskEdits() {
    if (!editingTask) return;
    const text = editText.trim();
    if (!text) return;

    updateTask(editingTask.id, {
      text,
      dueDate: editDueDate,
      status: editStatus.trim(),
    });

    setEditingId(null);
  }

  function addHistory() {
    if (!editingTask) return;

    const subject = histSubject.trim();
    const note = histNote.trim();
    if (!subject && !note) return;

    const entry: HistoryEntry = {
      id: safeUUID(),
      type: histType,
      subject,
      note,
      at: nowIso(),
    };

    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== editingTask.id) return t;
        return { ...t, updatedAt: nowIso(), history: [...t.history, entry] };
      })
    );

    setHistSubject("");
    setHistNote("");
    setHistType("email");
  }

  function beginEditHistory(entry: HistoryEntry) {
    setHistoryEditingId(entry.id);
    setHistEditType(entry.type);
    setHistEditSubject(entry.subject);
    setHistEditNote(entry.note);
  }

  function cancelEditHistory() {
    setHistoryEditingId(null);
    setHistEditType("email");
    setHistEditSubject("");
    setHistEditNote("");
  }

  function saveHistoryEdit(entryId: string) {
    if (!editingTask) return;

    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== editingTask.id) return t;
        const nextHistory = t.history.map((h) => {
          if (h.id !== entryId) return h;
          if (h.deletedAt) return h;
          return {
            ...h,
            type: histEditType,
            subject: histEditSubject,
            note: histEditNote,
          };
        });
        return { ...t, updatedAt: nowIso(), history: nextHistory };
      })
    );

    cancelEditHistory();
  }

  function softDeleteHistory(entryId: string) {
    if (!editingTask) return;
    const iso = nowIso();

    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== editingTask.id) return t;
        const nextHistory = t.history.map((h) => {
          if (h.id !== entryId) return h;
          if (h.deletedAt) return h;
          return { ...h, deletedAt: iso };
        });
        return { ...t, updatedAt: iso, history: nextHistory };
      })
    );

    if (historyEditingId === entryId) cancelEditHistory();
  }

  function restoreHistory(entryId: string) {
    if (!editingTask) return;

    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== editingTask.id) return t;
        const nextHistory = t.history.map((h) => {
          if (h.id !== entryId) return h;
          if (!h.deletedAt) return h;
          return { ...h, deletedAt: undefined };
        });
        return { ...t, updatedAt: nowIso(), history: nextHistory };
      })
    );
  }

  // Styling helpers
  function rowClass(task: Task) {
    const base =
      "w-full text-left border p-3 sm:p-4 rounded-lg hover:bg-gray-50 transition shadow-sm";
    if (task.state !== "open") return `${base} border-gray-200`;

    const tone = taskRowTone(task);
    if (tone === "overdue") return `${base} border-red-400 bg-red-50`;
    if (tone === "soon") return `${base} border-yellow-400 bg-yellow-50`;
    return `${base} border-gray-200`;
  }

  // 共通：入力欄の見た目（スマホで薄くならない）
  const inputBase =
    "border p-3 rounded-lg text-gray-800 placeholder:text-gray-500 bg-white";

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 text-gray-800">
      <div className="max-w-5xl mx-auto bg-white shadow p-4 sm:p-6 rounded-2xl">
        <h1 className="text-2xl sm:text-3xl font-bold mb-4 text-gray-800">
          タスク管理
        </h1>

        {/* Tabs */}
        <div className="flex gap-2 mb-5">
          <button
            onClick={() => setTab("open")}
            className={`px-4 py-3 rounded-xl border text-gray-800 text-sm sm:text-base ${
              tab === "open" ? "bg-gray-100 font-semibold" : "bg-white"
            }`}
          >
            進行中（{openTasksSorted.length}）
          </button>
          <button
            onClick={() => setTab("closed")}
            className={`px-4 py-3 rounded-xl border text-gray-800 text-sm sm:text-base ${
              tab === "closed" ? "bg-gray-100 font-semibold" : "bg-white"
            }`}
          >
            クローズ済み（{closedTasksSorted.length}）
          </button>
        </div>

        {/* Add form */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 mb-6">
          <input
            className={`${inputBase} sm:col-span-12`}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="タスクを入力"
          />

          {(() => {
            const { date, time } = splitDateTimeLocalToText(newDueDate);

            return (
              <>
                <input
                  type="text"
                  inputMode="numeric"
                  className={`${inputBase} sm:col-span-4`}
                  placeholder="日付 2026-02-23 / 20260223"
                  value={date}
                  onChange={(e) => {
                    const d = normalizeDateInput(e.target.value);
                    setNewDueDate(combineDateTimeLocalFromText(d, time));
                  }}
                />
                <input
                  type="text"
                  inputMode="numeric"
                  className={`${inputBase} sm:col-span-4`}
                  placeholder="時刻 16:45 / 1645"
                  value={time}
                  onChange={(e) => {
                    const t = normalizeTimeInput(e.target.value);
                    setNewDueDate(combineDateTimeLocalFromText(date, t));
                  }}
                />
                <input
                  className={`${inputBase} sm:col-span-4`}
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                  placeholder="ステータス（自由）"
                />
              </>
            );
          })()}

          <button
            onClick={addTask}
            className="sm:col-span-12 bg-blue-600 text-white py-3 rounded-xl font-semibold active:scale-[0.99]"
          >
            追加
          </button>
        </div>

        {/* List */}
        <div className="space-y-3">
          {list.map((task) => (
            <button
              key={task.id}
              onClick={() => setEditingId(task.id)}
              className={rowClass(task)}
              title={
                task.state === "open"
                  ? taskRowTone(task) === "overdue"
                    ? "期限切れ"
                    : taskRowTone(task) === "soon"
                    ? "30分以内"
                    : ""
                  : ""
              }
            >
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex-1 min-w-0 font-semibold text-gray-900 break-words">
                  {task.text}
                </div>

                <div className="text-sm text-gray-800">
                  次回対応: {formatDateTimeLocal(task.dueDate)}
                </div>

                <div className="text-sm text-gray-800">
                  ステータス: {task.status || "未設定"}
                </div>

                <div className="text-xs text-gray-600">
                  経緯: {task.history.filter((h) => !h.deletedAt).length}件
                </div>
              </div>
            </button>
          ))}

          {list.length === 0 && (
            <div className="text-gray-600">
              {tab === "open"
                ? "進行中タスクがありません"
                : "クローズ済みタスクがありません"}
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {editingTask && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          onClick={() => setEditingId(null)}
        >
          <div
            className="w-full max-w-3xl bg-white rounded-2xl shadow p-4 sm:p-5 max-h-[90vh] overflow-hidden flex flex-col text-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                タスク詳細
              </h2>
              <button
                onClick={() => setEditingId(null)}
                className="text-gray-600 hover:text-gray-900 text-xl"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-1">
              {/* Task fields */}
              <div className="space-y-3">
                <label className="block">
                  <div className="text-sm text-gray-700 mb-1">タスク名</div>
                  <input
                    className={`w-full ${inputBase}`}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                  />
                </label>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="block">
                    <div className="text-sm text-gray-700 mb-1">
                      次回対応日時
                    </div>

                    {(() => {
                      const { date, time } = splitDateTimeLocalToText(editDueDate);

                      return (
                        <div className="flex flex-wrap gap-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            className={`${inputBase} w-[160px]`}
                            placeholder="日付 2026-02-23 / 20260223"
                            value={date}
                            onChange={(e) => {
                              const d = normalizeDateInput(e.target.value);
                              setEditDueDate(combineDateTimeLocalFromText(d, time));
                            }}
                          />
                          <input
                            type="text"
                            inputMode="numeric"
                            className={`${inputBase} w-[140px]`}
                            placeholder="時刻 16:45 / 1645"
                            value={time}
                            onChange={(e) => {
                              const t = normalizeTimeInput(e.target.value);
                              setEditDueDate(combineDateTimeLocalFromText(date, t));
                            }}
                          />
                        </div>
                      );
                    })()}
                  </label>

                  <label className="block">
                    <div className="text-sm text-gray-700 mb-1">
                      ステータス（自由）
                    </div>
                    <input
                      className={`w-full ${inputBase}`}
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value)}
                      placeholder="例: 対応中 / 保留 / 確認待ち"
                    />
                  </label>
                </div>

                {/* History add */}
                <div className="border rounded-xl p-3 bg-gray-50">
                  <div className="font-semibold mb-2 text-gray-900">
                    対応履歴を追加
                  </div>

                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    <div className="text-sm text-gray-700">種類：</div>

                    <label className="flex items-center gap-1 text-sm text-gray-800">
                      <input
                        type="radio"
                        name="histType"
                        checked={histType === "email"}
                        onChange={() => setHistType("email")}
                      />
                      📧 メール
                    </label>

                    <label className="flex items-center gap-1 text-sm text-gray-800">
                      <input
                        type="radio"
                        name="histType"
                        checked={histType === "phone"}
                        onChange={() => setHistType("phone")}
                      />
                      📞 電話
                    </label>

                    <label className="flex items-center gap-1 text-sm text-gray-800">
                      <input
                        type="radio"
                        name="histType"
                        checked={histType === "other"}
                        onChange={() => setHistType("other")}
                      />
                      📝 その他
                    </label>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input
                      className={`${inputBase}`}
                      value={histSubject}
                      onChange={(e) => setHistSubject(e.target.value)}
                      placeholder="件名（全タイプ共通）"
                    />
                    <button
                      onClick={addHistory}
                      className="bg-blue-600 text-white px-4 py-3 rounded-xl font-semibold active:scale-[0.99]"
                    >
                      追加
                    </button>
                  </div>

                  <textarea
                    className={`mt-2 w-full ${inputBase} min-h-[90px]`}
                    value={histNote}
                    onChange={(e) => setHistNote(e.target.value)}
                    placeholder="本文（例: 3/1 11:00 振込確認。未着のため再連絡予定。)"
                  />
                  <div className="text-xs text-gray-600 mt-1">
                    ※「件名」か「本文」のどちらかが入っていれば追加できます
                  </div>
                </div>

                {/* History list */}
                <div className="border rounded-xl p-3 bg-white">
                  <div className="font-semibold mb-2 text-gray-900">対応履歴</div>

                  <div className="flex flex-col max-h-[320px]">
                    {editingTask.history.length === 0 ? (
                      <div className="text-sm text-gray-600">
                        まだ履歴がありません
                      </div>
                    ) : (
                      <ul className="space-y-2 overflow-y-auto pr-1">
                        {[...editingTask.history]
                          .slice()
                          .reverse()
                          .map((h) => {
                            const isDeleted = !!h.deletedAt;
                            const isEditing = historyEditingId === h.id;
                            const remaining = h.deletedAt
                              ? remainingMsUntilHardDelete(h.deletedAt)
                              : 0;

                            return (
                              <li
                                key={h.id}
                                className={`border rounded-xl p-3 ${
                                  isDeleted ? "opacity-70 bg-gray-50" : "bg-white"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <div className="text-xs text-gray-600">
                                      {formatIsoToYmdHm(h.at)}{" "}
                                      {isDeleted && h.deletedAt ? (
                                        <span className="ml-2 text-red-700">
                                          削除済み（あと{formatRemaining(remaining)}で完全削除）
                                        </span>
                                      ) : null}
                                    </div>

                                    {!isEditing ? (
                                      <>
                                        <div className="text-sm font-semibold truncate text-gray-900">
                                          {typeIcon(h.type)}{" "}
                                          {h.subject || "（件名なし）"}
                                        </div>
                                        <div className="text-sm whitespace-pre-wrap text-gray-800">
                                          {h.note || "（本文なし）"}
                                        </div>
                                      </>
                                    ) : (
                                      <div className="mt-2 space-y-2">
                                        <div className="flex flex-wrap items-center gap-3">
                                          <div className="text-sm text-gray-700">
                                            種類：
                                          </div>
                                          <label className="flex items-center gap-1 text-sm text-gray-800">
                                            <input
                                              type="radio"
                                              name={`editType-${h.id}`}
                                              checked={histEditType === "email"}
                                              onChange={() =>
                                                setHistEditType("email")
                                              }
                                            />
                                            📧
                                          </label>
                                          <label className="flex items-center gap-1 text-sm text-gray-800">
                                            <input
                                              type="radio"
                                              name={`editType-${h.id}`}
                                              checked={histEditType === "phone"}
                                              onChange={() =>
                                                setHistEditType("phone")
                                              }
                                            />
                                            📞
                                          </label>
                                          <label className="flex items-center gap-1 text-sm text-gray-800">
                                            <input
                                              type="radio"
                                              name={`editType-${h.id}`}
                                              checked={histEditType === "other"}
                                              onChange={() =>
                                                setHistEditType("other")
                                              }
                                            />
                                            📝
                                          </label>
                                        </div>

                                        <input
                                          className={`w-full ${inputBase}`}
                                          value={histEditSubject}
                                          onChange={(e) =>
                                            setHistEditSubject(e.target.value)
                                          }
                                          placeholder="件名"
                                        />
                                        <textarea
                                          className={`w-full ${inputBase} min-h-[80px]`}
                                          value={histEditNote}
                                          onChange={(e) =>
                                            setHistEditNote(e.target.value)
                                          }
                                          placeholder="本文"
                                        />
                                      </div>
                                    )}
                                  </div>

                                  <div className="flex flex-col gap-2 shrink-0">
                                    {!isDeleted ? (
                                      <>
                                        {!isEditing ? (
                                          <button
                                            onClick={(e) => {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              beginEditHistory(h);
                                            }}
                                            className="text-sm border px-3 py-2 rounded-xl hover:bg-gray-50 text-gray-800"
                                          >
                                            編集
                                          </button>
                                        ) : (
                                          <>
                                            <button
                                              onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                saveHistoryEdit(h.id);
                                              }}
                                              className="text-sm bg-blue-600 text-white px-3 py-2 rounded-xl font-semibold"
                                            >
                                              保存
                                            </button>
                                            <button
                                              onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                cancelEditHistory();
                                              }}
                                              className="text-sm border px-3 py-2 rounded-xl text-gray-800"
                                            >
                                              キャンセル
                                            </button>
                                          </>
                                        )}

                                        <button
                                          onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            softDeleteHistory(h.id);
                                          }}
                                          className="text-sm text-red-700 border px-3 py-2 rounded-xl hover:bg-red-50"
                                        >
                                          削除
                                        </button>
                                      </>
                                    ) : (
                                      <button
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          restoreHistory(h.id);
                                        }}
                                        className="text-sm border px-3 py-2 rounded-xl hover:bg-gray-50 text-gray-800"
                                      >
                                        復元
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                      </ul>
                    )}
                  </div>
                </div>

                {/* Metadata */}
                <div className="text-xs text-gray-600">
                  作成: {formatIsoToYmdHm(editingTask.createdAt)} / 更新:{" "}
                  {formatIsoToYmdHm(editingTask.updatedAt)}
                  {editingTask.state === "closed" && editingTask.closedAt
                    ? ` / クローズ: ${formatIsoToYmdHm(editingTask.closedAt)}`
                    : ""}
                </div>
              </div>
            </div>

            {/* Footer buttons */}
            <div className="pt-4 mt-4 border-t flex items-center justify-between gap-2">
              <button
                onClick={() => deleteTask(editingTask.id)}
                className="text-red-700 hover:text-red-900 font-semibold"
              >
                タスク削除
              </button>

              <div className="flex flex-wrap gap-2">
                {editingTask.state === "open" ? (
                  <button
                    onClick={() => closeTask(editingTask.id)}
                    className="border px-4 py-3 rounded-xl hover:bg-gray-50 text-gray-800"
                  >
                    クローズ
                  </button>
                ) : (
                  <button
                    onClick={() => reopenTask(editingTask.id)}
                    className="border px-4 py-3 rounded-xl hover:bg-gray-50 text-gray-800"
                  >
                    再オープン
                  </button>
                )}

                <button
                  onClick={() => setEditingId(null)}
                  className="border px-4 py-3 rounded-xl text-gray-800"
                >
                  閉じる
                </button>

                <button
                  onClick={saveTaskEdits}
                  className="bg-blue-600 text-white px-5 py-3 rounded-xl font-semibold disabled:opacity-50"
                  disabled={editText.trim() === ""}
                  title={editText.trim() === "" ? "タスク名は必須です" : ""}
                >
                  保存
                </button>
              </div>
            </div>

            {editText.trim() === "" && (
              <div className="text-sm text-red-700 mt-2">
                ※タスク名が空だと保存できません
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}