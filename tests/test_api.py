import importlib.util
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

spec = importlib.util.spec_from_file_location(
    "jobs_api", os.path.join(os.path.dirname(__file__), "..", "api", "jobs.py")
)
jobs_api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(jobs_api)

from job_scraper.models import JobPosting  # noqa: E402

# A self-contained fixture config, independent of the real config.yaml
# (whose companies/role_keywords are expected to change often).
_FIXTURE_CONFIG = """
search:
  location_keywords:
    - poland
    - warsaw
  english_only: false
  exclude_if_requires_polish: false
  role_keywords:
    - backend engineer
companies: []
"""


class TestRunScrape(unittest.TestCase):
    def test_returns_filtered_dicts(self):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".yaml", delete=False
        ) as f:
            f.write(_FIXTURE_CONFIG)
            config_path = f.name

        try:
            with patch.object(jobs_api, "CONFIG_PATH", config_path), patch.object(
                jobs_api, "scrape_all"
            ) as mock_scrape_all:
                mock_scrape_all.return_value = self._sample_postings()
                results = jobs_api.run_scrape()
        finally:
            os.unlink(config_path)

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["title"], "Backend Engineer")
        self.assertIsInstance(results[0], dict)

    @staticmethod
    def _sample_postings():
        return [
            JobPosting(
                company="Acme",
                title="Backend Engineer",
                url="https://acme.com/jobs/1",
                platform="greenhouse",
                location="Warsaw, Poland",
                description="We are looking for a Backend Engineer to join our team.",
            ),
            JobPosting(
                company="Acme",
                title="Sales Manager",
                url="https://acme.com/jobs/2",
                platform="greenhouse",
                location="Berlin, Germany",
                description="We are looking for a Sales Manager.",
            ),
        ]


if __name__ == "__main__":
    unittest.main()
