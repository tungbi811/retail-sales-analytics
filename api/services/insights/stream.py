"""Turn AG2 group-chat events into the plain messages the dashboard shows, following the old Streamlit rules."""

import json


def follow_up_message(question: str, previous: dict | None) -> str:
    if not previous:
        return question
    return (f"Earlier question: {previous['question']}\n\n"
            f"Earlier report:\n{previous['report']}\n\n"
            f"Follow-up question: {question}")


class Translator:
    def __init__(self):
        self.skipped_question = False
        self.caller = None      # who made the tool call whose response comes next
        self.last_agent = None  # sender of the last message
        self.last_text = ''     # last message or output text, shown with a question to the user

    def feed(self, event) -> list[dict]:
        content = event.content
        if event.type == 'text':
            sender, text = content.sender, str(content.content or '')
            if sender == 'User' and not self.skipped_question:
                self.skipped_question = True
                return []
            if not text.strip():
                return []
            self.last_agent, self.last_text = sender, text
            return [{'kind': 'message', 'agent': sender, 'text': text}]
        if event.type == 'tool_call':
            self.caller = content.sender
            if content.sender == 'Coder':
                code = json.loads(content.tool_calls[0].function.arguments)['code']
                return [{'kind': 'code', 'agent': 'Coder', 'code': code}]
            return []
        if event.type == 'tool_response':
            agent, self.caller = self.caller or 'System', None
            self.last_agent, self.last_text = None, str(content.content)
            return [{'kind': 'output', 'agent': agent, 'text': self.last_text}]
        if event.type == 'input_request':
            if self.last_agent == 'BusinessTranslator':
                content.respond('exit')
                return [{'kind': 'report', 'text': self.last_text}]
            return [{'kind': 'ask', 'agent': 'BusinessAnalyst', 'text': self.last_text}]
        if event.type == 'run_completion':
            return [{'kind': 'end', 'status': 'done'}]
        return []
