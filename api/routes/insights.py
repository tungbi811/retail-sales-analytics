import json

from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from api.services.insights.runs import RUNS, Run, busy
from api.services.text_to_sql.providers import PROVIDERS, active_provider, has_key

# A business question in, the agent team's discussion streamed back, then its report. Used by the dashboard's Insights page.


class Previous(BaseModel):
    question: str = Field(max_length=1000)
    report: str = Field(max_length=50_000)


class Question(BaseModel):
    question: str = Field(min_length=3, max_length=1000)
    previous: Previous | None = None


class Reply(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


def register(connect):
    router = APIRouter(prefix='/api/insights/runs')

    def find(run_id: str) -> Run:
        if run_id not in RUNS:
            raise HTTPException(status_code=404, detail='No such run.')
        return RUNS[run_id]

    @router.post('')
    def start(q: Question):
        provider = active_provider()
        if not has_key(provider):
            raise HTTPException(status_code=503, detail=f'{PROVIDERS[provider][0]} has no API key. Add one in Settings.')
        if busy():
            raise HTTPException(status_code=409, detail='Agents are already working on a question.')
        run = Run(q.question.strip(), q.previous.model_dump() if q.previous else None, connect)
        RUNS[run.id] = run
        run.start()
        return {'id': run.id}

    @router.get('/{run_id}/events')
    def events(run_id: str):
        run = find(run_id)

        def stream():
            # Always from message 0, so a reload or a second mount sees the whole discussion once.
            sent = 0
            while True:
                batch = run.messages_after(sent, timeout=15)
                if not batch:
                    if run.done:
                        return
                    yield ': still working\n\n'
                    continue
                for message in batch:
                    yield f'data: {json.dumps(message, ensure_ascii=False)}\n\n'
                sent += len(batch)

        return StreamingResponse(stream(), media_type='text/event-stream',
                                 headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})

    @router.post('/{run_id}/reply', status_code=204)
    def reply(run_id: str, r: Reply):
        try:
            find(run_id).reply(r.text.strip())
        except ValueError as e:
            raise HTTPException(status_code=409, detail=str(e))
        return Response(status_code=204)

    @router.post('/{run_id}/stop', status_code=204)
    def stop(run_id: str):
        find(run_id).stop()
        return Response(status_code=204)

    return router
