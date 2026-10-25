"""Use the Text to SQL provider and model selected in Settings."""

import os
import re

from autogen import LLMConfig

from api.services.text_to_sql.providers import active_provider, key_var, model_for


def takes_temperature(provider: str, model: str) -> bool:
    return not (provider == 'openai' and re.match(r'^(gpt-5|o\d)', model))


def llm_config(temperature: float) -> LLMConfig:
    provider = active_provider()
    model = model_for(provider)
    config = {
        'api_type': {'openai': 'openai', 'claude': 'anthropic', 'gemini': 'google'}[provider],
        'model': model,
        'api_key': os.getenv(key_var(provider)),
        'stream': False,
        'parallel_tool_calls': False,
    }
    application_config = {}
    if takes_temperature(provider, model):
        config['temperature'] = temperature
        # AG2 copies entries using entry.temperature or application.temperature.
        # Keep zero at both levels so agent/tool config rebuilds preserve it.
        application_config['temperature'] = temperature
    return LLMConfig(config, **application_config)
