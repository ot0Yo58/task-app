"use client";

import React, { useEffect, useMemo, useState } from "react";

type HistoryType = "email" | "phone" | "other";

type HistoryEntry = {
  id: string;
  type: HistoryType;
  subject: string;
  note: string;
  at: string;
  deletedAt?: string;
};

type TaskState = "open" | "closed";

type Task = {
  id: number;
  text: string;
  dueDate: string;
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

function normalizeDateInputDisplay(v: string) {
  const s = v.trim();
  const digits = s.replace(/\D/g, "");

  if (digits.length === 8) {
    return `${digits.slice(0, 4)}/${digits.slice(4, 6)}/${digits.slice(6, 8)}`;
  }

  return s;
}

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

function combineDateTimeLocalFromText(dateRaw: string, timeRaw: string) {
  const d = normalizeDateForStorage(dateRaw);
  const t = normalizeTimeForStorage(timeRaw);

  if (!dateRaw.trim() && !timeRaw.trim()) return "";
  if (!isValidDateYYYYMMDDOrSlash(d) || !isValidTimeHHmm(t)) return "";

  return `${d}T${t}`;
}

function splitDateTimeLocalToText(value: string) {
  if (!value) return { date: "", time: "" };

  const localMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);

  if (localMatch) {
    const [, yyyy, mm, dd, hh, mi] = localMatch;

    return {
      date: `${yyyy}/${mm}/${dd}`,
      time: `${hh}:${mi}`,
    };
  }

  const parsed = new Date(value);

  if (!Number.isNaN(parsed.getTime())) {
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, "0");
    const dd = String(parsed.getDate()).padStart(2, "0");
    const hh = String(parsed.getHours()).padStart(2, "0");
    const mi = String(parsed.getMinutes()).padStart(2, "0");

    return {
      date: `${yyyy}/${mm}/${dd}`,
      time: `${hh}:${mi}`,
    };
  }

  const [date, time] = value.split("T");

  return {
    date: (date ?? "").replace(/-/g, "/"),
    time: time ?? "",
  };
}

function nowIso() {
  return new Date().toISOString();
}

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

  return new Date(y, m - 1, dd, hh, mm, 0, 0).toISOString();
}

function isObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object";
}

function parseDueToMs(dueDate: string): number | null {
  if (!dueDate) return null;

  const localMatch = dueDate.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);

  if (localMatch) {
    const [, y, m, d, hh, mm] = localMatch.map(String);

    return new Date(
      Number(y),
      Number(m) - 1,
      Number(d),
      Number(hh),
      Number(mm),
      0,
      0,
    ).getTime();
  }

  const parsed = new Date(dueDate);

  if (!Number.isNaN(parsed.getTime())) {
    return parsed.getTime();
  }

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
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function typeIcon(t: HistoryType) {
  if (t === "email") return "✉️";
  if (t === "phone") return "📞";
  return "📝";
}

function formatDateTimeLocal(value: string) {
  if (!value) return "未設定";

  const localMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);

  if (localMatch) {
    const [, yyyy, mm, dd, hh, mi] = localMatch;
    return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
  }

  const slashMatch = value.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/);

  if (slashMatch) {
    const [, yyyy, mm, dd, hh, mi] = slashMatch;
    return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
  }

  const parsed = new Date(value);

  if (!Number.isNaN(parsed.getTime())) {
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, "0");
    const dd = String(parsed.getDate()).padStart(2, "0");
    const hh = String(parsed.getHours()).padStart(2, "0");
    const mi = String(parsed.getMinutes()).padStart(2, "0");

    return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
  }

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

      return {
        id,
        type,
        subject,
        note,
        at,
        deletedAt,
      };
    });
}

function normalizeTasks(raw: unknown): Task[] {
  if (!Array.isArray(raw)) return [];

  const tasks: Task[] = [];

  for (const item of raw) {
    if (!isObject(item)) continue;

    const rawId = item.id;
    const id =
      typeof rawId === "number"
        ? rawId
        : typeof rawId === "string" && rawId.trim() !== "" && Number.isFinite(Number(rawId))
          ? Number(rawId)
          : Date.now() + Math.floor(Math.random() * 100000);

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
      id,
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

async function fetchRemoteTasks(): Promise<Task[]> {
  const res = await fetch("/api/tasks", {
    method: "GET",
    cache: "no-store",
  });

  const data = await res.json();

  if (!data.ok) {
    throw new Error(data.error || "タスク取得に失敗しました");
  }

  return normalizeTasks(data.tasks);
}

async function syncRemoteTasks(tasks: Task[]) {
  const res = await fetch("/api/tasks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "sync",
      tasks,
    }),
  });

  const data = await res.json();

  if (!data.ok) {
    throw new Error(data.error || "タスク同期に失敗しました");
  }

  return data;
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

    return {
      ...t,
      history: nextHistory,
    };
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

    map.set(inc.id, {
      ...newer,
      history: mergedHistory,
    });
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
  const [hydrated, setHydrated] = useState(false);
  const [syncStatus, setSyncStatus] = useState("未同期");

  const [showCreate, setShowCreate] = useState(false);

  const [newText, setNewText] = useState("");
  const [newStatus, setNewStatus] = useState("");
  const [newNextNote, setNewNextNote] = useState("");
  const [newDueDateText, setNewDueDateText] = useState("");
  const [newDueTimeText, setNewDueTimeText] = useState("");

  const [editingId, setEditingId] = useState<number | null>(null);
  const editingTask = useMemo(() => tasks.find((t) => t.id === editingId) ?? null, [tasks, editingId]);

  const [editText, setEditText] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editNextNote, setEditNextNote] = useState("");
  const [editDueDateText, setEditDueDateText] = useState("");
  const [editDueTimeText, setEditDueTimeText] = useState("");

  const [histType, setHistType] = useState<HistoryType>("email");
  const [histSubject, setHistSubject] = useState("");
  const [histNote, setHistNote] = useState("");
  const [histAtDate, setHistAtDate] = useState("");
  const [histAtTime, setHistAtTime] = useState("");

  const [historyEditingId, setHistoryEditingId] = useState<string | null>(null);
  const [histEditType, setHistEditType] = useState<HistoryType>("email");
  const [histEditSubject, setHistEditSubject] = useState("");
  const [histEditNote, setHistEditNote] = useState("");
  const [histEditAtDate, setHistEditAtDate] = useState("");
  const [histEditAtTime, setHistEditAtTime] = useState("");

  const [showBackup, setShowBackup] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [backupJson, setBackupJson] = useState("");
  const [restoreJson, setRestoreJson] = useState("");
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const inputBase =
    "border border-indigo-200 p-3 rounded-xl text-slate-900 placeholder:text-slate-400 bg-white/95 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 shadow-sm";

  const labelText = "text-sm text-indigo-950 font-semibold mb-1";

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const local = cleanup(loadTasks());

      if (!cancelled) {
        setTasks(local);
        setSyncStatus("ローカル読込済み");
      }

      try {
        const remote = cleanup(await fetchRemoteTasks());
        const merged = cleanup(mergeTasks(local, remote));

        if (!cancelled) {
          setTasks(merged);
          saveTasks(merged);
          setSyncStatus("同期済み");
        }

        await syncRemoteTasks(merged);
      } catch (error) {
        console.error(error);

        if (!cancelled) {
          setSyncStatus("同期失敗：ローカル保存で継続");
        }
      } finally {
        if (!cancelled) {
          setHydrated(true);
        }
      }
    }

    boot();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    saveTasks(tasks);
    setSyncStatus("同期中...");

    const id = window.setTimeout(async () => {
      try {
        await syncRemoteTasks(tasks);
        setSyncStatus("同期済み");
      } catch (error) {
        console.error(error);
        setSyncStatus("同期失敗：ローカル保存済み");
      }
    }, 700);

    return () => window.clearTimeout(id);
  }, [tasks, hydrated]);

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
  }, [editingTask]);

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

      const aMs = parseDueToMs(a.dueDate);
      const bMs = parseDueToMs(b.dueDate);

      if (aMs !== null && bMs !== null) return aMs - bMs || b.id - a.id;

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
    setTasks((prev) =>
      prev.map((t) =>
        t.id !== id
          ? t
          : {
              ...t,
              ...patch,
              updatedAt: nowIso(),
            },
      ),
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
      }),
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
      }),
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
      prev.map((t) =>
        t.id !== editingTask.id
          ? t
          : {
              ...t,
              updatedAt: nowIso(),
              history: [...t.history, entry],
            },
      ),
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

        return {
          ...t,
          updatedAt: nowIso(),
          history: nextHistory,
        };
      }),
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

        return {
          ...t,
          updatedAt: iso,
          history: nextHistory,
        };
      }),
    );

    if (historyEditingId === entryId) cancelEditHistory();
  }

  function restoreHistory(entryId: string) {
    if (!editingTask) return;

    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== editingTask.id) return t;

        const nextHistory = t.history.map((h) =>
          h.id !== entryId || !h.deletedAt
            ? h
            : {
                ...h,
                deletedAt: undefined,
              },
        );

        return {
          ...t,
          updatedAt: nowIso(),
          history: nextHistory,
        };
      }),
    );
  }

  function openBackup() {
    const json = JSON.stringify(tasks, null, 2);

    setBackupJson(json);
    setShowBackup(true);
  }

  async function copyBackup() {
    const ok = await copyToClipboard(backupJson);

    setToast(ok ? "コピーしました" : "コピーに失敗しました");
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
        setRestoreError("取り込めるタスクが見つかりませんでした。");
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
    const base =
      "w-full text-left border p-4 rounded-2xl transition shadow-sm hover:shadow-lg active:scale-[0.995]";

    if (task.state !== "open") {
      return `${base} border-slate-200 bg-white/90 hover:bg-indigo-50`;
    }

    const tone = taskRowTone(task);

    if (tone === "overdue") {
      return `${base} border-red-300 bg-red-50 hover:bg-red-100`;
    }

    if (tone === "soon") {
      return `${base} border-yellow-300 bg-yellow-50 hover:bg-yellow-100`;
    }

    return `${base} border-indigo-100 bg-white/95 hover:bg-indigo-50`;
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#312e81,_#0f172a_45%,_#020617)] text-slate-900">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <header className="mb-6 rounded-3xl border border-white/10 bg-white/10 p-5 shadow-2xl backdrop-blur">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-2 text-sm font-semibold tracking-[0.3em] text-indigo-200">TASK CONTROL</p>
              <h1 className="text-3xl font-black text-white sm:text-4xl">タスク管理</h1>
              <p className="mt-2 text-sm text-indigo-100">
                次回対応・履歴・バックアップをまとめて管理する藍色ベースのタスクアプリ
              </p>
              <p className="mt-2 inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-bold text-indigo-100">
                同期状態：{syncStatus}
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                onClick={openCreate}
                className="rounded-2xl bg-indigo-500 px-5 py-3 font-bold text-white shadow-lg shadow-indigo-950/40 transition hover:bg-indigo-400 active:scale-[0.98]"
              >
                ＋ 新規作成
              </button>
              <button
                onClick={openBackup}
                className="rounded-2xl border border-indigo-200/40 bg-white/10 px-5 py-3 font-semibold text-white transition hover:bg-white/20"
              >
                バックアップ
              </button>
              <button
                onClick={openRestore}
                className="rounded-2xl border border-indigo-200/40 bg-white/10 px-5 py-3 font-semibold text-white transition hover:bg-white/20"
              >
                復元
              </button>
            </div>
          </div>
        </header>

        <section className="rounded-3xl border border-indigo-100 bg-indigo-50/95 p-4 shadow-2xl sm:p-5">
          <div className="mb-4 grid grid-cols-2 gap-3">
            <button
              onClick={() => setTab("open")}
              className={`rounded-2xl border px-4 py-3 text-sm font-bold transition sm:text-base ${
                tab === "open"
                  ? "border-indigo-700 bg-indigo-700 text-white shadow-lg shadow-indigo-900/20"
                  : "border-indigo-200 bg-white text-indigo-950 hover:bg-indigo-100"
              }`}
            >
              進行中（{openTasksSorted.length}）
            </button>

            <button
              onClick={() => setTab("closed")}
              className={`rounded-2xl border px-4 py-3 text-sm font-bold transition sm:text-base ${
                tab === "closed"
                  ? "border-indigo-700 bg-indigo-700 text-white shadow-lg shadow-indigo-900/20"
                  : "border-indigo-200 bg-white text-indigo-950 hover:bg-indigo-100"
              }`}
            >
              クローズ済み（{closedTasksSorted.length}）
            </button>
          </div>

          <div className="space-y-3">
            {list.map((task) => (
              <button key={task.id} onClick={() => setEditingId(task.id)} className={rowClass(task)}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="truncate text-lg font-black text-indigo-950">{task.text}</div>
                    <div className="mt-1 text-sm text-slate-700">次回対応：{formatDateTimeLocal(task.dueDate)}</div>
                    <div className="text-sm text-slate-700">ステータス：{task.status || "未設定"}</div>
                    <div className="text-sm text-slate-700">
                      経緯：{task.history.filter((h) => !h.deletedAt).length}件
                    </div>
                  </div>

                  <div className="shrink-0 rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-800">
                    {task.state === "open" ? "OPEN" : "CLOSED"}
                  </div>
                </div>

                {task.nextNote?.trim() ? (
                  <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-sm text-indigo-950">
                    <span className="font-bold">次回活動補足：</span>
                    {task.nextNote}
                  </div>
                ) : null}
              </button>
            ))}

            {list.length === 0 && (
              <div className="rounded-2xl border border-dashed border-indigo-300 bg-white/70 p-8 text-center text-indigo-950">
                {tab === "open" ? "進行中タスクがありません" : "クローズ済みタスクがありません"}
              </div>
            )}
          </div>
        </section>

        {toast && (
          <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-indigo-950 px-5 py-3 text-sm font-bold text-white shadow-2xl">
            {toast}
          </div>
        )}

        {showCreate && (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm sm:p-4"
            onClick={() => setShowCreate(false)}
          >
            <div
              className="w-full max-w-2xl rounded-3xl border border-indigo-100 bg-indigo-50 p-4 shadow-2xl sm:p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-2xl font-black text-indigo-950">新規タスク作成</h2>
                <button onClick={() => setShowCreate(false)} className="text-2xl font-bold text-indigo-900">
                  ✕
                </button>
              </div>

              <div className="space-y-3">
                <label className="block">
                  <div className={labelText}>タスク名</div>
                  <input
                    className={`w-full ${inputBase}`}
                    value={newText}
                    onChange={(e) => setNewText(e.target.value)}
                    placeholder="タスクを入力"
                  />
                </label>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="block">
                    <div className={labelText}>次回対応日時</div>
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        className={`${inputBase} w-[160px]`}
                        placeholder="2026/02/03"
                        value={newDueDateText}
                        onChange={(e) => setNewDueDateText(normalizeDateInputDisplay(e.target.value))}
                      />
                      <input
                        type="text"
                        inputMode="numeric"
                        className={`${inputBase} w-[130px]`}
                        placeholder="16:45"
                        value={newDueTimeText}
                        onChange={(e) => setNewDueTimeText(normalizeTimeInputDisplay(e.target.value))}
                      />
                    </div>
                    <div className="mt-1 text-xs text-indigo-700">
                      表示プレビュー：{formatDateTimeLocal(combineDateTimeLocalFromText(newDueDateText, newDueTimeText))}
                    </div>
                  </label>

                  <label className="block">
                    <div className={labelText}>ステータス</div>
                    <input
                      className={`w-full ${inputBase}`}
                      value={newStatus}
                      onChange={(e) => setNewStatus(e.target.value)}
                      placeholder="例：対応中 / 保留 / 確認待ち"
                    />
                  </label>
                </div>

                <label className="block">
                  <div className={labelText}>次回活動補足</div>
                  <textarea
                    className={`w-full ${inputBase} min-h-[120px]`}
                    rows={5}
                    value={newNextNote}
                    onChange={(e) => setNewNextNote(e.target.value)}
                    placeholder="次回の作業メモ / 確認事項 / 注意点など"
                  />
                </label>
              </div>

              <div className="mt-5 flex flex-col gap-2 border-t border-indigo-200 pt-4 sm:flex-row sm:justify-end">
                <button
                  onClick={() => setShowCreate(false)}
                  className="rounded-2xl border border-indigo-200 bg-white px-5 py-3 font-semibold text-indigo-950"
                >
                  キャンセル
                </button>
                <button
                  onClick={addTask}
                  disabled={newText.trim() === ""}
                  className="rounded-2xl bg-indigo-700 px-5 py-3 font-bold text-white shadow-lg shadow-indigo-900/20 disabled:opacity-50"
                >
                  追加
                </button>
              </div>

              {newText.trim() === "" && <div className="mt-2 text-sm text-red-700">※タスク名は必須です</div>}
            </div>
          </div>
        )}

        {showBackup && (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm sm:p-4"
            onClick={() => setShowBackup(false)}
          >
            <div
              className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-indigo-100 bg-indigo-50 p-4 shadow-2xl sm:p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="text-xl font-black text-indigo-950">バックアップ（JSON）</div>
                <button onClick={() => setShowBackup(false)} className="text-2xl font-bold text-indigo-900">
                  ✕
                </button>
              </div>

              <div className="mb-2 text-sm text-indigo-900">
                このJSONをコピーして、別端末側の「復元」に貼り付けると取り込めます。
              </div>

              <textarea
                className="min-h-[360px] w-full flex-1 rounded-2xl border border-indigo-200 bg-white p-3 font-mono text-xs text-slate-900"
                value={backupJson}
                readOnly
              />

              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button onClick={copyBackup} className="rounded-2xl bg-indigo-700 px-4 py-3 font-bold text-white">
                  JSONをコピー
                </button>
                <button
                  onClick={() => setShowBackup(false)}
                  className="rounded-2xl border border-indigo-200 bg-white px-4 py-3 font-semibold text-indigo-950"
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        )}

        {showRestore && (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm sm:p-4"
            onClick={() => setShowRestore(false)}
          >
            <div
              className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-indigo-100 bg-indigo-50 p-4 shadow-2xl sm:p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="text-xl font-black text-indigo-950">復元（JSON貼り付け）</div>
                <button onClick={() => setShowRestore(false)} className="text-2xl font-bold text-indigo-900">
                  ✕
                </button>
              </div>

              <div className="mb-2 text-sm text-indigo-900">
                バックアップJSONをここに貼り付けてください。既存データとマージします。
              </div>

              <textarea
                className="min-h-[360px] w-full flex-1 rounded-2xl border border-indigo-200 bg-white p-3 font-mono text-xs text-slate-900"
                value={restoreJson}
                onChange={(e) => setRestoreJson(e.target.value)}
                placeholder="ここにJSONを貼り付け..."
              />

              {restoreError && <div className="mt-2 text-sm font-semibold text-red-700">{restoreError}</div>}

              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button onClick={doRestoreMerge} className="rounded-2xl bg-indigo-700 px-4 py-3 font-bold text-white">
                  取り込む
                </button>
                <button
                  onClick={() => setShowRestore(false)}
                  className="rounded-2xl border border-indigo-200 bg-white px-4 py-3 font-semibold text-indigo-950"
                >
                  キャンセル
                </button>
              </div>

              <div className="mt-2 text-xs text-indigo-800">
                ※ 同じIDのタスクは更新日時が新しい方を優先し、履歴は結合します。
              </div>
            </div>
          </div>
        )}

        {editingTask && (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-slate-950/70 p-3 backdrop-blur-sm sm:p-4"
            onClick={() => setEditingId(null)}
          >
            <div
              className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-indigo-100 bg-indigo-50 p-4 text-slate-900 shadow-2xl sm:p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-2xl font-black text-indigo-950">タスク詳細</h2>
                <button onClick={() => setEditingId(null)} className="text-2xl font-bold text-indigo-900">
                  ✕
                </button>
              </div>

              <div className="flex-1 overflow-y-auto pr-1">
                <div className="space-y-3">
                  <label className="block">
                    <div className={labelText}>タスク名</div>
                    <input className={`w-full ${inputBase}`} value={editText} onChange={(e) => setEditText(e.target.value)} />
                  </label>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <label className="block">
                      <div className={labelText}>次回対応日時</div>
                      <div className="flex flex-wrap gap-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          className={`${inputBase} w-[160px]`}
                          placeholder="2026/02/03"
                          value={editDueDateText}
                          onChange={(e) => setEditDueDateText(normalizeDateInputDisplay(e.target.value))}
                        />
                        <input
                          type="text"
                          inputMode="numeric"
                          className={`${inputBase} w-[130px]`}
                          placeholder="16:45"
                          value={editDueTimeText}
                          onChange={(e) => setEditDueTimeText(normalizeTimeInputDisplay(e.target.value))}
                        />
                      </div>
                      <div className="mt-1 text-xs text-indigo-700">
                        表示プレビュー：{formatDateTimeLocal(combineDateTimeLocalFromText(editDueDateText, editDueTimeText))}
                      </div>
                    </label>

                    <label className="block">
                      <div className={labelText}>ステータス</div>
                      <input className={`w-full ${inputBase}`} value={editStatus} onChange={(e) => setEditStatus(e.target.value)} />
                    </label>
                  </div>

                  <label className="block">
                    <div className={labelText}>次回活動補足</div>
                    <textarea
                      className={`w-full ${inputBase} min-h-[130px]`}
                      rows={5}
                      value={editNextNote}
                      onChange={(e) => setEditNextNote(e.target.value)}
                    />
                  </label>

                  <div className="rounded-2xl border border-indigo-200 bg-white/80 p-3">
                    <div className="mb-2 font-black text-indigo-950">対応履歴を追加</div>

                    <div className="mb-2 flex flex-wrap items-center gap-3">
                      <div className="text-sm font-semibold text-indigo-900">種類：</div>
                      <label className="flex items-center gap-1 text-sm text-indigo-950">
                        <input type="radio" name="histType" checked={histType === "email"} onChange={() => setHistType("email")} />
                        メール
                      </label>
                      <label className="flex items-center gap-1 text-sm text-indigo-950">
                        <input type="radio" name="histType" checked={histType === "phone"} onChange={() => setHistType("phone")} />
                        電話
                      </label>
                      <label className="flex items-center gap-1 text-sm text-indigo-950">
                        <input type="radio" name="histType" checked={histType === "other"} onChange={() => setHistType("other")} />
                        その他
                      </label>
                    </div>

                    <div className="mb-2">
                      <div className={labelText}>実施日時（任意）</div>
                      <div className="flex flex-wrap gap-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          className={`${inputBase} w-[160px]`}
                          placeholder="2026/02/03"
                          value={histAtDate}
                          onChange={(e) => setHistAtDate(normalizeDateInputDisplay(e.target.value))}
                        />
                        <input
                          type="text"
                          inputMode="numeric"
                          className={`${inputBase} w-[130px]`}
                          placeholder="16:45"
                          value={histAtTime}
                          onChange={(e) => setHistAtTime(normalizeTimeInputDisplay(e.target.value))}
                        />
                      </div>
                      <div className="mt-1 text-xs text-indigo-700">
                        未入力なら今の時刻で登録。プレビュー：{formatIsoToYmdHm(buildHistoryAtIso(histAtDate, histAtTime))}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      <input
                        className={inputBase}
                        value={histSubject}
                        onChange={(e) => setHistSubject(e.target.value)}
                        placeholder="件名"
                      />
                      <button onClick={addHistory} className="rounded-2xl bg-indigo-700 px-4 py-3 font-bold text-white">
                        追加
                      </button>
                    </div>

                    <textarea
                      className={`mt-2 w-full ${inputBase} min-h-[90px]`}
                      value={histNote}
                      onChange={(e) => setHistNote(e.target.value)}
                      placeholder="本文"
                    />

                    <div className="mt-1 text-xs text-indigo-700">※ 件名か本文のどちらかが入っていれば追加できます</div>
                  </div>

                  <div className="rounded-2xl border border-indigo-200 bg-white p-3">
                    <div className="mb-2 font-black text-indigo-950">対応履歴</div>

                    <div className="flex max-h-[320px] flex-col">
                      {editingTask.history.length === 0 ? (
                        <div className="text-sm text-indigo-700">まだ履歴がありません</div>
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
                                <li
                                  key={h.id}
                                  className={`rounded-2xl border p-3 ${
                                    isDeleted
                                      ? "border-slate-200 bg-slate-50 opacity-70"
                                      : "border-indigo-100 bg-indigo-50/60"
                                  }`}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      <div className="text-xs text-indigo-700">
                                        {formatIsoToYmdHm(h.at)}
                                        {isDeleted && h.deletedAt ? (
                                          <span className="ml-2 text-red-700">
                                            削除済み（あと{formatRemaining(remaining)}で完全削除）
                                          </span>
                                        ) : null}
                                      </div>

                                      {!isEditing ? (
                                        <>
                                          <div className="truncate text-sm font-black text-indigo-950">
                                            {typeIcon(h.type)} {h.subject || "（件名なし）"}
                                          </div>
                                          <div className="whitespace-pre-wrap text-sm text-slate-800">{h.note || "（本文なし）"}</div>
                                        </>
                                      ) : (
                                        <div className="mt-2 space-y-2">
                                          <div className="flex flex-wrap items-center gap-3">
                                            <div className="text-sm font-semibold text-indigo-900">種類：</div>
                                            <label className="flex items-center gap-1 text-sm text-indigo-950">
                                              <input
                                                type="radio"
                                                name={`editType-${h.id}`}
                                                checked={histEditType === "email"}
                                                onChange={() => setHistEditType("email")}
                                              />
                                              メール
                                            </label>
                                            <label className="flex items-center gap-1 text-sm text-indigo-950">
                                              <input
                                                type="radio"
                                                name={`editType-${h.id}`}
                                                checked={histEditType === "phone"}
                                                onChange={() => setHistEditType("phone")}
                                              />
                                              電話
                                            </label>
                                            <label className="flex items-center gap-1 text-sm text-indigo-950">
                                              <input
                                                type="radio"
                                                name={`editType-${h.id}`}
                                                checked={histEditType === "other"}
                                                onChange={() => setHistEditType("other")}
                                              />
                                              その他
                                            </label>
                                          </div>

                                          <div>
                                            <div className={labelText}>実施日時</div>
                                            <div className="flex flex-wrap gap-2">
                                              <input
                                                type="text"
                                                inputMode="numeric"
                                                className={`${inputBase} w-[160px]`}
                                                placeholder="2026/02/03"
                                                value={histEditAtDate}
                                                onChange={(e) => setHistEditAtDate(normalizeDateInputDisplay(e.target.value))}
                                              />
                                              <input
                                                type="text"
                                                inputMode="numeric"
                                                className={`${inputBase} w-[130px]`}
                                                placeholder="16:45"
                                                value={histEditAtTime}
                                                onChange={(e) => setHistEditAtTime(normalizeTimeInputDisplay(e.target.value))}
                                              />
                                            </div>
                                            <div className="mt-1 text-xs text-indigo-700">
                                              プレビュー：{formatIsoToYmdHm(buildHistoryAtIso(histEditAtDate, histEditAtTime))}
                                            </div>
                                          </div>

                                          <input
                                            className={`w-full ${inputBase}`}
                                            value={histEditSubject}
                                            onChange={(e) => setHistEditSubject(e.target.value)}
                                            placeholder="件名"
                                          />

                                          <textarea
                                            className={`w-full ${inputBase} min-h-[80px]`}
                                            value={histEditNote}
                                            onChange={(e) => setHistEditNote(e.target.value)}
                                            placeholder="本文"
                                          />
                                        </div>
                                      )}
                                    </div>

                                    <div className="flex shrink-0 flex-col gap-2">
                                      {!isDeleted ? (
                                        <>
                                          {!isEditing ? (
                                            <button
                                              onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                beginEditHistory(h);
                                              }}
                                              className="rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm font-semibold text-indigo-950 hover:bg-indigo-50"
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
                                                className="rounded-xl bg-indigo-700 px-3 py-2 text-sm font-bold text-white"
                                              >
                                                保存
                                              </button>
                                              <button
                                                onClick={(e) => {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  cancelEditHistory();
                                                }}
                                                className="rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm font-semibold text-indigo-950"
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
                                            className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
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
                                          className="rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm font-semibold text-indigo-950 hover:bg-indigo-50"
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

                  <div className="text-xs text-indigo-800">
                    作成：{formatIsoToYmdHm(editingTask.createdAt)} / 更新：{formatIsoToYmdHm(editingTask.updatedAt)}
                    {editingTask.state === "closed" && editingTask.closedAt
                      ? ` / クローズ：${formatIsoToYmdHm(editingTask.closedAt)}`
                      : ""}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-3 border-t border-indigo-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <button onClick={() => deleteTask(editingTask.id)} className="font-bold text-red-700 hover:text-red-900">
                  タスク削除
                </button>

                <div className="flex flex-wrap gap-2">
                  {editingTask.state === "open" ? (
                    <button
                      onClick={() => closeTask(editingTask.id)}
                      className="rounded-2xl border border-indigo-200 bg-white px-4 py-3 font-semibold text-indigo-950 hover:bg-indigo-50"
                    >
                      クローズ
                    </button>
                  ) : (
                    <button
                      onClick={() => reopenTask(editingTask.id)}
                      className="rounded-2xl border border-indigo-200 bg-white px-4 py-3 font-semibold text-indigo-950 hover:bg-indigo-50"
                    >
                      再オープン
                    </button>
                  )}

                  <button
                    onClick={() => setEditingId(null)}
                    className="rounded-2xl border border-indigo-200 bg-white px-4 py-3 font-semibold text-indigo-950"
                  >
                    閉じる
                  </button>

                  <button
                    onClick={saveTaskEdits}
                    disabled={editText.trim() === ""}
                    className="rounded-2xl bg-indigo-700 px-5 py-3 font-bold text-white shadow-lg shadow-indigo-900/20 disabled:opacity-50"
                  >
                    保存
                  </button>
                </div>
              </div>

              {editText.trim() === "" && <div className="mt-2 text-sm text-red-700">※タスク名が空だと保存できません</div>}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}