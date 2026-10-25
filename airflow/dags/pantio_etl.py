from airflow.sdk import dag, task
from datetime import datetime, timedelta
from cosmos import DbtTaskGroup, ProjectConfig, ProfileConfig, ExecutionConfig, RenderConfig
from cosmos.constants import InvocationMode

DBT_PROJECT_DIR = "/usr/local/airflow/dbt"
DBT_EXECUTABLE = "/usr/local/airflow/dbt_venv/bin/dbt"

@dag(
    dag_id="pantio_etl",
    schedule="@daily",
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    max_consecutive_failed_dag_runs=1,
    default_args={"retries": 2, "retry_delay": timedelta(seconds=30)}
)
def pantio_etl():

    @task
    def load_bronze():
        from ingestion.load_data import load_bronze_tables
        load_bronze_tables()

    dbt_transform = DbtTaskGroup(
        group_id='dbt_transform',
        project_config=ProjectConfig(DBT_PROJECT_DIR),
        profile_config=ProfileConfig(
            profile_name="dbt",
            target_name='dev',
            profiles_yml_filepath=f'{DBT_PROJECT_DIR}/profiles.yml'
        ),
        # dbt lives in its own venv, so Cosmos must call it as a subprocess, both when
        # running models and when rendering the DAG (dbt ls at parse time)
        execution_config=ExecutionConfig(
            dbt_executable_path=DBT_EXECUTABLE,
            invocation_mode=InvocationMode.SUBPROCESS
        ),
        render_config=RenderConfig(
            dbt_executable_path=DBT_EXECUTABLE,
            invocation_mode=InvocationMode.SUBPROCESS
        )
    )

    load_bronze() >> dbt_transform

pantio_etl()
