import logging

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger("job_scraper")

USER_AGENT = (
    "Mozilla/5.0 (compatible; JobScraperBot/1.0; "
    "+https://github.com/singh1608/singh1608)"
)

DEFAULT_TIMEOUT = 20

_session = requests.Session()
_session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json, text/html"})


def get(url: str, **kwargs) -> requests.Response:
    kwargs.setdefault("timeout", DEFAULT_TIMEOUT)
    resp = _session.get(url, **kwargs)
    resp.raise_for_status()
    return resp


def get_json(url: str, **kwargs) -> dict:
    return get(url, **kwargs).json()


def get_text(url: str, **kwargs) -> str:
    return get(url, **kwargs).text


def strip_html(html: str) -> str:
    if not html:
        return ""
    return BeautifulSoup(html, "lxml").get_text(separator=" ", strip=True)
