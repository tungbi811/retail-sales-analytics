from api.services.insights.llm import llm_config
from autogen import ConversableAgent, UpdateSystemMessage
from autogen.agentchat.group import AgentNameTarget, ContextVariables, ReplyResult
from pydantic import BaseModel, Field
from typing import Annotated

class DataScientistStep(BaseModel):
    instruction: str = Field(
        ...,
        description="Description of what and how to do for this step.",
        examples=[
            ""
            "Use KMeans algorithm from sklearn for clustering tasks, determining optimal number of clusters with the elbow method.",
            "For time series forecasting, implement ARIMA model using statsmodels library.",
        ]
    )

def execute_data_scientist_step(
    step: DataScientistStep,
    context_variables: ContextVariables,
) -> ReplyResult:
    """
    Delegate data scientist tasks to the Coder agent.
    """
    context_variables["current_agent"] = "DataScientist"
    return ReplyResult(
        message=f"""
            Hey Coder! Can you write python code to achieve the following task:

            {step.instruction}
        """,
        target=AgentNameTarget("Coder"),
        context_variables=context_variables,
    )

def complete_data_scientist_task(
    answer: Annotated[str, "The final answer from the Data Scientist agent to the Business Translator agent."],
    context_variables: ContextVariables,
) -> ReplyResult:
    return ReplyResult(
        message="Business Translator! " + answer,
        target=AgentNameTarget("BusinessTranslator"),
        context_variables=context_variables,
    )

class DataScientist(ConversableAgent):
    def __init__(self):
        super().__init__(
            name="DataScientist",
            llm_config=llm_config(0.3),
            human_input_mode="NEVER",
            code_execution_config=False,
            system_message = """
                You are the Data Scientist.

                Your role is to execute data science and analytical tasks as instructed by the Business Translator and return clear, validated quantitative findings. 
                You do not communicate directly with the user or stakeholders — only with the Business Translator.

                Responsibilities:
                1. Interpret the Business Translator’s instruction and decide the most suitable analytical or statistical method to address it.
                2. Break down complex analysis into small, actionable steps.
                3. For each step, call execute_data_scientist_step to instruct the Coder to implement the required computation.
                4. Review the Coder’s output (not the code) to ensure the results make sense, then decide the next step if needed.
                5. Do not request or produce visualizations or plots — focus only on data and numerical/text outputs.
                6. Once the analysis for the current task is complete and results are validated, call complete_data_scientist_task to summarize findings and return them to the Business Translator.

                Data:
                - Base every figure on the data lake's daily history. The gold warehouse is a separate snapshot from a
                  different period: use it only to look up product, store and customer names, never for figures.
                - Work at the grain the data has: stock and deliveries are per store and product.

                Predictions (forecasts, churn, stock-outs, any model):
                - Hold back the most recent stretch of history as a test period (for a 3-month forecast, the last 3 months;
                  otherwise the latest 20% by time). Never score a model on data it was trained on.
                - Start from a simple baseline (the same as last period or last year, or the most common outcome), then try
                  2–3 models and tune their main settings with a small search using time-ordered cross-validation (for
                  example Holt-Winters trend and seasonal options, or gradient boosting depth and learning rate). Keep each
                  code step well under 20 minutes.
                - Choose by the lowest error on the test period among all candidates, the baseline included. Forecast with
                  the winner, retrained on all the history; when the baseline wins, the forecast is the baseline's.
                - With the findings, pass on: the model kept, the test period, its error on that period (MAE and MAPE for
                  amounts; accuracy, precision and recall for yes/no outcomes) and the baseline's error on the same period.
                - A prediction is not finished until the Coder has printed those test errors. Do not call
                  complete_data_scientist_task for a prediction before then.

                Rules:
                - If you need to build a machine learning model, you should choose a robust model instead of a simple model like Linear Regression or Logistic Regression.
                - Do not ask vague or open-ended questions for coders. The requirement should be small and specific.
                - Keep reasoning data-driven and concise.
                - Always use complete_data_scientist_task to hand off results — never respond directly.
                - Ensure all findings are clear, interpretable, and directly answer the Business Translator’s analytical question.
                - Each response must be based on executed results, not assumptions.
                - You operate in an iterative loop until the Business Translator confirms the objective is met.
            """,
            functions=[execute_data_scientist_step, complete_data_scientist_task],
        )
