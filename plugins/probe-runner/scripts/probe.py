#!/usr/bin/env python3
"""Run a live check of Claude Code plugins in a fresh session inside tmux, then remove every trace.

The session starts in a new git repository under /private/tmp with only the given plugin directories
(`--setting-sources project`, so the person's own plugins and hooks stay out). Each step is typed into
the prompt once the previous one has finished. The report on stdout holds the pane's final text, the
session's transcript condensed, and what was deleted.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import tempfile
import time
from pathlib import Path

CONFIG = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")
PROJECTS = CONFIG / "projects"
STORE = CONFIG / "plugins" / "store"


def temp_base() -> Path:
    """Where the probe's repository goes: /private/tmp on macOS, the system temp directory elsewhere.

    The real path matters, because Claude Code names a transcript directory after the real path of the
    session's start directory.
    """
    mac = Path("/private/tmp")
    return mac if mac.is_dir() else Path(tempfile.gettempdir()).resolve()
TRUST_TEXT = "trust this folder"
BUSY_TEXT = "esc to interrupt"
MAX_TEXT = 600


def tmux(*args: str) -> str:
    return subprocess.run(["tmux", *args], capture_output=True, text=True, check=False).stdout


def capture(session: str, history: int = 0) -> str:
    args = ["capture-pane", "-p", "-t", session]
    if history > 0:
        args += ["-S", f"-{history}"]
    return tmux(*args)


def prompt_box(pane: str) -> str | None:
    """The text in the prompt box: the last `❯` line with a rule right under it, or None while no box shows."""
    lines = pane.splitlines()
    for i in range(len(lines) - 2, -1, -1):
        if lines[i].startswith("❯") and lines[i + 1].startswith("─"):
            return lines[i][1:].split("│")[0].strip()
    return None


def is_idle(pane: str) -> bool:
    return BUSY_TEXT not in pane and prompt_box(pane) is not None


def wait_ready(session: str, timeout: float) -> None:
    """Waits for the prompt box, answering the folder trust question on the way."""
    end = time.time() + timeout
    while time.time() < end:
        pane = capture(session)
        if TRUST_TEXT in pane:
            tmux("send-keys", "-t", session, "Down", "Enter")
        elif is_idle(pane):
            return
        time.sleep(1)
    raise TimeoutError(f"the session did not show its prompt in {timeout:.0f}s")


def submit(session: str, text: str) -> None:
    """Types one step and presses Enter until the box empties: a completion menu can take the first press."""
    tmux("send-keys", "-t", session, "-l", "--", text)
    for _ in range(4):
        time.sleep(1.5)
        tmux("send-keys", "-t", session, "C-m")
        time.sleep(1.5)
        box = prompt_box(capture(session))
        if box is None or box == "" or not text.startswith(box[:20]):
            return
    raise RuntimeError(f"the step stayed in the prompt box: {text}")


def wait_done(session: str, timeout: float) -> bool:
    """Waits until the pane is idle and unchanged for two looks in a row; False on the timeout."""
    end = time.time() + timeout
    last = ""
    time.sleep(3)
    while time.time() < end:
        pane = capture(session)
        if is_idle(pane) and pane == last:
            return True
        last = pane
        time.sleep(3)
    return False


def pane_text(pane: str) -> str:
    """The pane without the docked sidebar: each line cut at its `│` border, trailing blanks dropped."""
    out = [re.split(r"\s*│", line, maxsplit=1)[0].rstrip() for line in pane.splitlines()]
    return "\n".join(line for line in out if line.strip() != "")


def short(text: str) -> str:
    flat = text.strip()
    return flat if len(flat) <= MAX_TEXT else f"{flat[:MAX_TEXT]}…"


def block_lines(kind: str, block: dict) -> list[str]:
    btype = block.get("type")
    if btype == "text":
        return [f"{kind}: {short(block.get('text', ''))}"]
    if btype == "tool_use":
        return [f"tool_use {block.get('name')}: {short(json.dumps(block.get('input'), ensure_ascii=False))}"]
    if btype == "tool_result":
        return [f"tool_result: {short(str(block.get('content')))}"]
    return []


def entry_lines(entry: dict) -> list[str]:
    kind = entry.get("type")
    if kind == "system" and entry.get("content"):
        return [f"system: {short(str(entry['content']))}"]
    if kind == "attachment":
        # Only what a hook added; the engine's own attachments (tool lists, prompt snapshots) are the same in every probe.
        attachment = entry["attachment"]
        if attachment.get("type") != "hook_additional_context":
            return []
        return [f"hook context ({attachment.get('hookName')}): {short(chr(10).join(attachment.get('content', [])))}"]
    content = (entry.get("message") or {}).get("content")
    if isinstance(content, str) and kind == "user":
        return [f"user: {short(content)}"]
    if isinstance(content, list):
        return [line for block in content for line in block_lines(str(kind), block)]
    return []


def transcript_text(dirs: list[Path]) -> str:
    files = sorted((f for d in dirs for f in d.glob("*.jsonl")), key=lambda f: f.stat().st_mtime)
    lines: list[str] = []
    for f in files:
        lines.append(f"### {f.name}")
        for raw in f.read_text().splitlines():
            try:
                lines += entry_lines(json.loads(raw))
            except (json.JSONDecodeError, AttributeError):
                continue
    return "\n".join(lines) if lines else "no transcript was written"


def pane_pid(session: str) -> int | None:
    out = tmux("display-message", "-p", "-t", session, "#{pane_pid}").strip()
    return int(out) if out.isdigit() else None


def is_running(pid: int) -> bool:
    return subprocess.run(["ps", "-p", str(pid)], capture_output=True, check=False).returncode == 0


def stop_session(session: str) -> None:
    """Ends the probe's claude and waits for it: it writes its transcript as it exits, which would bring a deleted directory back."""
    pid = pane_pid(session)
    tmux("kill-session", "-t", session)
    for _ in range(30):
        if pid is None or not is_running(pid):
            return
        time.sleep(0.5)


def remove(workdir: Path, encoded: str, started: float) -> list[str]:
    """Deletes the probe's directory, its transcripts and the inline store files written since it started."""
    removed = [str(workdir)]
    shutil.rmtree(workdir, ignore_errors=True)
    for d in PROJECTS.glob(f"{encoded}*"):
        shutil.rmtree(d, ignore_errors=True)
        removed.append(str(d))
    for f in STORE.glob("*_inline-*.json"):
        if f.stat().st_mtime >= started:
            f.unlink()
            removed.append(str(f))
    return removed


def run_steps(session: str, args: argparse.Namespace) -> list[str]:
    """Types each step once the one before has finished; answers why it stopped early, if it did."""
    try:
        wait_ready(session, 60)
        for step in args.step:
            text = " ".join(step.split())
            submit(session, text)
            if not wait_done(session, args.step_timeout):
                return [f"step did not finish in {args.step_timeout:.0f}s: {text}"]
    except (TimeoutError, RuntimeError) as err:
        return [str(err)]
    return []


def stopped(signum: int, _frame: object) -> None:
    """A probe killed from outside (its session closed) still cleans up, through the `finally` in `run`."""
    raise SystemExit(128 + signum)


def run(args: argparse.Namespace) -> str:
    started = time.time()
    workdir = Path(tempfile.mkdtemp(prefix="probe-runner-", dir=temp_base()))
    session = workdir.name
    encoded = re.sub(r"[^A-Za-z0-9]", "-", str(workdir))
    try:
        subprocess.run(["git", "init", "-q"], cwd=workdir, check=True)
        command = ["claude", "--setting-sources", "project", "--model", args.model]
        for d in args.plugin_dir:
            command += ["--plugin-dir", d]
        shell = "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 " + shlex.join(command)
        tmux("new-session", "-d", "-s", session, "-x", "200", "-y", "50", "-c", str(workdir), shell)
        notes = run_steps(session, args)
        pane = pane_text(capture(session, 3000))
        stop_session(session)
        transcript = transcript_text([d for d in PROJECTS.glob(f"{encoded}*") if d.is_dir()])
    finally:
        stop_session(session)
        removed = remove(workdir, encoded, started)
    parts = [f"# probe {session} · {args.model} · {time.time() - started:.0f}s"]
    parts += [f"note: {n}" for n in notes]
    parts += ["## pane", pane, "## transcript", transcript, "## deleted", "\n".join(removed)]
    return "\n\n".join(parts)


def main() -> None:
    signal.signal(signal.SIGTERM, stopped)
    signal.signal(signal.SIGHUP, stopped)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="sonnet")
    parser.add_argument("--plugin-dir", action="append", default=[], required=True)
    parser.add_argument("--step", action="append", default=[], required=True)
    parser.add_argument("--step-timeout", type=float, default=300)
    print(run(parser.parse_args()))


if __name__ == "__main__":
    main()
