"""Longhand's notebook kernel helper.

Run with the folder's own Python (`uv run python` or `python3`), it starts an ipykernel with
jupyter_client in the folder given as its argument, and bridges it to Longhand over stdio, one
JSON object per line, so the app needs no ZeroMQ of its own.

Longhand sends (stdin):
  {"op": "execute", "run": id, "code": text}   run code; `run` names it in everything that follows
  {"op": "interrupt"}                           KeyboardInterrupt in the running cell
Closing stdin shuts the kernel down.

The helper sends (stdout):
  {"type": "ready", "python": "3.12.4", "kernel": pid}
  {"type": "problem", "kind", "title", "detail", "fix"}   the kernel cannot start; the helper exits
  {"type": "status", "state": "busy" | "idle"}
  {"type": "start", "run", "count"}             the cell began, with its execution count
  {"type": "output", "run", "output", "display"?}   an nbformat output; display is its display id
  {"type": "update", "display", "output"}       update_display_data
  {"type": "clear", "run", "wait"}
  {"type": "done", "run", "status": "ok" | "error" | "aborted", "count"}
  {"type": "died", "code", "signal"}            the kernel ended by itself; the helper exits

Code cannot ask for input (input(), getpass): the cell fails with one line saying so, since a
notebook in Longhand has nowhere to type the answer.

Outputs are bounded here, before they cross to the app: stream text beyond STREAM_LIMIT in one
message keeps its start and end, and a rich output larger than RICH_LIMIT becomes a note.
"""

import json
import os
import sys
import time

STREAM_LIMIT = 1_000_000
RICH_LIMIT = 5_000_000
NO_INPUT = "This cell asked for input, which notebooks in Longhand cannot give. Set the value in the code instead."
# How long a finished reply waits for the kernel's idle status (which ends its outputs).
IDLE_GRACE = 2.0


def send(message):
    sys.stdout.write(json.dumps(message, ensure_ascii=True) + "\n")
    sys.stdout.flush()


def problem(kind, title, detail, fix=None):
    send({"type": "problem", "kind": kind, "title": title, "detail": detail, "fix": fix})
    sys.exit(3)


def uses_uv():
    return bool(os.environ.get("LONGHAND_UV"))


def missing_ipykernel():
    fix = "uv add --dev ipykernel" if uses_uv() else "python3 -m pip install ipykernel"
    where = "this project's environment" if uses_uv() else "the python3 Longhand found"
    problem(
        "no-ipykernel",
        "ipykernel is not installed",
        "Notebooks run in %s (%s), which does not have ipykernel, the package that runs notebook code. "
        "Install it, then run the cell again." % (where, sys.executable),
        fix,
    )


def cap_text(text, limit=STREAM_LIMIT):
    if len(text) <= limit:
        return text
    head, tail = text[: limit // 5], text[-(limit - limit // 5) :]
    lines = text[limit // 5 : -(limit - limit // 5)].count("\n")
    return "%s\n[… Longhand left out %s lines of this output here …]\n%s" % (head, format(lines, ","), tail)


def cap_bundle(data):
    """A rich output too large to keep in the notebook becomes a note saying so."""
    size = sum(len(json.dumps(value)) for value in data.values())
    if size <= RICH_LIMIT:
        return data
    return {"text/plain": "[Longhand did not keep this output: it was %.0f MB. Save large results to a file instead.]" % (size / 1e6)}


def to_output(msg_type, content):
    """An iopub message's content as an nbformat output."""
    if msg_type == "stream":
        return {"output_type": "stream", "name": content.get("name", "stdout"), "text": cap_text(content.get("text", ""))}
    if msg_type == "error" and content.get("ename") == "StdinNotImplementedError":
        return {"output_type": "error", "ename": "StdinNotImplementedError", "evalue": NO_INPUT, "traceback": [NO_INPUT]}
    if msg_type == "error":
        traceback = content.get("traceback") or []
        return {
            "output_type": "error",
            "ename": content.get("ename", ""),
            "evalue": content.get("evalue", ""),
            "traceback": [cap_text(line, 100_000) for line in traceback[:200]],
        }
    output = {"output_type": "display_data" if msg_type != "execute_result" else "execute_result"}
    output["data"] = cap_bundle(content.get("data", {}))
    output["metadata"] = content.get("metadata", {})
    if msg_type == "execute_result":
        output["execution_count"] = content.get("execution_count")
    return output


class Bridge:
    def __init__(self, km, kc):
        self.km = km
        self.kc = kc
        self.runs = {}  # msg_id -> our run id
        self.replies = {}  # run id -> (status, count, when)
        self.idle = set()  # runs whose idle status arrived
        self.counts = {}
        self.pending_input = None
        self.buffer = b""

    def handle_command(self, command):
        op = command.get("op")
        if op == "execute":
            msg_id = self.kc.execute(command.get("code", ""), allow_stdin=False, stop_on_error=True)
            self.runs[msg_id] = command.get("run")
        elif op == "interrupt":
            self.km.interrupt_kernel()

    def read_stdin(self):
        """Reads what is waiting on stdin; returns False once it is closed."""
        chunk = os.read(sys.stdin.fileno(), 65536)
        if not chunk:
            return False
        self.buffer += chunk
        while b"\n" in self.buffer:
            line, self.buffer = self.buffer.split(b"\n", 1)
            if line.strip():
                self.handle_command(json.loads(line))
        return True

    def run_of(self, msg):
        return self.runs.get(msg.get("parent_header", {}).get("msg_id"))

    def iopub(self, msg):
        msg_type = msg["header"]["msg_type"]
        content = msg["content"]
        run = self.run_of(msg)
        if msg_type == "status":
            state = content.get("execution_state")
            if state in ("busy", "idle"):
                send({"type": "status", "state": state})
            if state == "idle" and run:
                self.idle.add(run)
                self.maybe_done(run)
        elif msg_type == "execute_input" and run:
            self.counts[run] = content.get("execution_count")
            send({"type": "start", "run": run, "count": content.get("execution_count")})
        elif msg_type in ("stream", "display_data", "execute_result", "error") and run:
            message = {"type": "output", "run": run, "output": to_output(msg_type, content)}
            display = (content.get("transient") or {}).get("display_id")
            if display:
                message["display"] = display
            send(message)
        elif msg_type == "update_display_data":
            display = (content.get("transient") or {}).get("display_id")
            if display:
                send({"type": "update", "display": display, "output": to_output("display_data", content)})
        elif msg_type == "clear_output" and run:
            send({"type": "clear", "run": run, "wait": bool(content.get("wait"))})

    def shell(self, msg):
        if msg["header"]["msg_type"] != "execute_reply":
            return
        run = self.run_of(msg)
        if not run:
            return
        content = msg["content"]
        self.replies[run] = (content.get("status", "error"), content.get("execution_count"), time.monotonic())
        self.maybe_done(run, aborted=content.get("status") == "aborted")

    def maybe_done(self, run, aborted=False, late=False):
        """A run is done once its reply and its idle status have both arrived (or the reply has waited long enough)."""
        if run not in self.replies or not (aborted or late or run in self.idle):
            return
        status, count, _ = self.replies.pop(run)
        self.idle.discard(run)
        for msg_id, other in list(self.runs.items()):
            if other == run:
                del self.runs[msg_id]
        send({"type": "done", "run": run, "status": status if status in ("ok", "error", "aborted") else "error", "count": count})

    def overdue(self):
        now = time.monotonic()
        for run, (_, _, when) in list(self.replies.items()):
            if now - when > IDLE_GRACE:
                self.maybe_done(run, late=True)


def main():
    cwd = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
    try:
        import ipykernel  # noqa: F401
    except ImportError:
        missing_ipykernel()
    try:
        import zmq
        from jupyter_client.kernelspec import KernelSpec, KernelSpecManager
        from jupyter_client.manager import KernelManager
    except ImportError as error:
        problem(
            "no-jupyter-client",
            "jupyter_client could not be loaded",
            "ipykernel is installed but its jupyter_client could not be imported (%s). Reinstall ipykernel." % error,
            "uv add --dev ipykernel" if uses_uv() else "python3 -m pip install --force-reinstall ipykernel",
        )

    class ThisPython(KernelSpecManager):
        """Always this interpreter: a kernel installed elsewhere for "python3" must not be used instead."""

        def get_kernel_spec(self, kernel_name):
            return KernelSpec(
                argv=[sys.executable, "-m", "ipykernel_launcher", "-f", "{connection_file}"],
                display_name="Python",
                language="python",
            )

    os.environ.setdefault("PYDEVD_DISABLE_FILE_VALIDATION", "1")
    km = KernelManager(kernel_name="python3", kernel_spec_manager=ThisPython())
    try:
        km.start_kernel(cwd=cwd)
    except Exception as error:  # noqa: BLE001
        problem("start-failed", "The kernel could not start", str(error))
    kc = km.client()
    kc.start_channels()
    try:
        kc.wait_for_ready(timeout=120)
    except RuntimeError as error:
        problem("start-failed", "The kernel did not start", str(error))
    info = kc.kernel_info(reply=True, timeout=10)["content"] if hasattr(kc, "kernel_info") else {}
    version = (info.get("language_info") or {}).get("version") or "%d.%d.%d" % sys.version_info[:3]
    pid = getattr(getattr(km, "provisioner", None), "pid", None) or getattr(getattr(km, "kernel", None), "pid", None)
    send({"type": "ready", "python": version, "kernel": pid})

    bridge = Bridge(km, kc)
    poller = zmq.Poller()
    channels = {kc.iopub_channel.socket: (kc.iopub_channel, bridge.iopub), kc.shell_channel.socket: (kc.shell_channel, bridge.shell)}
    for socket in channels:
        poller.register(socket, zmq.POLLIN)
    poller.register(sys.stdin.fileno(), zmq.POLLIN)
    last_check = time.monotonic()
    try:
        while True:
            for item, _ in poller.poll(250):
                if item == sys.stdin.fileno():
                    if not bridge.read_stdin():
                        return
                    continue
                channel, handle = channels[item]
                while True:
                    try:
                        msg = channel.get_msg(timeout=0)
                    except Exception:  # noqa: BLE001  (queue.Empty, under different names across versions)
                        break
                    handle(msg)
            bridge.overdue()
            if time.monotonic() - last_check > 0.5:
                last_check = time.monotonic()
                if not km.is_alive():
                    code = getattr(getattr(km, "provisioner", None), "process", None)
                    code = getattr(code, "returncode", None) if code is not None else None
                    send({"type": "died", "code": code if code is None or code >= 0 else None, "signal": -code if code is not None and code < 0 else None})
                    return
    finally:
        try:
            kc.stop_channels()
            km.shutdown_kernel(now=True)
        except Exception:  # noqa: BLE001
            pass


if __name__ == "__main__":
    main()
