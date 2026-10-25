import json
import unittest
from unittest import mock

from fastapi import HTTPException

from api.routes import text_to_sql

# Run from the project root: uv run python -m unittest discover -s tests -t .


class EndpointTest(unittest.TestCase):
    def route(self, path):
        return next(r.endpoint for r in text_to_sql.register(None).routes if r.path == path)

    def test_providers_report_which_keys_are_set_without_exposing_them(self):
        with mock.patch.dict('os.environ', {'OPENAI_API_KEY': 'sk-secret'}, clear=True):
            listed = self.route('/api/text-to-sql/providers')()
        self.assertEqual([(p['id'], p['ready']) for p in listed], [('claude', False), ('openai', True), ('gemini', False)])
        self.assertNotIn('sk-secret', json.dumps(listed))

    def test_missing_key_points_to_settings(self):
        with mock.patch.dict('os.environ', {}, clear=True), self.assertRaises(HTTPException) as e:
            self.route('/api/text-to-sql')(text_to_sql.Question(question='Revenue by month', provider='gemini'))
        self.assertEqual((e.exception.status_code, e.exception.detail), (503, 'Gemini has no API key. Add one in Settings.'))


if __name__ == '__main__':
    unittest.main()
