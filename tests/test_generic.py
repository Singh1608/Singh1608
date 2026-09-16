import unittest
from unittest.mock import MagicMock, patch

from job_scraper import generic


def _mock_response(text_data):
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.text = text_data
    return resp


class TestGenericJsonLd(unittest.TestCase):
    @patch("job_scraper.http._session.get")
    def test_parses_job_posting_schema(self, mock_get):
        html = """
        <html><head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "JobPosting",
          "title": "Site Reliability Engineer",
          "description": "<p>Keep things running.</p>",
          "datePosted": "2026-01-01",
          "jobLocation": {
            "@type": "Place",
            "address": {
              "addressLocality": "Krakow",
              "addressCountry": "Poland"
            }
          }
        }
        </script>
        </head><body></body></html>
        """
        mock_get.return_value = _mock_response(html)
        postings = generic.fetch_jobs("https://example.com/careers", "Example Co")
        self.assertEqual(len(postings), 1)
        p = postings[0]
        self.assertEqual(p.title, "Site Reliability Engineer")
        self.assertEqual(p.location, "Krakow, Poland")
        self.assertEqual(p.platform, "generic")
        self.assertIn("Keep things running.", p.description)

    @patch("job_scraper.http._session.get")
    def test_no_jobs_no_links_returns_empty(self, mock_get):
        mock_get.return_value = _mock_response("<html><body><p>No jobs here.</p></body></html>")
        postings = generic.fetch_jobs("https://example.com/careers", "Example Co")
        self.assertEqual(postings, [])


if __name__ == "__main__":
    unittest.main()
