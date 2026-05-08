import os
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent

PROFILE_PATH = BASE_DIR / "profile.md"
MEMORY_PATH = BASE_DIR / "memory.md"

load_dotenv(BASE_DIR / ".env")

GAS_URL = os.getenv("GAS_URL")
GAS_TOKEN = os.getenv("GAS_TOKEN")

OLLAMA_URL = "http://localhost:11434/api/generate"

NORMAL_MODEL = os.getenv("OLLAMA_NORMAL_MODEL", "qwen2.5:3b")
DEEP_MODEL = os.getenv("OLLAMA_DEEP_MODEL", "qwen3:8b")

POLL_SECONDS = 5


def read_text_file(path: Path, default_text: str = "") -> str:
    if not path.exists():
        return default_text

    return path.read_text(encoding="utf-8")


def load_profile() -> str:
    return read_text_file(
        PROFILE_PATH,
        "profile.md が見つかりません。固定プロフィールは未設定です。",
    )


def load_memory() -> str:
    return read_text_file(
        MEMORY_PATH,
        "memory.md が見つかりません。長期記憶は未設定です。",
    )


def gas_get(action: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    if not GAS_URL or not GAS_TOKEN:
        raise RuntimeError("GAS_URL または GAS_TOKEN が .env に設定されていません。")

    query = {
        "action": action,
        "token": GAS_TOKEN,
    }

    if params:
        query.update(params)

    res = requests.get(GAS_URL, params=query, timeout=30)
    res.raise_for_status()

    data = res.json()

    if not data.get("ok"):
        raise RuntimeError(f"GAS APIエラー: {data}")

    return data


def gas_post(body: dict[str, Any]) -> dict[str, Any]:
    if not GAS_URL or not GAS_TOKEN:
        raise RuntimeError("GAS_URL または GAS_TOKEN が .env に設定されていません。")

    payload = {
        **body,
        "token": GAS_TOKEN,
    }

    res = requests.post(
        GAS_URL,
        headers={"Content-Type": "text/plain;charset=utf-8"},
        json=payload,
        timeout=30,
    )

    res.raise_for_status()

    data = res.json()

    if not data.get("ok"):
        raise RuntimeError(f"GAS APIエラー: {data}")

    return data


def fetch_tasks() -> list[dict[str, Any]]:
    data = gas_get("list")
    tasks = data.get("tasks", [])

    if not isinstance(tasks, list):
        return []

    return tasks


def fetch_pending_messages() -> list[dict[str, Any]]:
    data = gas_get("pendingAiMessages")
    messages = data.get("messages", [])

    if not isinstance(messages, list):
        return []

    return messages


def add_assistant_message(message: str) -> None:
    gas_post({
        "action": "addAiMessage",
        "role": "assistant",
        "message": message,
    })


def mark_processed(message_id: str) -> None:
    gas_post({
        "action": "markAiMessageProcessed",
        "id": message_id,
    })


def parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None

    try:
        if value.endswith("Z"):
            return datetime.fromisoformat(value.replace("Z", "+00:00"))

        return datetime.fromisoformat(value)
    except ValueError:
        return None


def task_sort_key(task: dict[str, Any]):
    due_dt = parse_dt(task.get("dueDate"))

    if due_dt is None:
        return (0, datetime.min)

    return (1, due_dt)


def latest_history_text(task: dict[str, Any]) -> str:
    history = task.get("history") or []

    if not isinstance(history, list) or not history:
        return "履歴なし"

    latest = history[-1]

    subject = latest.get("subject") or "件名なし"
    note = latest.get("note") or "本文なし"
    at = latest.get("at") or "日時不明"

    note_short = str(note).replace("\n", " ")[:100]

    return f"{at} / {subject} / {note_short}"


def build_task_text(tasks: list[dict[str, Any]], limit: int = 25) -> str:
    open_tasks = [task for task in tasks if task.get("state") == "open"]
    sorted_tasks = sorted(open_tasks, key=task_sort_key)
    target_tasks = sorted_tasks[:limit]

    lines = []

    for index, task in enumerate(target_tasks, start=1):
        text = task.get("text") or ""
        due_date = task.get("dueDate") or "未設定"
        status = task.get("status") or "未設定"
        next_note = task.get("nextNote") or ""
        latest_history = latest_history_text(task)

        lines.append(
            "\n".join(
                [
                    f"{index}. {text}",
                    f"   期限: {due_date}",
                    f"   状態: {status}",
                    f"   次回活動補足: {next_note}",
                    f"   最新履歴: {latest_history}",
                ]
            )
        )

    if not lines:
        return "進行中タスクはありません。"

    return "\n\n".join(lines)


def detect_mode(user_message: str) -> dict[str, str]:
    message = user_message.lower()

    deep_keywords = [
        "ディープモード",
        "deep",
        "深く考えて",
        "じっくり考えて",
        "思考モード",
        "推論モード",
        "深掘り",
        "深堀り",
        "設計方針",
        "分析して",
    ]

    normal_keywords = [
        "通常モード",
        "normal",
        "普通に考えて",
        "軽く考えて",
        "サクッと",
        "簡単に",
        "短く",
    ]

    for keyword in deep_keywords:
        if keyword.lower() in message:
            return {
                "label": "ディープモード",
                "model": DEEP_MODEL,
                "reason": f"「{keyword}」が含まれていたため",
            }

    for keyword in normal_keywords:
        if keyword.lower() in message:
            return {
                "label": "通常モード",
                "model": NORMAL_MODEL,
                "reason": f"「{keyword}」が含まれていたため",
            }

    return {
        "label": "通常モード",
        "model": NORMAL_MODEL,
        "reason": "明示的な指定がないため",
    }


def remove_think_tags(text: str) -> str:
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL | re.IGNORECASE)
    return text.strip()


def build_prompt(
    user_message: str,
    profile_text: str,
    memory_text: str,
    task_text: str,
    mode_info: dict[str, str],
) -> str:
    now = datetime.now().strftime("%Y-%m-%d %H:%M")

    return f"""
あなたは、豊晴さん専用のローカルAIタスク管理アシスタントです。
スマホWebアプリから送られたメッセージに返信してください。

# 現在日時

{now}

# 現在モード

{mode_info["label"]}

# 使用意図

{mode_info["reason"]}

# ユーザーからのメッセージ

{user_message}

# 固定プロフィール profile.md

{profile_text}

# 長期記憶 memory.md

{memory_text}

# 現在のタスク一覧

{task_text}

# 重要ルール

- 日本語で返答してください。
- 勝手にタスクを完了扱いにしないでください。
- 勝手にタスクを削除しないでください。
- タスク追加・編集・完了・削除が必要な場合は、まず提案だけしてください。
- 通常モードでは短く実用的に返してください。
- ディープモードでは理由や優先順位を少し深く整理してください。
- ただし、最終的な返答はスマホで読みやすい長さにしてください。
- 回答の最初に現在モードを明記してください。

# 返答形式

【現在モード】
{mode_info["label"]}

【回答】
ここに返答してください。

【次の一手】
具体的に1つだけ書いてください。
""".strip()


def ask_ollama(prompt: str, model: str) -> str:
    res = requests.post(
        OLLAMA_URL,
        json={
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.2,
            },
        },
        timeout=300,
    )

    res.raise_for_status()

    data = res.json()
    answer = data.get("response", "")

    return remove_think_tags(answer)


def process_message(message: dict[str, Any]) -> None:
    message_id = message.get("id")
    user_message = message.get("message") or ""

    if not message_id or not user_message:
        return

    print()
    print("======================================")
    print(f"新しいメッセージ: {message_id}")
    print(user_message)
    print("======================================")

    profile_text = load_profile()
    memory_text = load_memory()

    tasks = fetch_tasks()
    task_text = build_task_text(tasks, limit=25)

    mode_info = detect_mode(user_message)

    print(f"モード: {mode_info['label']}")
    print(f"モデル: {mode_info['model']}")
    print(f"理由: {mode_info['reason']}")
    print("Ollamaへ送信中...")

    prompt = build_prompt(
        user_message=user_message,
        profile_text=profile_text,
        memory_text=memory_text,
        task_text=task_text,
        mode_info=mode_info,
    )

    try:
        answer = ask_ollama(prompt, mode_info["model"])
    except Exception as error:
        answer = f"AI処理中にエラーが発生しました。\n\n{error}"

    add_assistant_message(answer)
    mark_processed(message_id)

    print("返信を書き戻しました。")


def main() -> None:
    print("AI Workerを起動しました。")
    print(f"通常モデル: {NORMAL_MODEL}")
    print(f"ディープモデル: {DEEP_MODEL}")
    print(f"監視間隔: {POLL_SECONDS}秒")
    print()
    print("停止するときは Ctrl + C")
    print()

    while True:
        try:
            pending = fetch_pending_messages()

            if pending:
                print(f"未処理メッセージ: {len(pending)}件")

            for message in pending:
                process_message(message)

            time.sleep(POLL_SECONDS)

        except KeyboardInterrupt:
            print()
            print("AI Workerを終了します。")
            break

        except Exception as error:
            print()
            print("エラーが発生しました。")
            print(error)
            print(f"{POLL_SECONDS}秒後に再試行します。")
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()