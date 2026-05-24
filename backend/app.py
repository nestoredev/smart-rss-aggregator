import os
import uvicorn
import feedparser
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.database import Database
from backend.discovery import discover_rss_feed
from backend.sync import SyncEngine

app = FastAPI(title="Smart RSS Aggregator", description="Apple Intelligence Local RSS Aggregator")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database and sync engine
base_dir = os.path.dirname(os.path.abspath(__file__))
db = Database(db_path=os.path.join(base_dir, "../reader.db"))
sync_engine = SyncEngine(db)

# Start hourly background crawl thread
sync_engine.start_background_sync(interval_seconds=3600)

# API Schemas
class FeedAddRequest(BaseModel):
    url: str

# --- API ENDPOINTS ---

@app.get("/api/feeds")
def get_feeds():
    """List all tracked RSS feeds."""
    return db.get_feeds()

@app.post("/api/feeds")
def add_feed(payload: FeedAddRequest):
    """Auto-discover RSS feed from domain, parse title, save, and trigger sync."""
    url = payload.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL cannot be empty")
        
    print(f"Adding feed for site: {url}")
    # Discover feed
    discovered_url = discover_rss_feed(url)
    if not discovered_url:
        raise HTTPException(status_code=400, detail="Could not auto-discover RSS feed from this domain")
        
    # Extract title
    try:
        parsed = feedparser.parse(discovered_url)
        title = parsed.feed.get('title', url)
    except Exception as e:
        print(f"Error parsing feed details: {e}")
        title = url
        
    # Save feed
    feed_id = db.add_feed(url=discovered_url, site_url=url, title=title)
    if not feed_id:
        raise HTTPException(status_code=500, detail="Failed to register feed in database")
        
    # Trigger a fast non-blocking crawl to fetch raw articles, letting the background worker consolidate them
    sync_engine.sync_all(run_llm=False)
    
    return {
        "id": feed_id,
        "url": discovered_url,
        "site_url": url,
        "title": title
    }

@app.delete("/api/feeds/{feed_id}")
def delete_feed(feed_id: int):
    """Remove feed and cascade-delete its crawled articles."""
    db.delete_feed(feed_id)
    return {"message": f"Feed {feed_id} successfully deleted"}

@app.get("/api/stories")
def get_stories():
    """Retrieve all synthesized Master Stories with source articles."""
    return db.get_master_stories()

@app.post("/api/sync")
def trigger_sync():
    """Manually trigger immediate crawler sync and reset database states to force re-consolidation."""
    if sync_engine.is_syncing:
        raise HTTPException(status_code=409, detail="Crawler is already working")
        
    # Reset master stories and mark articles as unaggregated so the background worker re-runs LLM consolidation
    print("[Server] Resetting database master stories to force LLM re-consolidation...")
    with db._get_connection() as conn:
        conn.execute("DELETE FROM master_stories")
        conn.execute("UPDATE articles SET master_story_id = NULL")
        conn.commit()
        
    # Trigger a fast non-blocking crawl to fetch raw articles, letting the background worker consolidate them
    sync_engine.sync_all(run_llm=False)
    return {"status": "success", "message": "Crawler sync completed. Background worker is consolidating stories."}

# --- FRONTEND ROUTING ---

# Serve CSS/JS Assets
@app.get("/assets/{filename}")
def get_assets(filename: str):
    asset_path = os.path.join(base_dir, "../frontend/assets", filename)
    if os.path.exists(asset_path):
        media_type = "application/javascript" if filename.endswith(".js") else None
        return FileResponse(
            asset_path, 
            media_type=media_type,
            headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}
        )
    raise HTTPException(status_code=404, detail="Asset not found")

# Serve Index SPA HTML
@app.get("/", response_class=HTMLResponse)
def get_index():
    index_path = os.path.join(base_dir, "../frontend/index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            content = f.read()
            return HTMLResponse(content=content, headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"})
    return "<h1>Frontend files are being built. Please check back in a few seconds!</h1>"

if __name__ == "__main__":
    uvicorn.run("backend.app:app", host="0.0.0.0", port=5005, reload=False)
