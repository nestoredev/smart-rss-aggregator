import unittest
import os
import sqlite3
from backend.database import Database

class TestReaderStates(unittest.TestCase):
    def setUp(self):
        self.db_path = os.path.abspath("test_reader_states.db")
        if os.path.exists(self.db_path):
            try:
                os.remove(self.db_path)
            except Exception:
                pass
        self.db = Database(db_path=self.db_path)

    def tearDown(self):
        # Clean up database file after test runs
        try:
            if os.path.exists(self.db_path):
                os.remove(self.db_path)
        except Exception:
            pass

    def test_database_schema_defaults(self):
        # Ensure migration columns default correctly to 0
        feed_id = self.db.add_feed("https://test.com/rss", "https://test.com", "Test Site")
        art_id = self.db.add_article(
            feed_id=feed_id,
            title="Test Article",
            url="https://test.com/article1",
            summary="A test summary",
            published_at="2026-05-24T12:00:00"
        )
        
        with self.db._get_connection() as conn:
            row = conn.execute("SELECT is_read, is_saved FROM articles WHERE id = ?", (art_id,)).fetchone()
            self.assertEqual(row["is_read"], 0)
            self.assertEqual(row["is_saved"], 0)

    def test_state_modifiers_and_counts(self):
        feed_id = self.db.add_feed("https://test.com/rss", "https://test.com", "Test Site")
        art_id = self.db.add_article(
            feed_id=feed_id,
            title="Test Article",
            url="https://test.com/article1",
            summary="A test summary",
            published_at="2026-05-24T12:00:00"
        )
        
        # Test default count is 0
        self.assertEqual(self.db.get_saved_articles_count(), 0)
        
        # Toggle saved state to True
        self.db.set_article_save_state(art_id, True)
        self.assertEqual(self.db.get_saved_articles_count(), 1)
        
        # Toggle read state to True
        self.db.set_article_read_state(art_id, True)
        
        with self.db._get_connection() as conn:
            row = conn.execute("SELECT is_read, is_saved FROM articles WHERE id = ?", (art_id,)).fetchone()
            self.assertEqual(row["is_read"], 1)
            self.assertEqual(row["is_saved"], 1)
            
        # Toggle back to False
        self.db.set_article_save_state(art_id, False)
        self.assertEqual(self.db.get_saved_articles_count(), 0)

    def test_master_stories_filtering(self):
        feed_id = self.db.add_feed("https://test.com/rss", "https://test.com", "Test Site")
        
        # Article 1 (Unread)
        art1_id = self.db.add_article(
            feed_id=feed_id,
            title="Article 1",
            url="https://test.com/art1",
            summary="Summary 1",
            published_at="2026-05-24T10:00:00"
        )
        # Article 2 (Saved but Read)
        art2_id = self.db.add_article(
            feed_id=feed_id,
            title="Article 2",
            url="https://test.com/art2",
            summary="Summary 2",
            published_at="2026-05-24T11:00:00"
        )
        
        # Create Master Story
        ms_id = self.db.add_master_story(
            title="Master Story",
            summary_bullets=["Bullet 1"],
            unique_angles=None
        )
        
        self.db.set_articles_master_story([art1_id, art2_id], ms_id)
        
        # Default state of art2 is unread, unsaved. Let's make it read and saved
        self.db.set_article_read_state(art2_id, True)
        self.db.set_article_save_state(art2_id, True)
        
        # 1. Unread Filter: Should only return Master Story with Article 1 (Article 2 is read)
        unread_stories = self.db.get_master_stories(filter_mode="unread")
        self.assertEqual(len(unread_stories), 1)
        self.assertEqual(len(unread_stories[0]["articles"]), 1)
        self.assertEqual(unread_stories[0]["articles"][0]["id"], art1_id)
        
        # 2. Saved Filter: Should only return Master Story with Article 2 (Article 1 is unsaved)
        saved_stories = self.db.get_master_stories(filter_mode="saved")
        self.assertEqual(len(saved_stories), 1)
        self.assertEqual(len(saved_stories[0]["articles"]), 1)
        self.assertEqual(saved_stories[0]["articles"][0]["id"], art2_id)
        
        # 3. All Filter: Should return Master Story with both Article 1 and Article 2
        all_stories = self.db.get_master_stories(filter_mode="all")
        self.assertEqual(len(all_stories), 1)
        self.assertEqual(len(all_stories[0]["articles"]), 2)

    def test_self_healing_prune_orphaned_stories(self):
        # Create a Master Story but no articles associated
        ms_id = self.db.add_master_story(
            title="Orphaned Story",
            summary_bullets=["Bullet 1"],
            unique_angles=None
        )
        
        # Ensure it is deleted automatically when we query master stories
        stories = self.db.get_master_stories(filter_mode="all")
        self.assertEqual(len(stories), 0)
        
        # Double check it is deleted from the DB
        with self.db._get_connection() as conn:
            row = conn.execute("SELECT COUNT(*) FROM master_stories WHERE id = ?", (ms_id,)).fetchone()
            self.assertEqual(row[0], 0)

if __name__ == "__main__":
    unittest.main()
