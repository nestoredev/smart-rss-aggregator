import os
import json
import time
import subprocess
import threading
import feedparser
from bs4 import BeautifulSoup
from datetime import datetime
from backend.database import Database
from backend.clustering import cluster_articles

class SyncEngine:
    def __init__(self, db: Database):
        self.db = db
        self.is_syncing = False
        self._sync_lock = threading.Lock()

    def clean_html(self, html_content):
        """Strip HTML tags and return plain text content."""
        if not html_content:
            return ""
        soup = BeautifulSoup(html_content, "html.parser")
        # Remove script and style elements
        for script in soup(["script", "style"]):
            script.decompose()
        text = soup.get_text(separator=" ")
        # Clean extra whitespaces
        return " ".join(text.split())[:1200]  # Limit characters to keep prompt sizes reasonable

    def clean_inline_tags(self, tag):
        """Clean inline HTML tags (a, strong, em, b, i) recursively and strip others."""
        if tag is None:
            return ""
        cleaned_pieces = []
        if isinstance(tag, str):
            return tag
            
        if not hasattr(tag, "children") or tag.children is None:
            return tag.get_text().strip()

        for child in tag.children:
            if child.name == "a":
                href = child.get("href", "")
                inner_text = self.clean_inline_tags(child)
                cleaned_pieces.append(f'<a href="{href}" target="_blank" class="text-purple-400 hover:text-purple-300 underline font-medium">{inner_text}</a>')
            elif child.name in ["strong", "b"]:
                inner_text = self.clean_inline_tags(child)
                cleaned_pieces.append(f'<strong class="font-semibold text-slate-100">{inner_text}</strong>')
            elif child.name in ["em", "i"]:
                inner_text = self.clean_inline_tags(child)
                cleaned_pieces.append(f'<em class="italic text-slate-200 font-light">{inner_text}</em>')
            elif child.name is None:
                cleaned_pieces.append(child.string or "")
            else:
                cleaned_pieces.append(self.clean_inline_tags(child))
        return "".join(cleaned_pieces).strip()

    def format_html_summary(self, html_content, fallback_title):
        """Parse arbitrary HTML content (like feed summaries) and format it cleanly with paragraphs, lists, etc."""
        if not html_content:
            return f"<p class='text-sm text-slate-300 leading-relaxed mb-4'>{fallback_title}</p>"
            
        soup = BeautifulSoup(html_content, "html.parser")
        # Strip dangerous/unwanted tags
        for el in soup(["script", "style", "iframe", "form", "button"]):
            el.decompose()
            
        # Find paragraphs, lists, images, headings
        tags = soup.find_all(["p", "h2", "h3", "h4", "ul", "ol", "img"])
        
        # If no block tags are found, wrap the raw text in a styled paragraph
        if not tags:
            clean_txt = " ".join(soup.get_text().split())
            if not clean_txt:
                clean_txt = fallback_title
            return f"<p class='text-sm text-slate-300 leading-relaxed mb-4'>{clean_txt}</p>"
            
        blocks = []
        for tag in tags:
            # Skip if tag is nested inside another block tag to prevent duplicate rendering
            if any(p in tag.parents for p in tags):
                continue
                
            if tag.name == "img":
                src = tag.get("src") or tag.get("data-src")
                if src and (src.startswith("http") or src.startswith("//")):
                    if src.startswith("//"):
                        src = "https:" + src
                    blocks.append(f'<img src="{src}" alt="Article Image" class="w-full h-auto rounded-xl border border-white/5 my-4" />')
            elif tag.name in ["ul", "ol"]:
                items = []
                for li in tag.find_all("li"):
                    items.append(f"<li>{self.clean_inline_tags(li)}</li>")
                if items:
                    list_tag = "ul" if tag.name == "ul" else "ol"
                    blocks.append(f"<{list_tag}>{''.join(items)}</{list_tag}>")
            elif tag.name in ["h2", "h3", "h4"]:
                blocks.append(f"<h3 class='text-base font-bold text-slate-100 mt-4 mb-2'>{tag.get_text().strip()}</h3>")
            else:
                text_content = self.clean_inline_tags(tag)
                if text_content:
                    blocks.append(f"<p class='text-sm text-slate-300 leading-relaxed mb-4'>{text_content}</p>")
                    
        if not blocks:
            clean_txt = " ".join(soup.get_text().split())
            if not clean_txt:
                clean_txt = fallback_title
            return f"<p class='text-sm text-slate-300 leading-relaxed mb-4'>{clean_txt}</p>"
            
        return "".join(blocks)

    def scrape_full_article(self, url):
        """Scrapes the full article page, extracting clean content for the reader."""
        import urllib.request
        from urllib.parse import urlparse
        
        print(f"[Scraper] Fetching full article content: {url}")
        try:
            req = urllib.request.Request(
                url, 
                headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
            )
            with urllib.request.urlopen(req, timeout=8) as response:
                html = response.read()
                
            soup = BeautifulSoup(html, "html.parser")
            for el in soup(["script", "style", "nav", "header", "footer", "aside", "form", "iframe", "noscript", "button"]):
                el.decompose()
                
            domain = urlparse(url).netloc.lower()
            article_body = None
            
            if "9to5mac.com" in domain:
                article_body = soup.find("div", class_="post-content") or soup.find("div", class_="entry-content")
            elif "macrumors.com" in domain:
                article_body = soup.find("div", class_="entry-content") or soup.find("article")
            elif "techcrunch.com" in domain:
                article_body = soup.find("div", class_="entry-content") or soup.find("div", class_="article-content")
                
            if not article_body:
                article_body = soup.find("article") or soup.find("div", class_="entry-content") or soup.find("div", class_="article-content") or soup.find("div", class_="post-content") or soup.find("main") or soup.find("body")
                
            if article_body:
                tags = article_body.find_all(["p", "h2", "h3", "h4", "ul", "ol", "img"])
                blocks = []
                for tag in tags:
                    # Skip if tag is nested inside another block tag to prevent duplicate rendering
                    if any(p in tag.parents for p in tags):
                        continue
                        
                    if tag.name == "img":
                        src = tag.get("src") or tag.get("data-src")
                        if src and (src.startswith("http") or src.startswith("//")):
                            if src.startswith("//"):
                                src = "https:" + src
                            blocks.append(f'<img src="{src}" alt="Article Image" class="w-full h-auto rounded-xl border border-white/5 my-4" />')
                    elif tag.name in ["ul", "ol"]:
                        items = []
                        for li in tag.find_all("li"):
                            items.append(f"<li>{self.clean_inline_tags(li)}</li>")
                        if items:
                            list_tag = "ul" if tag.name == "ul" else "ol"
                            blocks.append(f"<{list_tag}>{''.join(items)}</{list_tag}>")
                    elif tag.name in ["h2", "h3", "h4"]:
                        blocks.append(f"<h3 class='text-base font-bold text-slate-100 mt-4 mb-2'>{tag.get_text().strip()}</h3>")
                    else:
                        text_content = self.clean_inline_tags(tag)
                        if text_content:
                            blocks.append(f"<p class='text-sm text-slate-300 leading-relaxed mb-4'>{text_content}</p>")
                
                if blocks:
                    return "".join(blocks)
            return None
        except Exception as e:
            print(f"[Scraper Error] Failed to scrape {url}: {e}")
            return None


    def crawl_feed(self, feed):
        """Fetch and parse single feed, saving new articles."""
        print(f"Crawling feed: {feed['title']} ({feed['url']})")
        parsed = feedparser.parse(feed['url'])
        
        new_count = 0
        for entry in parsed.entries:
            title = entry.get('title', 'Untitled Article')
            url = entry.get('link', '')
            if not url:
                continue
                
            # Parse published date
            published_at = None
            date_val = None
            for date_key in ['published_parsed', 'updated_parsed', 'created_parsed']:
                val = entry.get(date_key)
                if val:
                    try:
                        published_at = datetime(*val[:6]).isoformat()
                        date_val = val
                        break
                    except Exception:
                        continue
            
            # Filter articles published before May 15, 2026
            if date_val and date_val[:3] < (2026, 5, 15):
                print(f"Skipping old article from {date_val[:3]}: {title}")
                continue
                
            if not published_at:
                published_at = datetime.utcnow().isoformat()
                
            # Extract content summary
            summary = entry.get('summary', '')
            if not summary and 'content' in entry:
                summary = entry.content[0].value
                
            # Try to scrape full article content from actual website
            scraped_content = self.scrape_full_article(url)
            if scraped_content:
                full_formatted_summary = scraped_content
            else:
                # Fallback to feed summary but parse and keep safe HTML formatting
                full_formatted_summary = self.format_html_summary(summary, title)
                
            # Add to database
            article_id = self.db.add_article(
                feed_id=feed['id'],
                title=title,
                url=url,
                summary=full_formatted_summary,
                published_at=published_at
            )
            if article_id:
                new_count += 1
                
        # Update feed fetch stamp
        self.db.update_feed_fetched_time(feed['id'])
        print(f"Finished crawling: {feed['title']}. Discovered {new_count} new articles.")
        return new_count

    def run_llm_bridge(self, articles):
        """
        Executes the compiled Swift helper binary, feeds articles to its stdin,
        and parses the resulting structured MasterStory JSON output.
        """
        base_dir = os.path.dirname(os.path.abspath(__file__))
        binary_path = os.path.abspath(os.path.join(base_dir, "../llm-bridge"))

        if not os.path.exists(binary_path):
            print(f"WARNING: Swift binary not found at {binary_path}. Falling back to default mock summary.")
            return self.generate_fallback_story(articles)

        # Prepare JSON payload
        input_payload = {
            "articles": [
                {
                    "title": art["title"],
                    "source_name": art["source_name"],
                    "url": art["url"],
                    # Clean and limit text summary to 1000 characters to keep prompt sizes fast and highly accurate
                    "summary": self.clean_html(art["summary"])[:1000]
                }
                for art in articles
            ]
        }

        try:
            # Start process explicitly enforcing UTF-8 encoding to prevent locale decoding issues
            process = subprocess.Popen(
                [binary_path],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8"
            )
            
            # Increased timeout to 90s to give Apple Intelligence cold boots plenty of time
            stdout, stderr = process.communicate(input=json.dumps(input_payload), timeout=90)
            
            if process.returncode != 0:
                print(f"Error in Swift LLM Bridge (code {process.returncode}): {stderr}")
                return self.generate_fallback_story(articles)
                
            # Parse result
            story_data = json.loads(stdout)
            return story_data
            
        except subprocess.TimeoutExpired:
            print("Swift LLM Bridge execution timed out after 90s.")
            process.kill()
            return self.generate_fallback_story(articles)
        except Exception as e:
            print(f"Exception during LLM Bridge execution: {e}")
            return self.generate_fallback_story(articles)

    def extract_sentences(self, text, num_sentences=2):
        """Helper to extract the first N sentences of a clean text summary."""
        if not text:
            return []
        import re
        # Clean double spaces and split into sentences
        cleaned = " ".join(text.split())
        sentences = re.split(r'(?<=[.!?])\s+', cleaned)
        sentences = [s.strip() for s in sentences if s.strip()]
        return sentences[:num_sentences]

    def generate_fallback_story(self, articles):
        """Fallback summary generator in case the Swift local LLM bridge is unavailable or fails."""
        if len(articles) == 1:
            art = articles[0]
            clean_text = self.clean_html(art["summary"])
            sentences = self.extract_sentences(clean_text, 3)
            if not sentences:
                sentences = [f"No description provided by source. View the full article on {art['source_name']}."]
            return {
                "masterTitle": art["title"],
                "coreSummaryBullets": sentences,
                "sourceOutlets": [{"source_name": art["source_name"], "url": art["url"]}],
                "uniqueAngles": None
            }
        else:
            title = articles[0]["title"]
            bullets = []
            outlets = []
            for art in articles:
                clean_text = self.clean_html(art["summary"])
                sentences = self.extract_sentences(clean_text, 1)
                snippet = sentences[0] if sentences else "View original coverage."
                if len(snippet) > 180:
                    snippet = snippet[:177] + "..."
                bullets.append(f"[{art['source_name']}] {art['title']} — {snippet}")
                outlets.append({"source_name": art["source_name"], "url": art["url"]})
            
            return {
                "masterTitle": title,
                "coreSummaryBullets": bullets,
                "sourceOutlets": outlets,
                "uniqueAngles": [
                    "Note: Native Apple Intelligence bridge was bypassed or local FoundationModels was unavailable (fallback generated locally)."
                ]
            }

    def sync_all(self, run_llm=True):
        """Execute full synchronization pipeline for all feeds."""
        with self._sync_lock:
            if self.is_syncing:
                print("Sync already in progress. Skipping.")
                return False
            self.is_syncing = True

        try:
            feeds = self.db.get_feeds()
            total_new = 0
            for feed in feeds:
                try:
                    total_new += self.crawl_feed(feed)
                except Exception as e:
                    print(f"Failed crawling feed {feed['title']}: {e}")

            # If run_llm is False (background crawl mode), bypass the clustering & LLM step
            # to prevent macOS modelmanagerd sandbox SIGKILL in daemon threads.
            if not run_llm:
                print("Background crawl completed successfully. Bypassing LLM consolidation to avoid macOS sandbox SIGKILL.")
                return True

            # Fetch unaggregated articles from the past 6 hours
            unaggregated = self.db.get_unaggregated_articles_in_window(hours=6)
            if not unaggregated:
                print("No new unaggregated articles to cluster in the 6-hour window.")
                return True

            # Group articles using our pure-Python TF-IDF clustering
            groups = cluster_articles(unaggregated, threshold=0.35)
            print(f"Clustering complete. Identified {len(groups)} story cluster(s) from {len(unaggregated)} articles.")

            # Process each cluster into a MasterStory
            for group in groups:
                # Group is a list of article dicts
                story_data = self.run_llm_bridge(group)
                
                # Save MasterStory
                master_story_id = self.db.add_master_story(
                    title=story_data["masterTitle"],
                    summary_bullets=story_data["coreSummaryBullets"],
                    unique_angles=story_data.get("uniqueAngles")
                )
                
                # Associate articles with MasterStory
                article_ids = [art["id"] for art in group]
                self.db.set_articles_master_story(article_ids, master_story_id)
                print(f"Saved Master Story #{master_story_id}: '{story_data['masterTitle']}' grouping {len(group)} sources.")
                
                # Sleep for 3.5 seconds to let the macOS kernel release the 3-4 GB model memory
                # between sequential process spawns, preventing OOM SIGKILL (-9) rate-limits.
                time.sleep(3.5)
                
            return True
        finally:
            self.is_syncing = False

    def start_background_sync(self, interval_seconds=3600):
        """Launches a background daemon thread that crawls and aggregates feeds on a set interval."""
        def sync_worker():
            print("Background sync thread started.")
            # Run immediate sync on boot without LLM (pure background crawl)
            self.sync_all(run_llm=False)
            while True:
                time.sleep(interval_seconds)
                try:
                    self.sync_all(run_llm=False)
                except Exception as e:
                    print(f"Error in background sync loop: {e}")

        thread = threading.Thread(target=sync_worker, daemon=True)
        thread.start()
        return thread
