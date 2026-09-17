import unittest
from unittest.mock import MagicMock, patch

from job_scraper.models import JobPosting
from job_scraper.scraper import detect_platform, scrape_company


class TestDetectPlatform(unittest.TestCase):
    def test_detects_from_url_directly(self):
        result = detect_platform("https://boards.greenhouse.io/acme")
        self.assertEqual(result, ("greenhouse", "acme"))

    @patch("job_scraper.scraper.get_text")
    def test_detects_from_embedded_link(self, mock_get_text):
        mock_get_text.return_value = (
            '<html><body><a href="https://jobs.lever.co/acme">Careers</a></body></html>'
        )
        result = detect_platform("https://acme.com/careers")
        self.assertEqual(result, ("lever", "acme"))

    @patch("job_scraper.scraper.get_text")
    def test_no_known_platform_returns_none(self, mock_get_text):
        mock_get_text.return_value = "<html><body>Nothing here</body></html>"
        result = detect_platform("https://acme.com/careers")
        self.assertIsNone(result)


class TestScrapeCompany(unittest.TestCase):
    @patch("job_scraper.detectors.greenhouse.fetch_jobs")
    def test_fast_path_platform_and_slug(self, mock_fetch):
        mock_fetch.return_value = [
            JobPosting(company="Acme", title="Engineer", url="u", platform="greenhouse")
        ]
        result = scrape_company({"name": "Acme", "platform": "greenhouse", "slug": "acme"})
        self.assertEqual(len(result.postings), 1)
        self.assertEqual(result.platform, "greenhouse")
        self.assertEqual(result.error, "")
        mock_fetch.assert_called_once_with("acme", "Acme")

    @patch("job_scraper.detectors.lever.fetch_jobs")
    @patch("job_scraper.detectors.greenhouse.fetch_jobs")
    def test_slug_only_probes_until_a_board_answers(self, mock_gh, mock_lever):
        mock_gh.side_effect = Exception("404 Not Found")
        mock_lever.return_value = [
            JobPosting(company="Acme", title="Consultant", url="u", platform="lever")
        ]
        result = scrape_company({"name": "Acme", "slug": "acme"})
        self.assertEqual(result.platform, "lever")
        self.assertEqual(len(result.postings), 1)

    @patch("job_scraper.detectors.greenhouse.fetch_jobs")
    def test_slug_only_reports_when_no_board_found(self, mock_gh):
        mock_gh.side_effect = Exception("404 Not Found")
        result = scrape_company({"name": "Acme", "slug": "nope"})
        self.assertEqual(result.postings, [])
        self.assertIn("no board found", result.error)

    def test_missing_config_reports_error_not_raises(self):
        result = scrape_company({"name": "Acme"})
        self.assertEqual(result.postings, [])
        self.assertIn("careers_url", result.error)

    @patch("job_scraper.scraper.generic.fetch_jobs")
    @patch("job_scraper.scraper.detect_platform")
    def test_falls_back_to_generic(self, mock_detect, mock_generic_fetch):
        mock_detect.return_value = None
        mock_generic_fetch.return_value = [
            JobPosting(company="Acme", title="Engineer", url="u", platform="generic")
        ]
        result = scrape_company({"name": "Acme", "careers_url": "https://acme.com/careers"})
        self.assertEqual(len(result.postings), 1)
        self.assertEqual(result.platform, "generic")
        mock_generic_fetch.assert_called_once_with("https://acme.com/careers", "Acme")

    @patch("job_scraper.detectors.greenhouse.fetch_jobs")
    def test_unknown_platform_does_not_raise(self, mock_fetch):
        result = scrape_company({"name": "Acme", "platform": "not-a-real-ats", "slug": "acme"})
        self.assertEqual(result.postings, [])
        self.assertIn("not-a-real-ats", result.error)
        mock_fetch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
