import sqlite3
import os
import json
from datetime import datetime

class Database:
    def __init__(self, db_path="../reader.db"):
        if db_path == ":memory:":
            self.db_path = db_path
            self._init_db()
            return
            
        # Make path absolute relative to this file's directory if it is relative
        if not os.path.isabs(db_path):
            base_dir = os.path.dirname(os.path.abspath(__file__))
            self.db_path = os.path.abspath(os.path.join(base_dir, db_path))
        else:
            self.db_path = db_path
            
        self._init_db()

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        # Enable foreign key support
        conn.execute("PRAGMA foreign_keys = ON;")
        return conn

    def _init_db(self):
        if self.db_path != ":memory:":
            os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        with self._get_connection() as conn:
            # Feeds table
            conn.execute("""
            CREATE TABLE IF NOT EXISTS feeds (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                url TEXT UNIQUE NOT NULL,
                site_url TEXT NOT NULL,
                title TEXT NOT NULL,
                last_fetched TEXT
            );
            """)

            # Master Stories table
            conn.execute("""
            CREATE TABLE IF NOT EXISTS master_stories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                summary_bullets TEXT NOT NULL, -- JSON serialized list of strings
                unique_angles TEXT,            -- JSON serialized list of strings, nullable
                created_at TEXT NOT NULL
            );
            """)

            # Articles table
            conn.execute("""
            CREATE TABLE IF NOT EXISTS articles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                feed_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                url TEXT UNIQUE NOT NULL,
                summary TEXT NOT NULL,
                published_at TEXT NOT NULL,
                fetched_at TEXT NOT NULL,
                master_story_id INTEGER,
                FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE,
                FOREIGN KEY (master_story_id) REFERENCES master_stories(id) ON DELETE SET NULL
            );
            """)
            conn.commit()

    # --- FEED CRUD ---

    def add_feed(self, url, site_url, title):
        try:
            with self._get_connection() as conn:
                cursor = conn.execute(
                    "INSERT INTO feeds (url, site_url, title) VALUES (?, ?, ?)",
                    (url, site_url, title)
                )
                conn.commit()
                return cursor.lastrowid
        except sqlite3.IntegrityError:
            # If already exists, return the existing one
            with self._get_connection() as conn:
                row = conn.execute("SELECT id FROM feeds WHERE url = ?", (url,)).fetchone()
                return row["id"] if row else None

    def get_feeds(self):
        with self._get_connection() as conn:
            rows = conn.execute("SELECT * FROM feeds ORDER BY title ASC").fetchall()
            return [dict(row) for row in rows]

    def delete_feed(self, feed_id):
        with self._get_connection() as conn:
            conn.execute("DELETE FROM feeds WHERE id = ?", (feed_id,))
            conn.commit()

    def update_feed_fetched_time(self, feed_id):
        now = datetime.utcnow().isoformat()
        with self._get_connection() as conn:
            conn.execute("UPDATE feeds SET last_fetched = ? WHERE id = ?", (now, feed_id))
            conn.commit()

    # --- ARTICLE CRUD ---

    def add_article(self, feed_id, title, url, summary, published_at):
        fetched_at = datetime.utcnow().isoformat()
        try:
            with self._get_connection() as conn:
                cursor = conn.execute(
                    """
                    INSERT INTO articles (feed_id, title, url, summary, published_at, fetched_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (feed_id, title, url, summary, published_at, fetched_at)
                )
                conn.commit()
                return cursor.lastrowid
        except sqlite3.IntegrityError:
            # Article already exists! Let's check if the existing summary is plain text
            # and the new sync summary contains rich HTML formatting, and if so, update it.
            with self._get_connection() as conn:
                row = conn.execute("SELECT id, summary FROM articles WHERE url = ?", (url,)).fetchone()
                if row:
                    existing_id = row["id"]
                    existing_summary = row["summary"]
                    # Check if existing summary lacks HTML formatting tags (like <p or <div or <img or <ul)
                    # and the new summary contains them.
                    has_formatting_old = any(tag in existing_summary for tag in ["<p", "<div", "<img", "<ul", "<ol", "<h3"])
                    has_formatting_new = any(tag in summary for tag in ["<p", "<div", "<img", "<ul", "<ol", "<h3"])
                    
                    if not has_formatting_old and has_formatting_new:
                        print(f"[Database] Upgrading existing article #{existing_id} with rich HTML formatting.")
                        conn.execute("UPDATE articles SET summary = ? WHERE id = ?", (summary, existing_id))
                        conn.commit()
                    return existing_id
            return None

    def get_unaggregated_articles_in_window(self, hours=6):
        """Fetch all articles fetched in the last `hours` hours that don't have a master_story_id yet."""
        with self._get_connection() as conn:
            # We fetch articles. We can use sqlite datetime comparison or just raw fetched_at.
            # SQLite datetime('now', '-X hours') is useful if we store ISO8601.
            query = """
            SELECT a.*, f.title as source_name 
            FROM articles a
            JOIN feeds f ON a.feed_id = f.id
            WHERE a.master_story_id IS NULL 
            AND datetime(a.fetched_at) >= datetime('now', ?)
            ORDER BY a.fetched_at DESC
            """
            rows = conn.execute(query, (f"-{hours} hours",)).fetchall()
            return [dict(row) for row in rows]

    def set_articles_master_story(self, article_ids, master_story_id):
        if not article_ids:
            return
        placeholders = ",".join("?" for _ in article_ids)
        with self._get_connection() as conn:
            conn.execute(
                f"UPDATE articles SET master_story_id = ? WHERE id IN ({placeholders})",
                [master_story_id] + list(article_ids)
            )
            conn.commit()

    # --- MASTER STORIES CRUD ---

    def add_master_story(self, title, summary_bullets, unique_angles=None):
        created_at = datetime.utcnow().isoformat()
        summary_json = json.dumps(summary_bullets)
        angles_json = json.dumps(unique_angles) if unique_angles else None
        
        with self._get_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO master_stories (title, summary_bullets, unique_angles, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (title, summary_json, angles_json, created_at)
            )
            conn.commit()
            return cursor.lastrowid

    def get_master_stories(self):
        """Fetch all master stories alongside their associated source articles."""
        with self._get_connection() as conn:
            stories_rows = conn.execute("SELECT * FROM master_stories").fetchall()
            stories = []
            orphaned_ids = []
            
            for s_row in stories_rows:
                story = dict(s_row)
                # Decode JSON fields
                story["summary_bullets"] = json.loads(story["summary_bullets"])
                story["unique_angles"] = json.loads(story["unique_angles"]) if story["unique_angles"] else None
                
                # Fetch linked articles
                articles_rows = conn.execute(
                    """
                    SELECT a.id, a.feed_id, a.title, a.url, a.summary, a.published_at, f.title as source_name
                    FROM articles a
                    JOIN feeds f ON a.feed_id = f.id
                    WHERE a.master_story_id = ?
                    """,
                    (story["id"],)
                )
                story["articles"] = [dict(a_row) for a_row in articles_rows]
                
                # If no linked articles, it's an orphaned story (skip and queue for deletion)
                if not story["articles"]:
                    orphaned_ids.append(story["id"])
                    continue
                
                # Determine the latest published_at among linked articles
                story["published_at"] = max(art["published_at"] for art in story["articles"])
                stories.append(story)
                
            # Self-heal database by deleting orphaned master stories
            if orphaned_ids:
                placeholders = ",".join("?" for _ in orphaned_ids)
                conn.execute(f"DELETE FROM master_stories WHERE id IN ({placeholders})", orphaned_ids)
                conn.commit()
                print(f"[Database] Automatically deleted {len(orphaned_ids)} orphaned master stories.")
                
            # Sort stories by published_at DESC (most recent stories at the top)
            stories.sort(key=lambda s: s["published_at"], reverse=True)
            return stories
