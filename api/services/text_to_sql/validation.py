import re

# The check every model-written query passes before it runs: one read-only SELECT, nothing else.

FORBIDDEN = re.compile(r'\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|copy|call|do|vacuum|analyze|lock|listen|notify|set|reset|comment|security)\b|\bpg_\w+\s*\(|\bdblink|\blo_\w+\s*\(', re.IGNORECASE)


def guard(sql: str) -> str:
    '''Return the query ready to run, or raise ValueError if it is not a single read-only SELECT.'''
    # Checks run on the code alone: string literals and comments may contain any word or semicolon.
    code = re.sub(r"'(?:[^']|'')*'", "''", sql)
    code = re.sub(r'--[^\n]*|/\*.*?\*/', ' ', code, flags=re.DOTALL).strip().rstrip(';').strip()
    if not code:
        raise ValueError('No query was written.')
    if ';' in code:
        raise ValueError('Only one statement is allowed.')
    if not re.match(r'(select|with)\b', code, re.IGNORECASE):
        raise ValueError('Only SELECT queries are allowed.')
    hit = FORBIDDEN.search(code)
    if hit:
        raise ValueError(f'"{hit.group(0).strip()}" is not allowed in a read-only query.')
    return re.sub(r';\s*$', '', sql.strip())
