import unittest

from job_scraper.filters import (
    excluded_by_title,
    is_english,
    matches_location,
    matches_role,
    passes_filters,
    requires_polish,
)
from job_scraper.models import JobPosting


class TestIsEnglish(unittest.TestCase):
    def test_english_text(self):
        text = (
            "We are looking for a Software Engineer to join our team. "
            "You will work with our backend systems and help us build "
            "great products for our customers."
        )
        self.assertTrue(is_english(text))

    def test_polish_text(self):
        text = (
            "Poszukujemy inżyniera oprogramowania do naszego zespołu. "
            "Będziesz pracować nad naszymi systemami backendowymi i pomagać "
            "nam budować świetne produkty dla naszych klientów."
        )
        self.assertFalse(is_english(text))

    def test_empty_text_defaults_true(self):
        self.assertTrue(is_english(""))

    def test_short_text_defaults_true(self):
        self.assertTrue(is_english("Backend Engineer"))


class TestRequiresPolish(unittest.TestCase):
    def test_detects_polish_requirement(self):
        self.assertTrue(requires_polish("Fluent Polish is required for this role."))
        self.assertTrue(requires_polish("Native Polish speaker preferred."))

    def test_no_polish_requirement(self):
        self.assertFalse(requires_polish("English is our working language."))


class TestMatchesLocation(unittest.TestCase):
    def test_matches_city(self):
        posting = JobPosting(
            company="Acme", title="Engineer", url="", platform="x", location="Warsaw, Poland"
        )
        self.assertTrue(matches_location(posting, ["poland", "warsaw"]))

    def test_no_match(self):
        posting = JobPosting(
            company="Acme", title="Engineer", url="", platform="x", location="Berlin, Germany"
        )
        self.assertFalse(matches_location(posting, ["poland", "warsaw"]))


class TestMatchesRole(unittest.TestCase):
    def test_matches(self):
        self.assertTrue(matches_role("Senior Backend Engineer", ["backend engineer"]))

    def test_no_keywords_matches_everything(self):
        self.assertTrue(matches_role("Sales Manager", []))

    def test_no_match(self):
        self.assertFalse(matches_role("Sales Manager", ["backend engineer"]))


class TestExcludedByTitle(unittest.TestCase):
    EXCLUSIONS = ["intern", "junior", "head", "director", "sales", "partner"]

    def test_excludes_too_senior(self):
        self.assertTrue(excluded_by_title("Head of Strategy", self.EXCLUSIONS))
        self.assertTrue(excluded_by_title("Director, Transformation", self.EXCLUSIONS))

    def test_excludes_too_junior(self):
        self.assertTrue(excluded_by_title("Strategy Intern", self.EXCLUSIONS))
        self.assertTrue(excluded_by_title("Junior Consultant", self.EXCLUSIONS))

    def test_excludes_wrong_track(self):
        self.assertTrue(excluded_by_title("Sales Consultant", self.EXCLUSIONS))

    def test_word_boundary_protects_substrings(self):
        # The whole reason exclusions are word-boundary matched: these titles
        # contain "intern", "head" and "partner" as substrings but are valid.
        self.assertFalse(excluded_by_title("Internal Consultant", self.EXCLUSIONS))
        self.assertFalse(excluded_by_title("International Business Manager", self.EXCLUSIONS))
        self.assertFalse(excluded_by_title("Partnerships Analyst", self.EXCLUSIONS))

    def test_keeps_in_band_titles(self):
        for title in [
            "Management Consultant",
            "Senior Consultant, Business Transformation",
            "Chief of Staff",
            "PMO Analyst",
            "Process Excellence Specialist",
        ]:
            self.assertFalse(excluded_by_title(title, self.EXCLUSIONS), title)

    def test_no_keywords_excludes_nothing(self):
        self.assertFalse(excluded_by_title("Head of Sales", []))


class TestPassesFilters(unittest.TestCase):
    def setUp(self):
        self.search_cfg = {
            "location_keywords": ["poland", "warsaw"],
            "english_only": True,
            "exclude_if_requires_polish": True,
            "role_keywords": ["backend engineer"],
        }

    def test_title_exclusion_beats_role_match(self):
        cfg = {
            "location_keywords": ["poland"],
            "role_keywords": ["consultant"],
            "exclude_title_keywords": ["head"],
        }
        posting = JobPosting(
            company="Acme",
            title="Head of Consultant Services",
            url="",
            platform="x",
            location="Warsaw, Poland",
            description="A senior leadership role.",
        )
        self.assertFalse(passes_filters(posting, cfg))

    def test_full_match(self):
        posting = JobPosting(
            company="Acme",
            title="Backend Engineer",
            url="",
            platform="x",
            location="Warsaw, Poland",
            description=(
                "We are looking for a Backend Engineer to join our growing "
                "team and help us build great products for our customers."
            ),
        )
        self.assertTrue(passes_filters(posting, self.search_cfg))

    def test_wrong_location_excluded(self):
        posting = JobPosting(
            company="Acme",
            title="Backend Engineer",
            url="",
            platform="x",
            location="Berlin, Germany",
            description="We are looking for a Backend Engineer.",
        )
        self.assertFalse(passes_filters(posting, self.search_cfg))

    def test_wrong_role_excluded(self):
        posting = JobPosting(
            company="Acme",
            title="Sales Manager",
            url="",
            platform="x",
            location="Warsaw, Poland",
            description="We are looking for a Sales Manager.",
        )
        self.assertFalse(passes_filters(posting, self.search_cfg))

    def test_polish_required_excluded(self):
        posting = JobPosting(
            company="Acme",
            title="Backend Engineer",
            url="",
            platform="x",
            location="Warsaw, Poland",
            description="We need a Backend Engineer. Fluent Polish is required.",
        )
        self.assertFalse(passes_filters(posting, self.search_cfg))


if __name__ == "__main__":
    unittest.main()
