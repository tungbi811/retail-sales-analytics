from .business_analyst import BusinessAnalyst
from .data_scientist import DataScientist
from .business_translator import BusinessTranslator
from .coder import Coder
import threading
from autogen.coding.jupyter import JupyterCodeExecutor
from autogen.io.run_response import RunResponse
from autogen import UserProxyAgent
from autogen.agentchat import run_group_chat
from autogen.agentchat.group.patterns import DefaultPattern
from autogen.agentchat.group import ContextVariables, RevertToUserTarget, AgentTarget, OnCondition, StringLLMCondition

class GroupChat:
    def __init__(self, connect, executor: JupyterCodeExecutor, stopped: threading.Event):
        context_variables = ContextVariables(data={
            "current_agent": "",
            "objective": "",
            "problem_type": "",
            "stakeholders_expectations": [],
            "research_questions": [],
        })
    
        coder = Coder(executor, stopped)
        business_analyst = BusinessAnalyst(connect)
        data_scientist = DataScientist()
        business_translator = BusinessTranslator()
        user = UserProxyAgent(
            name="User",
            code_execution_config=False
        )

        business_translator.handoffs.set_after_work(RevertToUserTarget())

        self.pattern = DefaultPattern(
            initial_agent=business_analyst,
            agents=[business_analyst, business_translator, data_scientist, coder],
            user_agent=user,
            context_variables=context_variables,
            group_after_work=AgentTarget(business_analyst)
        )

    def run(self, question: str) -> RunResponse:
        response = run_group_chat(
            pattern=self.pattern,
            messages=question,
            max_rounds=200
        )

        return response
