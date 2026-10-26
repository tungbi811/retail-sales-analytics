import json
import threading
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import mock

import httpx
import openai

from api.services.insights import runs
from api.services.insights.stream import Translator, follow_up_message


def text(sender, content):
    return SimpleNamespace(type='text', content=SimpleNamespace(sender=sender, content=content))


def tool_call(sender, name, **arguments):
    function = SimpleNamespace(name=name, arguments=json.dumps(arguments))
    return SimpleNamespace(type='tool_call', content=SimpleNamespace(sender=sender, tool_calls=[SimpleNamespace(function=function)]))


def tool_response(content):
    return SimpleNamespace(type='tool_response', content=SimpleNamespace(content=content))


class Input:
    def __init__(self):
        self.answers = []
        self.event = SimpleNamespace(type='input_request', content=SimpleNamespace(prompt='', respond=self.answers.append))


DONE = SimpleNamespace(type='run_completion', content=SimpleNamespace(summary=''))


class FakeServer:
    def __init__(self):
        self.stops = 0

    def stop(self):
        self.stops += 1


class TranslatorTest(unittest.TestCase):
    def test_translates_old_event_kinds(self):
        translator = Translator()
        events = [
            text('User', 'Which products run out next month?'),
            tool_call('BusinessAnalyst', 'get_data_info'),
            tool_response('Six lake sources'),
            text('BusinessAnalyst', 'Framed as a 30-day stock-out forecast.'),
            text('BusinessTranslator', 'Step 1: estimate daily demand.'),
            text('DataScientist', 'Load orders and stock snapshots.'),
            tool_call('Coder', 'run_code', code='print(1)'),
            tool_response('Output:\n1'),
            text('User', 'Only North, please.'),
            text('', ''),
            SimpleNamespace(type='group_chat_run_chat', content=None),
            DONE,
        ]
        messages = [m for event in events for m in translator.feed(event)]
        self.assertEqual(messages, [
            {'kind': 'output', 'agent': 'BusinessAnalyst', 'text': 'Six lake sources'},
            {'kind': 'message', 'agent': 'BusinessAnalyst', 'text': 'Framed as a 30-day stock-out forecast.'},
            {'kind': 'message', 'agent': 'BusinessTranslator', 'text': 'Step 1: estimate daily demand.'},
            {'kind': 'message', 'agent': 'DataScientist', 'text': 'Load orders and stock snapshots.'},
            {'kind': 'code', 'agent': 'Coder', 'code': 'print(1)'},
            {'kind': 'output', 'agent': 'Coder', 'text': 'Output:\n1'},
            {'kind': 'message', 'agent': 'User', 'text': 'Only North, please.'},
            {'kind': 'end', 'status': 'done'},
        ])

    def test_tool_response_without_a_call_is_from_system(self):
        self.assertEqual(Translator().feed(tool_response('stray')), [{'kind': 'output', 'agent': 'System', 'text': 'stray'}])

    def test_follow_up_message_carries_context(self):
        self.assertEqual(follow_up_message('Which stores?', None), 'Which stores?')
        self.assertEqual(
            follow_up_message('And by store?', {'question': 'Who will churn?', 'report': '# Churn\n12 customers'}),
            'Earlier question: Who will churn?\n\nEarlier report:\n# Churn\n12 customers\n\nFollow-up question: And by store?')


class RunTest(unittest.TestCase):
    def setUp(self):
        tmp = TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.server = FakeServer()
        kernel = mock.patch.object(runs, 'open_kernel', return_value=(self.server, object()))
        kernel.start()
        self.addCleanup(kernel.stop)
        self.questions = []

    def run_with(self, events, question='Which products run out next month?', previous=None):
        questions = self.questions

        class FakeGroupChat:
            def __init__(self, connect, executor, stopped):
                FakeGroupChat.stopped = stopped

            def run(self, message):
                questions.append(message)
                return SimpleNamespace(events=events() if callable(events) else iter(events))

        patch = mock.patch.object(runs, 'GroupChat', FakeGroupChat)
        patch.start()
        self.addCleanup(patch.stop)
        run = runs.Run(question, previous, connect=None, workdir_root=self.root)
        run.start()
        return run, FakeGroupChat

    def wait_until(self, run, kind):
        seen = []
        for _ in range(100):
            seen = seen + run.messages_after(len(seen), timeout=0.05)
            if any(m['kind'] == kind for m in seen):
                return seen
        self.fail(f'no {kind} message in {seen}')

    def test_clarification_waits_for_reply(self):
        pending = Input()
        released = threading.Event()

        def events():
            yield text('User', 'Who will churn?')
            yield tool_call('BusinessAnalyst', 'request_clarification', question='Which region?')
            yield tool_response('Which region do you mean?')
            yield pending.event
            released.wait(2)
            yield DONE

        run, _ = self.run_with(events)
        messages = self.wait_until(run, 'ask')
        # The question shows once, as the question, not also as the tool's result.
        self.assertEqual(messages, [{'kind': 'ask', 'agent': 'BusinessAnalyst', 'text': 'Which region do you mean?'}])
        self.assertFalse(run.done)
        run.reply('Only North')
        self.assertEqual(pending.answers, ['Only North'])
        with self.assertRaises(ValueError):
            run.reply('again')
        released.set()
        self.assertEqual(self.wait_until(run, 'end')[-1], {'kind': 'end', 'status': 'done'})
        self.assertTrue(run.done)
        self.assertEqual(self.server.stops, 1)

    def test_input_after_translator_report_auto_exits(self):
        pending = Input()
        run, _ = self.run_with([
            text('User', 'Who will churn?'),
            text('BusinessTranslator', '# Churn report\n12 customers are fading.'),
            pending.event,
            DONE,
        ])
        messages = self.wait_until(run, 'end')
        self.assertEqual(messages, [
            {'kind': 'message', 'agent': 'BusinessTranslator', 'text': '# Churn report\n12 customers are fading.'},
            {'kind': 'report', 'text': '# Churn report\n12 customers are fading.'},
            {'kind': 'end', 'status': 'done'},
        ])
        self.assertEqual(pending.answers, ['exit'])

    def test_stop_ends_stream_and_closes_jupyter(self):
        pending = Input()
        later = threading.Event()

        def events():
            yield text('BusinessAnalyst', 'Which region?')
            yield pending.event
            later.wait(2)
            yield text('DataScientist', 'Should not appear.')
            yield DONE

        run, chat = self.run_with(events)
        self.wait_until(run, 'ask')
        run.stop()
        self.assertEqual(run.messages_after(0, timeout=0)[-1], {'kind': 'end', 'status': 'stopped'})
        self.assertTrue(run.done)
        self.assertTrue(chat.stopped.is_set())
        self.assertEqual(pending.answers, ['exit'])
        self.assertEqual(self.server.stops, 1)
        later.set()
        run.thread.join(2)
        self.assertFalse(run.thread.is_alive())
        self.assertEqual([m['kind'] for m in run.messages_after(0, timeout=0)], ['message', 'ask', 'end'])
        self.assertEqual(self.server.stops, 1, 'Jupyter is shut down once')

    def test_stop_while_kernel_starts_still_closes_it(self):
        starting, release = threading.Event(), threading.Event()

        def slow_kernel(workdir):
            starting.set()
            release.wait(2)
            return self.server, object()

        with mock.patch.object(runs, 'open_kernel', side_effect=slow_kernel):
            run, _ = self.run_with([DONE])
            starting.wait(2)
            run.stop()
            release.set()
            run.thread.join(2)
        self.assertEqual(run.messages_after(0, timeout=0), [{'kind': 'end', 'status': 'stopped'}])
        self.assertEqual(self.server.stops, 1)

    def test_provider_error_becomes_error_message(self):
        def events():
            yield text('User', 'Who will churn?')
            request = httpx.Request('POST', 'https://api.openai.com/v1/chat/completions')
            raise openai.AuthenticationError('bad key', response=httpx.Response(401, request=request), body=None)

        with mock.patch.dict('os.environ', {'TEXT_TO_SQL_PROVIDER': 'openai'}):
            run, _ = self.run_with(events)
            messages = self.wait_until(run, 'end')
        self.assertEqual(messages, [
            {'kind': 'error', 'text': 'The OpenAI API key was rejected. Check it in Settings.'},
            {'kind': 'end', 'status': 'error'},
        ])
        self.assertEqual(self.server.stops, 1)

    def test_unexpected_error_is_said_plainly(self):
        def events():
            raise RuntimeError('kernel died')
            yield

        run, _ = self.run_with(events)
        self.assertEqual(self.wait_until(run, 'end'), [
            {'kind': 'error', 'text': 'The agents stopped with an error: kernel died'},
            {'kind': 'end', 'status': 'error'},
        ])

    def test_follow_up_run_sends_context(self):
        run, _ = self.run_with([DONE], question='And by store?', previous={'question': 'Who?', 'report': 'R'})
        self.wait_until(run, 'end')
        self.assertEqual(self.questions, ['Earlier question: Who?\n\nEarlier report:\nR\n\nFollow-up question: And by store?'])

    def test_busy_while_any_run_is_going(self):
        with mock.patch.dict(runs.RUNS, clear=True):
            self.assertFalse(runs.busy())
            runs.RUNS['a'] = SimpleNamespace(done=False)
            self.assertTrue(runs.busy())
            runs.RUNS['a'].done = True
            self.assertFalse(runs.busy())


if __name__ == '__main__':
    unittest.main()
