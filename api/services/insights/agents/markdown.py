from autogen import OpenAIWrapper

from api.services.insights.llm import llm_config


def convert_message_to_markdown(message: str) -> str:
    client = OpenAIWrapper(**llm_config(0).model_dump())
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
