import unittest
from unittest.mock import MagicMock, patch

from job_scraper.detectors import ashby, greenhouse, lever, personio, recruitee, teamtailor


def _mock_response(json_data=None, text_data=None):
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    if json_data is not None:
        resp.json.return_value = json_data
    if text_data is not None:
        resp.text = text_data
    return resp


class TestGreenhouse(unittest.TestCase):
    @patch("job_scraper.http._session.get")
    def test_fetch_jobs(self, mock_get):
        mock_get.return_value = _mock_response(json_data={
            "jobs": [
                {
                    "title": "Backend Engineer",
                    "absolute_url": "https://boards.greenhouse.io/acme/jobs/1",
                    "location": {"name": "Warsaw, Poland"},
                    "content": "<p>Join our <b>team</b> in Warsaw.</p>",
                    "updated_at": "2026-01-01",
                }
            ]
        })
        postings = greenhouse.fetch_jobs("acme", "Acme")
        self.assertEqual(len(postings), 1)
        p = postings[0]
        self.assertEqual(p.title, "Backend Engineer")
        self.assertEqual(p.location, "Warsaw, Poland")
        self.assertEqual(p.platform, "greenhouse")
        self.assertIn("Join our team in Warsaw.", p.description)

    def test_link_pattern(self):
        m = greenhouse.LINK_PATTERN.search("https://boards.greenhouse.io/acme/jobs/123")
        self.assertEqual(m.group(1), "acme")


class TestLever(unittest.TestCase):
    @patch("job_scraper.http._session.get")
    def test_fetch_jobs(self, mock_get):
        mock_get.return_value = _mock_response(json_data=[
            {
                "text": "Full Stack Engineer",
                "hostedUrl": "https://jobs.lever.co/acme/abc",
                "categories": {"location": "Krakow, Poland"},
                "descriptionPlain": "We build things.",
                "lists": [],
                "createdAt": 1700000000000,
            }
        ])
        postings = lever.fetch_jobs("acme", "Acme")
        self.assertEqual(len(postings), 1)
        self.assertEqual(postings[0].location, "Krakow, Poland")
        self.assertEqual(postings[0].platform, "lever")

    def test_link_pattern(self):
        m = lever.LINK_PATTERN.search("https://jobs.lever.co/acme/xyz")
        self.assertEqual(m.group(1), "acme")


class TestAshby(unittest.TestCase):
    @patch("job_scraper.http._session.get")
    def test_fetch_jobs(self, mock_get):
        mock_get.return_value = _mock_response(json_data={
            "jobs": [
                {
                    "title": "Data Engineer",
                    "jobUrl": "https://jobs.ashbyhq.com/acme/1",
                    "location": "Remote (Poland)",
                    "descriptionPlain": "Nice role.",
                    "publishedAt": "2026-01-01",
                }
            ]
        })
        postings = ashby.fetch_jobs("acme", "Acme")
        self.assertEqual(postings[0].location, "Remote (Poland)")


class TestRecruitee(unittest.TestCase):
    @patch("job_scraper.http._session.get")
    def test_fetch_jobs(self, mock_get):
        mock_get.return_value = _mock_response(json_data={
            "offers": [
                {
                    "title": "QA Engineer",
                    "careers_url": "https://acme.recruitee.com/o/qa-engineer",
                    "city": "Wroclaw",
                    "country": "Poland",
                    "remote": False,
                    "description": "<p>Test things.</p>",
                    "published_at": "2026-01-01",
                }
            ]
        })
        postings = recruitee.fetch_jobs("acme", "Acme")
        self.assertEqual(postings[0].location, "Wroclaw, Poland")


class TestPersonio(unittest.TestCase):
    @patch("job_scraper.http._session.get")
    def test_fetch_jobs(self, mock_get):
        xml = """<?xml version="1.0" encoding="UTF-8"?>
        <workzag-jobs>
          <position>
            <id>42</id>
            <name>DevOps Engineer</name>
            <office>Poznan</office>
            <jobDescriptions>
              <jobDescription>
                <name>What we offer</name>
                <value><![CDATA[<p>Great benefits</p>]]></value>
              </jobDescription>
            </jobDescriptions>
            <createdAt>2026-01-01</createdAt>
          </position>
        </workzag-jobs>"""
        mock_get.return_value = _mock_response(text_data=xml)
        postings = personio.fetch_jobs("acme", "Acme")
        self.assertEqual(len(postings), 1)
        self.assertEqual(postings[0].title, "DevOps Engineer")
        self.assertEqual(postings[0].location, "Poznan")
        self.assertIn("Great benefits", postings[0].description)


class TestTeamtailor(unittest.TestCase):
    @patch("job_scraper.http._session.get")
    def test_fetch_jobs(self, mock_get):
        mock_get.return_value = _mock_response(json_data={
            "jobs": [
                {
                    "title": "Product Designer",
                    "url": "https://acme.teamtailor.com/jobs/1",
                    "locations": [{"city": "Gdansk"}],
                    "body": "<p>Design things.</p>",
                    "created-at": "2026-01-01",
                }
            ]
        })
        postings = teamtailor.fetch_jobs("acme", "Acme")
        self.assertEqual(postings[0].location, "Gdansk")


if __name__ == "__main__":
    unittest.main()
