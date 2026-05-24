import unittest
from bs4 import BeautifulSoup
from backend.sync import SyncEngine
from backend.database import Database

class TestScraperFormatting(unittest.TestCase):
    def setUp(self):
        import os
        self.db_path = "test_reader.db"
        if os.path.exists(self.db_path):
            try:
                os.remove(self.db_path)
            except Exception:
                pass
        self.db = Database(db_path=self.db_path)
        self.sync_engine = SyncEngine(self.db)

    def tearDown(self):
        import os
        # Clean up database file after test runs
        try:
            if os.path.exists(self.db_path):
                os.remove(self.db_path)
        except Exception:
            pass

    def test_clean_inline_tags_nested(self):
        # A complex nested inline structure
        html = '<p>This is a <span><strong>great</strong> link <a href="http://apple.com">here <em>with emphasis</em></a></span>.</p>'
        soup = BeautifulSoup(html, "html.parser")
        p_tag = soup.find("p")
        
        result = self.sync_engine.clean_inline_tags(p_tag)
        self.assertIn('<strong class="font-semibold text-slate-100">great</strong>', result)
        self.assertIn('<a href="http://apple.com" target="_blank" class="text-purple-400 hover:text-purple-300 underline font-medium">here <em class="italic text-slate-200 font-light">with emphasis</em></a>', result)
        self.assertTrue(result.startswith("This is a "))
        self.assertTrue(result.endswith("."))

    def test_format_html_summary_basic(self):
        # Test fallback summary formatting with nested block elements
        html = '<div><p>Paragraph 1 <strong>bold</strong></p><p>Paragraph 2 <a href="url">link</a></p></div>'
        result = self.sync_engine.format_html_summary(html, "Fallback Title")
        self.assertIn('<p class=\'text-sm text-slate-300 leading-relaxed mb-4\'>Paragraph 1 <strong class="font-semibold text-slate-100">bold</strong></p>', result)
        self.assertIn('<p class=\'text-sm text-slate-300 leading-relaxed mb-4\'>Paragraph 2 <a href="url" target="_blank" class="text-purple-400 hover:text-purple-300 underline font-medium">link</a></p>', result)

    def test_format_html_summary_lists(self):
        # Test list preservation inside feed summary fallbacks
        html = '<ul><li>Item 1</li><li>Item 2 <strong>bold</strong></li></ul>'
        result = self.sync_engine.format_html_summary(html, "Fallback Title")
        self.assertIn('<ul><li>Item 1</li><li>Item 2 <strong class="font-semibold text-slate-100">bold</strong></li></ul>', result)

    def test_database_upgrade_logic(self):
        # Insert a feed
        feed_id = self.db.add_feed("url1", "site1", "Title1")
        
        # 1. Insert plain-text summary (simulating legacy article)
        url = "https://9to5mac.com/article1"
        legacy_summary = "Apple has registered a new subdomain record ahead of WWDC: genai.apple.com."
        art_id = self.db.add_article(
            feed_id=feed_id,
            title="Article 1",
            url=url,
            summary=legacy_summary,
            published_at="2026-05-24T00:00:00"
        )
        self.assertIsNotNone(art_id)
        
        # Verify it was inserted
        row = self.db._get_connection().execute("SELECT summary FROM articles WHERE id = ?", (art_id,)).fetchone()
        self.assertEqual(row["summary"], legacy_summary)
        
        # 2. Re-insert same article with rich HTML summary (simulating new crawl with scraper active)
        rich_summary = "<p class='text-sm text-slate-300 leading-relaxed mb-4'>Apple has registered a new subdomain record ahead of WWDC: <a href='url'>genai.apple.com</a>.</p>"
        second_art_id = self.db.add_article(
            feed_id=feed_id,
            title="Article 1",
            url=url,
            summary=rich_summary,
            published_at="2026-05-24T00:00:00"
        )
        
        # Should return the same existing ID
        self.assertEqual(art_id, second_art_id)
        
        # Verify it was upgraded in the database
        upgraded_row = self.db._get_connection().execute("SELECT summary FROM articles WHERE id = ?", (art_id,)).fetchone()
        self.assertEqual(upgraded_row["summary"], rich_summary)

if __name__ == "__main__":
    unittest.main()
