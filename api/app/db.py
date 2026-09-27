from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings

# connect_timeout: fail fast if Docker/Postgres is down (e.g. after the laptop slept) instead of hanging.
engine = create_engine(settings.database_url, pool_pre_ping=True, connect_args={"connect_timeout": 5})
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)
