from api.services.insights.llm import llm_config
import threading
from typing import Annotated
from autogen import AssistantAgent
from autogen.coding import CodeBlock
from autogen.coding.jupyter import JupyterCodeExecutor
from autogen.agentchat.group import AgentNameTarget, ReplyResult, ContextVariables, RevertToUserTarget, TerminateTarget
from api.services.insights.kernel import SETUP_CELL


class Coder(AssistantAgent):
    def __init__(self, executor: JupyterCodeExecutor, stopped: threading.Event):
        def run_code(
                code: Annotated[str, "Python code to run in Jupyter"], 
                context_variables: ContextVariables
            ) -> ReplyResult:
            if stopped.is_set():
                return ReplyResult(message='Stopped by the user.', target=TerminateTarget())
            try:
                result = executor.execute_code_blocks(
                    [CodeBlock(language="python", code=code)]
                )
            except Exception:
                # Stop shuts the kernel down mid-cell; end the run instead of restarting it.
                if stopped.is_set():
                    return ReplyResult(message='Stopped by the user.', target=TerminateTarget())
                try:
                    executor.restart()
                    setup_result = executor.execute_code_blocks(
                        [CodeBlock(language="python", code=SETUP_CELL)]
                    )
                    if setup_result.exit_code:
                        return ReplyResult(message=f"Execution failed: {setup_result.output}", target=RevertToUserTarget())
                    result = executor.execute_code_blocks(
                        [CodeBlock(language="python", code=code)]
                    )
                except Exception as e:
                    return ReplyResult(message=f"Execution failed: {e}", target=RevertToUserTarget())

            if result.exit_code == 0:
                msg = f"Output:\n{result.output}"
                target = AgentNameTarget(context_variables["current_agent"])
            else:
                # Split into lines and clean
                lines = result.output.splitlines()

                errors = []
                for line in lines:
                    errors.append(line)
                    if len(errors) >= 2:
                        break
                msg = "\n".join(errors)
                target = AgentNameTarget("Coder")
            return ReplyResult(message=msg, target=target)

        super().__init__(
            name="Coder",
            llm_config=llm_config(0.0),
            human_input_mode="NEVER",
            system_message = """
                You are the Coder agent.

                Your mission is to take structured analytical step instructions and implement them as complete, runnable Python code within a Jupyter Notebook environment.

                Environment:
                - You are working in a Jupyter Notebook 
                - Avoid redefining or recreating variables that already exist unless explicitly instructed to do so.
                - Reuse context variables passed to you when appropriate.

                Data access:
                - LAKE is the Path to the read-only data lake, already available in the notebook.
                - Query lake files with DuckDB: duckdb.sql(f"select ... from read_json_auto('{LAKE}/orders/*/*.jsonl')").
                - Use DuckDB read_parquet for Parquet files and read_csv_auto for CSV files.
                - Use gold(sql) to query the gold warehouse tables and return a pandas DataFrame.
                - Never write to the lake or the database.

                Rules:
                1. Always ensure the code is minimal, correct, and runnable.
                2. Use clear print() statements so that outputs are easy to understand in logs.
                3. Do not create plots, charts, or images.
                4. When working with pandas:
                - Never use inplace=True. Instead, reassign the result (e.g., df = df.fillna(0) or df['col'] = df['col'].fillna(0)).
                - Prefer .loc for assignments to avoid chained assignment warnings.
                - Use .copy() explicitly when a new DataFrame is intended.
                5. Always call the run_code tool when writing Python code.
                6. If the result indicates an error, fix it and output the corrected code again.
                7. Never leave a variable name or expression alone on the last line of the code cell.
                - Always print() the values you want to display.
                - If you need to return multiple objects, print a summary and end the cell with '_ = None' or simply do not include any return expression.
                - Never rely on implicit return display (e.g., do not end with 'df' or 'model').

                Rules:
                - Do not re-import libraries or create features that have already been defined.
                - Always include the following import at the top of your script to suppress non-critical warnings:
                    import warnings
                    warnings.filterwarnings("ignore")
                - Write clear, readable, and reproducible code.
                - Comment complex logic briefly and meaningfully.
                - Maintain consistent variable names throughout the workflow.
                - Focus on correctness and clarity over optimization or brevity.
            """,
            functions=[run_code]
        )
