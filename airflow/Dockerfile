FROM astrocrpublic.azurecr.io/runtime:3.3-11

# dbt gets its own venv so its dependencies can't clash with Airflow's.
# The runtime ships Python 3.14; the venv uses 3.12 to match the project's local .venv.
# Cosmos calls it via ExecutionConfig(dbt_executable_path="/usr/local/airflow/dbt_venv/bin/dbt").
ENV UV_PYTHON_INSTALL_DIR=/usr/local/airflow/.uv-python
RUN pip install --no-cache-dir uv && \
    uv venv /usr/local/airflow/dbt_venv --python 3.12 && \
    uv pip install --no-cache --python /usr/local/airflow/dbt_venv/bin/python \
        dbt-core==1.12.6 dbt-postgres==1.11.0
