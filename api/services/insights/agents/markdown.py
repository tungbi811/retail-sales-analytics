from autogen import OpenAIWrapper

from api.services.insights.llm import llm_config


def convert_message_to_markdown(message: str) -> str:
    config = llm_config(0).model_dump()
    # This call has no tools, and OpenAI rejects parallel_tool_calls without them (400).
    for entry in config['config_list']:
        entry.pop('parallel_tool_calls', None)
    client = OpenAIWrapper(**config)
    messages = [
        {"role": "user", "content": f"Convert the whole message to markdown format (do not summarise or remove anything):\n{message}"}
    ]
    response = client.create(messages=messages)
    text = client.extract_text_or_completion_object(response)[0]
    if "```markdown" in text:
        try:
            return text.split("```markdown")[1].split("```")[0].strip()
        except IndexError:
            pass
    return text.strip()
