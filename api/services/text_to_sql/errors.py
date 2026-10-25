import anthropic
import openai
import psycopg
from google.genai import errors as genai_errors

from api.services.text_to_sql.providers import PROVIDERS

# Provider and database failures as an HTTP status and one plain sentence. Shared by Text to SQL and Insights.


def plain_error(provider: str, e: Exception) -> tuple[int, str] | None:
    '''None for anything that is not a known provider or Postgres failure.'''
    label = PROVIDERS[provider][0]
    if isinstance(e, (anthropic.AuthenticationError, openai.AuthenticationError)):
        return 503, f'The {label} API key was rejected. Check it in Settings.'
    if isinstance(e, (anthropic.RateLimitError, openai.RateLimitError)):
        return 429, f'{label} is rate limited right now. Try again in a minute.'
    if isinstance(e, (anthropic.APIConnectionError, openai.APIConnectionError)):
        return 503, f'Cannot reach the {label} API.'
    if isinstance(e, (anthropic.APIStatusError, openai.APIStatusError)):
        return 502, f'{label} API error {e.status_code}.'
    if isinstance(e, genai_errors.APIError):
        return 502, f'Gemini API error {e.code}: {e.message}'
    if isinstance(e, psycopg.OperationalError):
        return 503, f'Cannot reach Postgres: {e}'
    return None
