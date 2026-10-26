import json
import unittest
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import insights
from api.services.insights import runs

# Run from the project root: uv run python -m unittest discover -s tests -t .


class FakeRun:
    made = []

    def __init__(self, question, previous, connect):
        self.id = f'run{len(FakeRun.made) + 1}'
        self.question, self.previous = question, previous
        self.messages = [{'kind': 'message', 'agent': 'BusinessAnalyst', 'text': 'Framing it.'},
                         {'kind': 'end', 'status': 'done'}]
        self.done = False
        self.started = self.stopped = False
        self.replies = []
        FakeRun.made.append(self)

    def start(self):
        self.started = True

    def messages_after(self, i, timeout):
        self.done = True
        return self.messages[i:]

    def reply(self, text):
        if text == 'nobody asked':
            raise ValueError('The agents are not waiting for a reply.')
        self.replies.append(text)

    def stop(self):
        self.stopped = True


class InsightsRoutesTest(unittest.TestCase):
    def setUp(self):
        FakeRun.made = []
        for patch in [mock.patch.object(insights, 'Run', FakeRun),
                      mock.patch.dict(runs.RUNS, clear=True),
                      mock.patch.dict('os.environ', {'TEXT_TO_SQL_PROVIDER': 'openai', 'OPENAI_API_KEY': 'sk-test'}, clear=True)]:
            patch.start()
            self.addCleanup(patch.stop)
        app = FastAPI()
        app.include_router(insights.register(None))
        self.client = TestClient(app)

    def start(self, **body):
        return self.client.post('/api/insights/runs', json={'question': 'Which products run out next month?', **body})

    def events(self, run_id):
        response = self.client.get(f'/api/insights/runs/{run_id}/events')
        self.assertEqual(response.headers['content-type'].split(';')[0], 'text/event-stream')
        return [json.loads(line[len('data: '):]) for line in response.text.split('\n\n') if line.startswith('data: ')]

    def test_start_runs_in_the_background(self):
        response = self.start(previous={'question': 'Who will churn?', 'report': '# Churn'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'id': 'run1'})
        run = FakeRun.made[0]
        self.assertTrue(run.started)
        self.assertEqual((run.question, run.previous), ('Which products run out next month?', {'question': 'Who will churn?', 'report': '# Churn'}))

    def test_start_without_key_points_to_settings(self):
        with mock.patch.dict('os.environ', {'TEXT_TO_SQL_PROVIDER': 'gemini'}, clear=True):
            response = self.start()
        self.assertEqual((response.status_code, response.json()['detail']), (503, 'Gemini has no API key. Add one in Settings.'))
        self.assertEqual(FakeRun.made, [])

    def test_second_run_while_busy_is_409(self):
        self.start()
        response = self.start()
        self.assertEqual((response.status_code, response.json()['detail']), (409, 'The agents are still working on another question, maybe from another tab. Ask again when it has finished.'))
        self.assertEqual(len(FakeRun.made), 1)

    def test_two_questions_at_once_start_one_run(self):
        import threading
        import time
        from fastapi import HTTPException
        # Call the endpoint from two threads, as the server's thread pool does; TestClient would queue them.
        start = next(r.endpoint for r in insights.register(None).routes if r.path == '/api/insights/runs')
        real_busy = insights.busy

        def slow_busy():
            answer = real_busy()
            time.sleep(0.05)  # widen the gap between the check and adding the run
            return answer

        results = []

        def ask():
            try:
                results.append(start(insights.Question(question='Which products run out?')))
            except HTTPException as e:
                results.append(e.status_code)

        with mock.patch.object(insights, 'busy', slow_busy):
            threads = [threading.Thread(target=ask) for _ in range(2)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
        self.assertEqual(len(FakeRun.made), 1)
        self.assertIn(409, results)

    def test_question_length_is_checked(self):
        self.assertEqual(self.client.post('/api/insights/runs', json={'question': 'Hi'}).status_code, 422)

    def test_events_replay_from_start(self):
        run_id = self.start().json()['id']
        first, second = self.events(run_id), self.events(run_id)
        self.assertEqual(first, FakeRun.made[0].messages)
        self.assertEqual(second, first)

    def test_events_for_unknown_run_is_404(self):
        self.assertEqual(self.client.get('/api/insights/runs/nope/events').status_code, 404)

    def test_reply_reaches_the_run(self):
        run_id = self.start().json()['id']
        response = self.client.post(f'/api/insights/runs/{run_id}/reply', json={'text': 'Only North'})
        self.assertEqual(response.status_code, 204)
        self.assertEqual(FakeRun.made[0].replies, ['Only North'])

    def test_reply_when_not_waiting_is_409(self):
        run_id = self.start().json()['id']
        response = self.client.post(f'/api/insights/runs/{run_id}/reply', json={'text': 'nobody asked'})
        self.assertEqual((response.status_code, response.json()['detail']), (409, 'The agents are not waiting for a reply.'))

    def test_stop_returns_204(self):
        run_id = self.start().json()['id']
        self.assertEqual(self.client.post(f'/api/insights/runs/{run_id}/stop').status_code, 204)
        self.assertTrue(FakeRun.made[0].stopped)


if __name__ == '__main__':
    unittest.main()
