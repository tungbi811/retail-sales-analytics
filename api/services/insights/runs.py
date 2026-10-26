"""One agent-team run in a background thread: its kernel, its message log, and the user's replies and Stop."""

import json
import threading
from pathlib import Path
from uuid import uuid4

from api.services.insights.agents import GroupChat
from api.services.insights.kernel import open_kernel
from api.services.insights.stream import Translator, follow_up_message
from api.services.text_to_sql.errors import plain_error
from api.services.text_to_sql.providers import active_provider

WORKDIR = Path(__file__).resolve().parents[3] / 'logs' / 'insights'


class Run:
    def __init__(self, question: str, previous: dict | None, connect, workdir_root: Path = WORKDIR):
        self.id = uuid4().hex
        self.question, self.previous, self.connect = question, previous, connect
        self.workdir = workdir_root / self.id
        self.stopped = threading.Event()
        self.done = False
        self.thread = threading.Thread(target=self._work, daemon=True)
        self._messages: list[dict] = []
        self._changed = threading.Condition()
        self._pending = None  # the input request waiting for the user's reply
        self._server = None

    def start(self) -> None:
        self.thread.start()

    def messages_after(self, i: int, timeout: float) -> list[dict]:
        with self._changed:
            self._changed.wait_for(lambda: len(self._messages) > i or self.done, timeout)
            return self._messages[i:]

    def reply(self, text: str) -> None:
        with self._changed:
            pending, self._pending = self._pending, None
        if pending is None:
            raise ValueError('The agents are not waiting for a reply.')
        pending.respond(text)

    def stop(self) -> None:
        self.stopped.set()
        with self._changed:
            pending, self._pending = self._pending, None
        if pending is not None:
            pending.respond('exit')
        self._add([{'kind': 'end', 'status': 'stopped'}])
        self._close()

    def _add(self, messages: list[dict]) -> None:
        with self._changed:
            if self.done:
                return
            self._messages.extend(messages)
            self.done = any(m['kind'] == 'end' for m in messages)
            self._changed.notify_all()

    def _close(self) -> None:
        with self._changed:
            server, self._server = self._server, None
        if server is not None:
            server.stop()

    def _log(self, event) -> None:
        '''Appends one AG2 event to the run's transcript, for finding out afterwards why a run went the way it did.'''
        content = event.content
        entry = {'type': event.type, 'sender': getattr(content, 'sender', None)}
        if getattr(content, 'tool_calls', None):
            entry['tool_calls'] = [{'name': c.function.name, 'arguments': c.function.arguments} for c in content.tool_calls]
        elif getattr(content, 'content', None) is not None:
            entry['content'] = str(content.content)
        try:
            with (self.workdir / 'transcript.jsonl').open('a', encoding='utf-8') as f:
                f.write(json.dumps(entry, ensure_ascii=False) + '\n')
        except (OSError, TypeError):
            pass  # a transcript is a debugging aid, never a reason to fail the run

    def _work(self) -> None:
        try:
            server, executor = open_kernel(self.workdir)
            with self._changed:
                self._server = server  # a Stop during start-up leaves this for finally to shut down
            if self.stopped.is_set():
                return
            response = GroupChat(self.connect, executor, self.stopped).run(follow_up_message(self.question, self.previous))
            translator = Translator()
            for event in response.events:
                self._log(event)
                if self.stopped.is_set():
                    # Keep draining so AG2 can finish; anything it asks now gets "exit".
                    if event.type == 'input_request':
                        event.content.respond('exit')
                    continue
                messages = translator.feed(event)
                if any(m['kind'] == 'ask' for m in messages):
                    with self._changed:
                        self._pending = event.content
                self._add(messages)
        except Exception as e:
            known = plain_error(active_provider(), e)
            text = known[1] if known else f'The agents stopped with an error: {e}'
            self._add([{'kind': 'error', 'text': text}, {'kind': 'end', 'status': 'error'}])
        finally:
            self._add([{'kind': 'end', 'status': 'done'}])
            self._close()


RUNS: dict[str, Run] = {}


def busy() -> bool:
    return any(not run.done for run in RUNS.values())
