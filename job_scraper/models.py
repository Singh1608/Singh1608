from dataclasses import dataclass, field, asdict
from typing import Optional


@dataclass
class JobPosting:
    company: str
    title: str
    url: str
    platform: str
    location: str = ""
    description: str = ""
    posted_at: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)
