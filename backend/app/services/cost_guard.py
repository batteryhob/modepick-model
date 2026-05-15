from sqlmodel import Session, func, select

from app.config import settings
from app.database import engine
from app.models import GenerationJob, utcnow


def assert_daily_budget_available(estimated_cost_usd: float) -> None:
    now = utcnow()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    with Session(engine) as session:
        spent_today = session.exec(
            select(func.coalesce(func.sum(GenerationJob.cost_estimate_usd), 0.0)).where(
                GenerationJob.created_at >= day_start,
                GenerationJob.status == "success",
            )
        ).one()

    if spent_today + estimated_cost_usd > settings.max_cost_per_day_usd:
        raise ValueError(
            f"Daily generation budget exceeded: "
            f"${spent_today:.2f} spent + ${estimated_cost_usd:.2f} requested "
            f"> ${settings.max_cost_per_day_usd:.2f} limit"
        )
