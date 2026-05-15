from fastapi import APIRouter, Depends
from sqlmodel import Session, func, select

from app.database import get_session
from app.models import GenerationJob, utcnow

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


def _job_to_dict(j: GenerationJob) -> dict:
    return {
        "id": j.id,
        "type": j.type,
        "character_id": j.character_id,
        "inputs": j.inputs,
        "output_image_ids": j.output_image_ids,
        "provider": j.provider,
        "model": j.model,
        "cost_estimate_usd": j.cost_estimate_usd,
        "status": j.status,
        "error_message": j.error_message,
        "duration_ms": j.duration_ms,
        "created_at": j.created_at.isoformat(),
    }


@router.get("")
def list_jobs(
    limit: int = 50,
    offset: int = 0,
    session: Session = Depends(get_session),
):
    stmt = (
        select(GenerationJob)
        .order_by(GenerationJob.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    jobs = list(session.exec(stmt).all())
    return [_job_to_dict(j) for j in jobs]


@router.get("/stats")
def job_stats(session: Session = Depends(get_session)):
    now = utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    total_jobs = session.exec(select(func.count()).select_from(GenerationJob)).one()
    total_cost = session.exec(
        select(func.coalesce(func.sum(GenerationJob.cost_estimate_usd), 0.0))
    ).one()
    month_cost = session.exec(
        select(func.coalesce(func.sum(GenerationJob.cost_estimate_usd), 0.0)).where(
            GenerationJob.created_at >= month_start
        )
    ).one()
    avg_duration = session.exec(
        select(func.coalesce(func.avg(GenerationJob.duration_ms), 0))
    ).one()

    by_type_rows = session.exec(
        select(
            GenerationJob.type,
            func.count(),
            func.coalesce(func.sum(GenerationJob.cost_estimate_usd), 0.0),
        ).group_by(GenerationJob.type)
    ).all()
    by_type = {
        row[0]: {"count": row[1], "cost": row[2]}
        for row in by_type_rows
    }

    return {
        "total_jobs": total_jobs,
        "total_cost_usd": round(total_cost, 4),
        "cost_this_month": round(month_cost, 4),
        "by_type": by_type,
        "avg_duration_ms": int(avg_duration or 0),
    }


@router.get("/{job_id}")
def get_job(job_id: str, session: Session = Depends(get_session)):
    job = session.get(GenerationJob, job_id)
    if not job:
        return {"status": "missing"}
    return _job_to_dict(job)
