import feedparser
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse

def clean_url(url):
    """Normalize user-entered domain names to complete URLs."""
    url = url.strip()
    if not url.startswith(('http://', 'https://')):
        url = 'https://' + url
    return url

def is_valid_feed(url):
    """Checks if the URL points directly to a valid RSS or Atom feed."""
    try:
        parsed = feedparser.parse(url)
        # If feed has title or entries, it is already a direct RSS feed URL
        if parsed.feed and (parsed.feed.get('title') or len(parsed.entries) > 0):
            return True
    except Exception:
        pass
    return False

def discover_rss_feed(site_url):
    """
    Auto-discovers RSS/Atom feed links. If the site_url is already a valid feed,
    returns it directly. Otherwise crawls HTML head elements and tests common endpoints.
    """
    target_url = clean_url(site_url)
    
    # 1. Direct feed validation bypass
    if is_valid_feed(target_url):
        print(f"URL {target_url} is already a direct valid RSS feed. Skipping discovery.")
        return target_url
        
    parsed_base = urlparse(target_url)
    base_domain = f"{parsed_base.scheme}://{parsed_base.netloc}"
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    try:
        response = requests.get(target_url, headers=headers, timeout=10)
        response.raise_for_status()
    except Exception as e:
        print(f"Error requesting site {target_url}: {e}")
        # Try direct fallback
        return try_common_fallbacks(base_domain, headers)

    soup = BeautifulSoup(response.text, 'html.parser')
    
    # Common MIME types for RSS/Atom feeds
    feed_types = [
        'application/rss+xml',
        'application/atom+xml',
        'text/xml',
        'application/xml'
    ]
    
    discovered_feeds = []
    
    # 1. Search in <link> elements in head
    for link in soup.find_all('link'):
        rel = link.get('rel', [])
        if isinstance(rel, str):
            rel = [rel]
        
        # Check if it has 'alternate' in rel attributes
        if 'alternate' in [r.lower() for r in rel]:
            link_type = link.get('type', '').lower()
            if any(ft in link_type for ft in feed_types):
                href = link.get('href')
                if href:
                    absolute_url = urljoin(target_url, href)
                    discovered_feeds.append(absolute_url)
                    
    # Return first successful feed tag discovered
    if discovered_feeds:
        return discovered_feeds[0]
        
    # 2. Fall back to scanning <a> tags containing "rss" or "feed"
    for anchor in soup.find_all('a'):
        href = anchor.get('href', '')
        text = anchor.get_text().lower()
        if 'rss' in text or 'feed' in text or 'rss' in href.lower() or 'feed.xml' in href.lower():
            if href:
                absolute_url = urljoin(target_url, href)
                # Verify it is not just a social link
                if 'twitter.com' not in absolute_url and 'facebook.com' not in absolute_url:
                    return absolute_url

    # 3. Fall back to testing common feed endpoints
    return try_common_fallbacks(base_domain, headers)

def try_common_fallbacks(base_domain, headers):
    """Iterate and test standard subpaths that often serve RSS feeds."""
    fallbacks = [
        '/feed',
        '/rss',
        '/rss.xml',
        '/feed.xml',
        '/index.xml',
        '/atom.xml'
    ]
    
    for suffix in fallbacks:
        test_url = urljoin(base_domain, suffix)
        try:
            res = requests.head(test_url, headers=headers, allow_redirects=True, timeout=3)
            # 200 OK or similar XML content header check
            if res.status_code == 200:
                content_type = res.headers.get('Content-Type', '').lower()
                if 'xml' in content_type or 'rss' in content_type or 'atom' in content_type:
                    return test_url
        except Exception:
            continue
            
    # As a final resort, return the domain itself as feed (feedparser will fail gracefully if invalid)
    return base_domain
