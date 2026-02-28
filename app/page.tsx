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
 * - Manual backup/restore (JSON copy/paste) with merge
 *
 * ---- Added ----
 * - Date input: 20260203 => auto display "2026/02/03"
 * - Task field: nextNote ("次回活動補足") textarea
 * - NEW: "新規作成" button opens modal for task creation (mobile-friendly)
 * - NEW: History "実施日時" (date+time) can be specified on add & edit (stored in HistoryEntry.at)
 */

type HistoryType = "email" | "phone" | "other";

type HistoryEntry = {
  id: string;
  type: HistoryType;
  subject: string;
  note: string;
  at: string; // ISO (実施日時)
  deletedAt?: string; // ISO for soft delete
};

type TaskState = "open" | "closed";

type Task = {
  id: number;
  text: string;
  dueDate: string; // canonical "YYYY-MM-DDTHH:mm"
  status: string;
  nextNote: string;
  state: TaskState;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  history: HistoryEntry[];
};

const STORAGE_KEY = "tasks";
const TWO_YEARS_MS = 730 * 24 * 60 * 60 * 1000;
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const THIRTY_MIN_MS = 30 * 60 * 1000;

/** =========================
 * Date/Time input helpers
 * ========================= */

/** 表示用：8桁なら "YYYY/MM/DD" に自動整形（例: 20260203 -> 2026/02/03） */
function normalizeDateInputDisplay(v: string) {
  const s = v.trim();
  const digits = s.replace(/\D/g, "");
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}/${digits.slice(4, 6)}/${digits.slice(6, 8)}`;
  }
  return s;
}

/** 保存用："YYYY-MM-DD" へ（8桁数字 / スラッシュOK） */
function normalizeDateForStorage(v: string) {
  const s = v.trim();
  const digits = s.replace(/\D/g, "");
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  return s.replace(/\//g, "-");
}

function normalizeTimeInputDisplay(v: string) {
  const s = v.trim();
  const digits = s.replace(/\D/g, "");
  if (digits.length === 4) {
    return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
  }
  return s;
}

function normalizeTimeForStorage(v: string) {
  return normalizeTimeInputDisplay(v);
}

function isValidDateYYYYMMDDOrSlash(v: string) {
  const normalized = normalizeDateForStorage(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
  const [y, m, d] = normalized.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function isValidTimeHHmm(v: string) {
  if (!/^\d{2}:\d{2}$/.test(v)) return false;
  const [h, m] = v.split(":").map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/** dueDate保存形式に結合（途中入力は ""） */
function combineDateTimeLocalFromText(dateRaw: string, timeRaw: string) {
  const d = normalizeDateForStorage(dateRaw);
  const t = normalizeTimeForStorage(timeRaw);

  if (!dateRaw.trim() && !timeRaw.trim()) return "";
  if (!isValidDateYYYYMMDDOrSlash(d) || !isValidTimeHHmm(t)) return "";
  return `${d}T${t}`;
}

/** dueDate(保存形式) -> 表示用（dateはスラッシュ） */
function splitDateTimeLocalToText(value: string) {
  if (!value) return { date: "", time: "" };
  const [date, time] = value.split("T");
  return {
    date: (date ?? "").replace(/-/g, "/"),
    time: time ?? "",
  };
}

function nowIso() {
  return new Date().toISOString();
}

/** 実施日時：入力(date/time) -> ISO。未入力なら now。片方だけなら無効扱いで now。 */
function buildHistoryAtIso(dateRaw: string, timeRaw: string) {
  const d = normalizeDateForStorage(dateRaw);
  const t = normalizeTimeForStorage(timeRaw);

  const hasAny = !!dateRaw.trim() || !!timeRaw.trim();
  if (!hasAny) return nowIso();

  if (!isValidDateYYYYMMDDOrSlash(d) || !isValidTimeHHmm(t)) {
    return nowIso();
  }

  const [y, m, dd] = d.split("-").map(Number);
  const [hh, mm] = t.split(":").map(Number);

  // local -> ISO
  return new Date(y, m - 1, dd, hh, mm, 0, 0).toISOString();
}

function isObject(x: unknown): x is Record<string, any> {
  return !!x && typeof x === "object";
}

function parseDueToMs(dueDate: string): number | null {
  if (!dueDate) return null;
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
  return value.replace("T", " ").replace(/-/g, "/");
}

function formatIsoToYmdHm(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
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
    const nextNote = typeof item.nextNote === "string" ? item.nextNote : "";
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
      nextNote,
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

  let cleaned = tasks.filter((t) => {
    if (t.state !== "closed") return true;
    if (!t.closedAt) return true;
    const closedMs = Date.parse(t.closedAt);
    if (!Number.isFinite(closedMs)) return true;
    return now - closedMs < TWO_YEARS_MS;
  });

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

/** =========================
 * Manual backup/restore merge
 * ========================= */
function msOr0(iso: string | undefined) {
  if (!iso) return 0;
  const v = Date.parse(iso);
  return Number.isFinite(v) ? v : 0;
}

function mergeHistory(a: HistoryEntry[], b: HistoryEntry[]) {
  const map = new Map<string, HistoryEntry>();
  for (const h of a) map.set(h.id, h);
  for (const h of b) {
    const cur = map.get(h.id);
    if (!cur) {
      map.set(h.id, h);
      continue;
    }
    const curMs = msOr0(cur.at);
    const nextMs = msOr0(h.at);
    map.set(h.id, nextMs >= curMs ? h : cur);
  }
  return Array.from(map.values());
}

function mergeTasks(current: Task[], incoming: Task[]) {
  const map = new Map<number, Task>();
  for (const t of current) map.set(t.id, t);

  for (const inc of incoming) {
    const cur = map.get(inc.id);
    if (!cur) {
      map.set(inc.id, inc);
      continue;
    }

    const curUpdated = msOr0(cur.updatedAt);
    const incUpdated = msOr0(inc.updatedAt);

    const newer = incUpdated >= curUpdated ? inc : cur;
    const older = newer === inc ? cur : inc;

    const mergedHistory = mergeHistory(older.history ?? [], newer.history ?? []);
    map.set(inc.id, { ...newer, history: mergedHistory });
  }

  return Array.from(map.values());
}

async function copyToClipboard(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // ignore
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  } catch {
    return false;
  }
}

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tab, setTab] = useState<TaskState>("open");

  // Create modal
  const [showCreate, setShowCreate] = useState(false);

  // Add form state (create modal)
  const [newText, setNewText] = useState("");
  const [newStatus, setNewStatus] = useState("");
  const [newNextNote, setNewNextNote] = useState("");
  const [newDueDateText, setNewDueDateText] = useState("");
  const [newDueTimeText, setNewDueTimeText] = useState("");

  // Modal edit
  const [editingId, setEditingId] = useState<number | null>(null);
  const editingTask = useMemo(() => tasks.find((t) => t.id === editingId) ?? null, [tasks, editingId]);

  // Task edit fields
  const [editText, setEditText] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editNextNote, setEditNextNote] = useState("");
  const [editDueDateText, setEditDueDateText] = useState("");
  const [editDueTimeText, setEditDueTimeText] = useState("");

  // History add fields
  const [histType, setHistType] = useState<HistoryType>("email");
  const [histSubject, setHistSubject] = useState("");
  const [histNote, setHistNote] = useState("");
  const [histAtDate, setHistAtDate] = useState("");
  const [histAtTime, setHistAtTime] = useState("");

  // History editing state
  const [historyEditingId, setHistoryEditingId] = useState<string | null>(null);
  const [histEditType, setHistEditType] = useState<HistoryType>("email");
  const [histEditSubject, setHistEditSubject] = useState("");
  const [histEditNote, setHistEditNote] = useState("");
  const [histEditAtDate, setHistEditAtDate] = useState("");
  const [histEditAtTime, setHistEditAtTime] = useState("");

  /** backup/restore UI state */
  const [showBackup, setShowBackup] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [backupJson, setBackupJson] = useState("");
  const [restoreJson, setRestoreJson] = useState("");
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const loaded = cleanup(loadTasks());
    setTasks(loaded);
    saveTasks(loaded);
  }, []);

  useEffect(() => {
    saveTasks(tasks);
  }, [tasks]);

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

  useEffect(() => {
    if (!editingTask) return;

    setEditText(editingTask.text);
    setEditStatus(editingTask.status);
    setEditNextNote(editingTask.nextNote ?? "");

    const { date, time } = splitDateTimeLocalToText(editingTask.dueDate);
    setEditDueDateText(date);
    setEditDueTimeText(time);

    setHistType("email");
    setHistSubject("");
    setHistNote("");
    setHistAtDate("");
    setHistAtTime("");

    setHistoryEditingId(null);
    setHistEditType("email");
    setHistEditSubject("");
    setHistEditNote("");
    setHistEditAtDate("");
    setHistEditAtTime("");
  }, [editingTask?.id]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(id);
  }, [toast]);

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

  function resetCreateForm() {
    setNewText("");
    setNewStatus("");
    setNewNextNote("");
    setNewDueDateText("");
    setNewDueTimeText("");
  }

  function openCreate() {
    resetCreateForm();
    setShowCreate(true);
  }

  function addTask() {
    const text = newText.trim();
    if (!text) return;

    const iso = nowIso();
    const dueDate = combineDateTimeLocalFromText(newDueDateText, newDueTimeText);

    const task: Task = {
      id: Date.now(),
      text,
      dueDate,
      status: newStatus.trim(),
      nextNote: newNextNote.trim(),
      state: "open",
      createdAt: iso,
      updatedAt: iso,
      history: [],
    };

    setTasks((prev) => [...prev, task]);
    setShowCreate(false);
    setToast("追加しました");
  }

  function updateTask(id: number, patch: Partial<Task>) {
    setTasks((prev) => prev.map((t) => (t.id !== id ? t : { ...t, ...patch, updatedAt: nowIso() })));
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
          { id: safeUUID(), type: "other", subject: "クローズ", note: "タスクをクローズしました。", at: iso },
        ];
        return { ...t, state: "closed", closedAt: iso, updatedAt: iso, history: newHistory };
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
          { id: safeUUID(), type: "other", subject: "再オープン", note: "タスクを再オープンしました。", at: iso },
        ];
        return { ...t, state: "open", closedAt: undefined, updatedAt: iso, history: newHistory };
      })
    );
    setEditingId(null);
    setTab("open");
  }

  function saveTaskEdits() {
    if (!editingTask) return;
    const text = editText.trim();
    if (!text) return;

    const dueDate = combineDateTimeLocalFromText(editDueDateText, editDueTimeText);

    updateTask(editingTask.id, {
      text,
      dueDate,
      status: editStatus.trim(),
      nextNote: editNextNote.trim(),
    });

    setEditingId(null);
  }

  function addHistory() {
    if (!editingTask) return;

    const subject = histSubject.trim();
    const note = histNote.trim();
    if (!subject && !note) return;

    const atIso = buildHistoryAtIso(histAtDate, histAtTime);

    const entry: HistoryEntry = {
      id: safeUUID(),
      type: histType,
      subject,
      note,
      at: atIso,
    };

    setTasks((prev) =>
      prev.map((t) => (t.id !== editingTask.id ? t : { ...t, updatedAt: nowIso(), history: [...t.history, entry] }))
    );

    setHistSubject("");
    setHistNote("");
    setHistType("email");
    setHistAtDate("");
    setHistAtTime("");
  }

  function beginEditHistory(entry: HistoryEntry) {
    setHistoryEditingId(entry.id);
    setHistEditType(entry.type);
    setHistEditSubject(entry.subject);
    setHistEditNote(entry.note);

    const d = new Date(entry.at);
    if (Number.isNaN(d.getTime())) {
      setHistEditAtDate("");
      setHistEditAtTime("");
      return;
    }
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    setHistEditAtDate(`${yyyy}/${mm}/${dd}`);
    setHistEditAtTime(`${hh}:${mi}`);
  }

  function cancelEditHistory() {
    setHistoryEditingId(null);
    setHistEditType("email");
    setHistEditSubject("");
    setHistEditNote("");
    setHistEditAtDate("");
    setHistEditAtTime("");
  }

  function saveHistoryEdit(entryId: string) {
    if (!editingTask) return;

    const atIso = buildHistoryAtIso(histEditAtDate, histEditAtTime);

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
            at: atIso,
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
        const nextHistory = t.history.map((h) => (h.id !== entryId || h.deletedAt ? h : { ...h, deletedAt: iso }));
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
        const nextHistory = t.history.map((h) => (h.id !== entryId || !h.deletedAt ? h : { ...h, deletedAt: undefined }));
        return { ...t, updatedAt: nowIso(), history: nextHistory };
      })
    );
  }

  function openBackup() {
    const json = JSON.stringify(tasks, null, 2);
    setBackupJson(json);
    setShowBackup(true);
  }

  async function copyBackup() {
    const ok = await copyToClipboard(backupJson);
    setToast(ok ? "コピーしました" : "コピーに失敗しました（手動で選択してコピーしてね）");
  }

  function openRestore() {
    setRestoreError(null);
    setRestoreJson("");
    setShowRestore(true);
  }

  function doRestoreMerge() {
    setRestoreError(null);
    const rawText = restoreJson.trim();
    if (!rawText) {
      setRestoreError("JSONが空です。PC側のバックアップJSONを貼り付けてください。");
      return;
    }

    try {
      const parsed = JSON.parse(rawText);
      const incoming = cleanup(normalizeTasks(parsed));
      if (incoming.length === 0) {
        setRestoreError("取り込めるタスクが見つかりませんでした（JSON形式を確認してください）。");
        return;
      }

      setTasks((prev) => cleanup(mergeTasks(prev, incoming)));

      setShowRestore(false);
      setToast(`復元OK（${incoming.length}件を取り込み）`);
    } catch {
      setRestoreError("JSONの解析に失敗しました。コピー途中で欠けていないか確認してください。");
    }
  }

  function rowClass(task: Task) {
    const base = "w-full text-left border p-3 sm:p-4 rounded-lg hover:bg-gray-50 transition shadow-sm";
    if (task.state !== "open") return `${base} border-gray-200`;
    const tone = taskRowTone(task);
    if (tone === "overdue") return `${base} border-red-400 bg-red-50`;
    if (tone === "soon") return `${base} border-yellow-400 bg-yellow-50`;
    return `${base} border-gray-200`;
  }

  const inputBase = "border p-3 rounded-lg text-gray-800 placeholder:text-gray-500 bg-white";

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 text-gray-800">
      <div className="max-w-5xl mx-auto bg-white shadow p-4 sm:p-6 rounded-2xl">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">タスク管理</h1>

          <div className="flex flex-wrap gap-2">
            <button onClick={openCreate} className="bg-blue-600 text-white px-4 py-2 rounded-xl font-semibold">
              ＋ 新規作成
            </button>

            <button onClick={openBackup} className="border px-4 py-2 rounded-xl hover:bg-gray-50 text-gray-800">
              バックアップ（コピー）
            </button>
            <button onClick={openRestore} className="border px-4 py-2 rounded-xl hover:bg-gray-50 text-gray-800">
              復元（貼り付け）
            </button>
          </div>
        </div>

        <div className="flex gap-2 mb-5">
          <button
            onClick={() => setTab("open")}
            className={`px-4 py-3 rounded-xl border text-gray-800 text-sm sm:text-base ${tab === "open" ? "bg-gray-100 font-semibold" : "bg-white"}`}
          >
            進行中（{openTasksSorted.length}）
          </button>
          <button
            onClick={() => setTab("closed")}
            className={`px-4 py-3 rounded-xl border text-gray-800 text-sm sm:text-base ${tab === "closed" ? "bg-gray-100 font-semibold" : "bg-white"}`}
          >
            クローズ済み（{closedTasksSorted.length}）
          </button>
        </div>

        <div className="space-y-3">
          {list.map((task) => (
            <button key={task.id} onClick={() => setEditingId(task.id)} className={rowClass(task)}>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex-1 min-w-0 font-semibold text-gray-900 break-words">{task.text}</div>
                <div className="text-sm text-gray-800">次回対応: {formatDateTimeLocal(task.dueDate)}</div>
                <div className="text-sm text-gray-800">ステータス: {task.status || "未設定"}</div>
                <div className="text-xs text-gray-600">経緯: {task.history.filter((h) => !h.deletedAt).length}件</div>
              </div>
              {task.nextNote?.trim() ? (
                <div className="mt-2 text-sm text-gray-700 whitespace-pre-wrap line-clamp-2">次回活動補足: {task.nextNote}</div>
              ) : null}
            </button>
          ))}

          {list.length === 0 && <div className="text-gray-600">{tab === "open" ? "進行中タスクがありません" : "クローズ済みタスクがありません"}</div>}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-black/80 text-white px-4 py-2 rounded-xl text-sm">{toast}</div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-3 sm:p-4" onClick={() => setShowCreate(false)}>
          <div className="w-full max-w-3xl bg-white rounded-2xl shadow p-4 sm:p-5 max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-lg font-bold text-gray-900">新規タスク作成</div>
              <button onClick={() => setShowCreate(false)} className="text-gray-600 hover:text-gray-900 text-xl">
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-1 space-y-3">
              <label className="block">
                <div className="text-sm text-gray-700 mb-1">タスク名</div>
                <input className={`w-full ${inputBase}`} value={newText} onChange={(e) => setNewText(e.target.value)} placeholder="タスクを入力" />
              </label>

              <label className="block">
                <div className="text-sm text-gray-700 mb-1">次回対応日時</div>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    className={`${inputBase} w-[160px]`}
                    placeholder="日付 2026/02/03 / 20260203"
                    value={newDueDateText}
                    onChange={(e) => setNewDueDateText(normalizeDateInputDisplay(e.target.value))}
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    className={`${inputBase} w-[140px]`}
                    placeholder="時刻 16:45 / 1645"
                    value={newDueTimeText}
                    onChange={(e) => setNewDueTimeText(normalizeTimeInputDisplay(e.target.value))}
                  />
                </div>
                <div className="text-xs text-gray-600 mt-1">表示プレビュー: {formatDateTimeLocal(combineDateTimeLocalFromText(newDueDateText, newDueTimeText))}</div>
              </label>

              <label className="block">
                <div className="text-sm text-gray-700 mb-1">ステータス（自由）</div>
                <input className={`w-full ${inputBase}`} value={newStatus} onChange={(e) => setNewStatus(e.target.value)} placeholder="例: 対応中 / 保留 / 確認待ち" />
              </label>

              <label className="block">
                <div className="text-sm text-gray-700 mb-1">次回活動補足</div>
                <textarea className={`w-full ${inputBase} min-h-[140px]`} rows={5} value={newNextNote} onChange={(e) => setNewNextNote(e.target.value)} placeholder="次回の作業メモ / 確認事項 / 注意点など（5行くらい）" />
              </label>
            </div>

            <div className="pt-4 mt-4 border-t flex flex-col sm:flex-row gap-2 justify-end">
              <button onClick={() => setShowCreate(false)} className="w-full sm:w-auto border px-5 py-3 rounded-xl text-gray-800">
                キャンセル
              </button>
              <button
                onClick={addTask}
                className="w-full sm:w-auto bg-blue-600 text-white px-5 py-3 rounded-xl font-semibold disabled:opacity-50"
                disabled={newText.trim() === ""}
                title={newText.trim() === "" ? "タスク名は必須です" : ""}
              >
                追加
              </button>
            </div>

            {newText.trim() === "" && <div className="text-sm text-red-700 mt-2">※タスク名が空だと追加できません</div>}
          </div>
        </div>
      )}

      {/* Backup Modal */}
      {showBackup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-3 sm:p-4" onClick={() => setShowBackup(false)}>
          <div className="w-full max-w-3xl bg-white rounded-2xl shadow p-4 sm:p-5 max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-lg font-bold text-gray-900">バックアップ（JSON）</div>
              <button onClick={() => setShowBackup(false)} className="text-gray-600 hover:text-gray-900 text-xl">
                ✕
              </button>
            </div>

            <div className="text-sm text-gray-700 mb-2">PCでこのJSONをコピーして、スマホ側の「復元」に貼り付けて取り込みます。</div>

            <textarea className="w-full flex-1 border rounded-xl p-3 font-mono text-xs text-gray-800 bg-white" value={backupJson} readOnly />

            <div className="mt-3 flex flex-wrap gap-2 justify-end">
              <button onClick={copyBackup} className="bg-blue-600 text-white px-4 py-3 rounded-xl font-semibold">
                JSONをコピー
              </button>
              <button onClick={() => setShowBackup(false)} className="border px-4 py-3 rounded-xl text-gray-800">
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore Modal */}
      {showRestore && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-3 sm:p-4" onClick={() => setShowRestore(false)}>
          <div className="w-full max-w-3xl bg-white rounded-2xl shadow p-4 sm:p-5 max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-lg font-bold text-gray-900">復元（JSON貼り付け）</div>
              <button onClick={() => setShowRestore(false)} className="text-gray-600 hover:text-gray-900 text-xl">
                ✕
              </button>
            </div>

            <div className="text-sm text-gray-700 mb-2">PCでコピーしたバックアップJSONを、ここにそのまま貼り付けてください（マージ取り込み）。</div>

            <textarea className="w-full flex-1 border rounded-xl p-3 font-mono text-xs text-gray-800 bg-white" value={restoreJson} onChange={(e) => setRestoreJson(e.target.value)} placeholder="ここにJSONを貼り付け…" />

            {restoreError && <div className="mt-2 text-sm text-red-700">{restoreError}</div>}

            <div className="mt-3 flex flex-wrap gap-2 justify-end">
              <button onClick={doRestoreMerge} className="bg-blue-600 text-white px-4 py-3 rounded-xl font-semibold">
                取り込む（マージ）
              </button>
              <button onClick={() => setShowRestore(false)} className="border px-4 py-3 rounded-xl text-gray-800">
                キャンセル
              </button>
            </div>

            <div className="mt-2 text-xs text-gray-600">※ 同じIDのタスクがある場合は、更新日時（updatedAt）が新しい方を優先します。履歴は重複を除いて結合します。</div>
          </div>
        </div>
      )}

      {/* Task detail */}
      {editingTask && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto" onClick={() => setEditingId(null)}>
          <div className="w-full max-w-3xl bg-white rounded-2xl shadow p-4 sm:p-5 max-h-[90vh] overflow-hidden flex flex-col text-gray-800" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">タスク詳細</h2>
              <button onClick={() => setEditingId(null)} className="text-gray-600 hover:text-gray-900 text-xl">
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-1">
              <div className="space-y-3">
                <label className="block">
                  <div className="text-sm text-gray-700 mb-1">タスク名</div>
                  <input className={`w-full ${inputBase}`} value={editText} onChange={(e) => setEditText(e.target.value)} />
                </label>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="block">
                    <div className="text-sm text-gray-700 mb-1">次回対応日時</div>
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        className={`${inputBase} w-[160px]`}
                        placeholder="日付 2026/02/03 / 20260203"
                        value={editDueDateText}
                        onChange={(e) => setEditDueDateText(normalizeDateInputDisplay(e.target.value))}
                      />
                      <input
                        type="text"
                        inputMode="numeric"
                        className={`${inputBase} w-[140px]`}
                        placeholder="時刻 16:45 / 1645"
                        value={editDueTimeText}
                        onChange={(e) => setEditDueTimeText(normalizeTimeInputDisplay(e.target.value))}
                      />
                    </div>
                    <div className="text-xs text-gray-600 mt-1">表示プレビュー: {formatDateTimeLocal(combineDateTimeLocalFromText(editDueDateText, editDueTimeText))}</div>
                  </label>

                  <label className="block">
                    <div className="text-sm text-gray-700 mb-1">ステータス（自由）</div>
                    <input className={`w-full ${inputBase}`} value={editStatus} onChange={(e) => setEditStatus(e.target.value)} />
                  </label>
                </div>

                <label className="block">
                  <div className="text-sm text-gray-700 mb-1">次回活動補足</div>
                  <textarea className={`w-full ${inputBase} min-h-[140px]`} rows={5} value={editNextNote} onChange={(e) => setEditNextNote(e.target.value)} />
                </label>

                {/* History add */}
                <div className="border rounded-xl p-3 bg-gray-50">
                  <div className="font-semibold mb-2 text-gray-900">対応履歴を追加</div>

                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    <div className="text-sm text-gray-700">種類：</div>

                    <label className="flex items-center gap-1 text-sm text-gray-800">
                      <input type="radio" name="histType" checked={histType === "email"} onChange={() => setHistType("email")} />
                      📧 メール
                    </label>

                    <label className="flex items-center gap-1 text-sm text-gray-800">
                      <input type="radio" name="histType" checked={histType === "phone"} onChange={() => setHistType("phone")} />
                      📞 電話
                    </label>

                    <label className="flex items-center gap-1 text-sm text-gray-800">
                      <input type="radio" name="histType" checked={histType === "other"} onChange={() => setHistType("other")} />
                      📝 その他
                    </label>
                  </div>

                  {/* NEW: 実施日時 */}
                  <div className="mb-2">
                    <div className="text-sm text-gray-700 mb-1">実施日時（任意）</div>
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        className={`${inputBase} w-[160px]`}
                        placeholder="日付 2026/02/03 / 20260203"
                        value={histAtDate}
                        onChange={(e) => setHistAtDate(normalizeDateInputDisplay(e.target.value))}
                      />
                      <input
                        type="text"
                        inputMode="numeric"
                        className={`${inputBase} w-[140px]`}
                        placeholder="時刻 16:45 / 1645"
                        value={histAtTime}
                        onChange={(e) => setHistAtTime(normalizeTimeInputDisplay(e.target.value))}
                      />
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      未入力なら「今の時刻」で登録。プレビュー: {formatIsoToYmdHm(buildHistoryAtIso(histAtDate, histAtTime))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input className={`${inputBase}`} value={histSubject} onChange={(e) => setHistSubject(e.target.value)} placeholder="件名（全タイプ共通）" />
                    <button onClick={addHistory} className="bg-blue-600 text-white px-4 py-3 rounded-xl font-semibold active:scale-[0.99]" >
                      追加
                    </button>
                  </div>

                  <textarea className={`mt-2 w-full ${inputBase} min-h-[90px]`} value={histNote} onChange={(e) => setHistNote(e.target.value)} placeholder="本文（例: 3/1 11:00 振込確認。未着のため再連絡予定。)" />
                  <div className="text-xs text-gray-600 mt-1">※「件名」か「本文」のどちらかが入っていれば追加できます</div>
                </div>

                {/* History list */}
                <div className="border rounded-xl p-3 bg-white">
                  <div className="font-semibold mb-2 text-gray-900">対応履歴</div>

                  <div className="flex flex-col max-h-[320px]">
                    {editingTask.history.length === 0 ? (
                      <div className="text-sm text-gray-600">まだ履歴がありません</div>
                    ) : (
                      <ul className="space-y-2 overflow-y-auto pr-1">
                        {[...editingTask.history]
                          .slice()
                          .reverse()
                          .map((h) => {
                            const isDeleted = !!h.deletedAt;
                            const isEditing = historyEditingId === h.id;
                            const remaining = h.deletedAt ? remainingMsUntilHardDelete(h.deletedAt) : 0;

                            return (
                              <li key={h.id} className={`border rounded-xl p-3 ${isDeleted ? "opacity-70 bg-gray-50" : "bg-white"}`}>
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <div className="text-xs text-gray-600">
                                      {formatIsoToYmdHm(h.at)}{" "}
                                      {isDeleted && h.deletedAt ? (
                                        <span className="ml-2 text-red-700">削除済み（あと{formatRemaining(remaining)}で完全削除）</span>
                                      ) : null}
                                    </div>

                                    {!isEditing ? (
                                      <>
                                        <div className="text-sm font-semibold truncate text-gray-900">
                                          {typeIcon(h.type)} {h.subject || "（件名なし）"}
                                        </div>
                                        <div className="text-sm whitespace-pre-wrap text-gray-800">{h.note || "（本文なし）"}</div>
                                      </>
                                    ) : (
                                      <div className="mt-2 space-y-2">
                                        <div className="flex flex-wrap items-center gap-3">
                                          <div className="text-sm text-gray-700">種類：</div>
                                          <label className="flex items-center gap-1 text-sm text-gray-800">
                                            <input type="radio" name={`editType-${h.id}`} checked={histEditType === "email"} onChange={() => setHistEditType("email")} />
                                            📧
                                          </label>
                                          <label className="flex items-center gap-1 text-sm text-gray-800">
                                            <input type="radio" name={`editType-${h.id}`} checked={histEditType === "phone"} onChange={() => setHistEditType("phone")} />
                                            📞
                                          </label>
                                          <label className="flex items-center gap-1 text-sm text-gray-800">
                                            <input type="radio" name={`editType-${h.id}`} checked={histEditType === "other"} onChange={() => setHistEditType("other")} />
                                            📝
                                          </label>
                                        </div>

                                        {/* NEW: 実施日時（編集） */}
                                        <div>
                                          <div className="text-sm text-gray-700 mb-1">実施日時</div>
                                          <div className="flex flex-wrap gap-2">
                                            <input
                                              type="text"
                                              inputMode="numeric"
                                              className={`${inputBase} w-[160px]`}
                                              placeholder="日付 2026/02/03 / 20260203"
                                              value={histEditAtDate}
                                              onChange={(e) => setHistEditAtDate(normalizeDateInputDisplay(e.target.value))}
                                            />
                                            <input
                                              type="text"
                                              inputMode="numeric"
                                              className={`${inputBase} w-[140px]`}
                                              placeholder="時刻 16:45 / 1645"
                                              value={histEditAtTime}
                                              onChange={(e) => setHistEditAtTime(normalizeTimeInputDisplay(e.target.value))}
                                            />
                                          </div>
                                          <div className="text-xs text-gray-600 mt-1">
                                            プレビュー: {formatIsoToYmdHm(buildHistoryAtIso(histEditAtDate, histEditAtTime))}
                                          </div>
                                        </div>

                                        <input className={`w-full ${inputBase}`} value={histEditSubject} onChange={(e) => setHistEditSubject(e.target.value)} placeholder="件名" />
                                        <textarea className={`w-full ${inputBase} min-h-[80px]`} value={histEditNote} onChange={(e) => setHistEditNote(e.target.value)} placeholder="本文" />
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

                <div className="text-xs text-gray-600">
                  作成: {formatIsoToYmdHm(editingTask.createdAt)} / 更新: {formatIsoToYmdHm(editingTask.updatedAt)}
                  {editingTask.state === "closed" && editingTask.closedAt ? ` / クローズ: ${formatIsoToYmdHm(editingTask.closedAt)}` : ""}
                </div>
              </div>
            </div>

            <div className="pt-4 mt-4 border-t flex items-center justify-between gap-2">
              <button onClick={() => deleteTask(editingTask.id)} className="text-red-700 hover:text-red-900 font-semibold">
                タスク削除
              </button>

              <div className="flex flex-wrap gap-2">
                {editingTask.state === "open" ? (
                  <button onClick={() => closeTask(editingTask.id)} className="border px-4 py-3 rounded-xl hover:bg-gray-50 text-gray-800">
                    クローズ
                  </button>
                ) : (
                  <button onClick={() => reopenTask(editingTask.id)} className="border px-4 py-3 rounded-xl hover:bg-gray-50 text-gray-800">
                    再オープン
                  </button>
                )}

                <button onClick={() => setEditingId(null)} className="border px-4 py-3 rounded-xl text-gray-800">
                  閉じる
                </button>

                <button onClick={saveTaskEdits} className="bg-blue-600 text-white px-5 py-3 rounded-xl font-semibold disabled:opacity-50" disabled={editText.trim() === ""}>
                  保存
                </button>
              </div>
            </div>

            {editText.trim() === "" && <div className="text-sm text-red-700 mt-2">※タスク名が空だと保存できません</div>}
          </div>
        </div>
      )}
    </div>
  );
}