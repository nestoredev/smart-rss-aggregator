# NexusFeed

A modern, AI-powered RSS and news aggregator that does more than just list articles. This application automatically fetches your favorite feeds, intelligently clusters related stories together, and generates concise AI summaries so you can digest the news faster and stay informed without the clutter.

## Key Features

- **Intelligent Clustering:** AI analyzes incoming articles and groups similar stories together, so you don't have to read the same breaking news multiple times from different sources.
- **AI-Powered Digests:** Get auto-generated summaries of story clusters. Understand the gist of a topic in seconds instead of reading multiple long-form articles.
- **Save for Later:** Bookmark individual stories to read them when you have more time. Your "Read Later" list is easily accessible from the navigation drawer.
- **Global & Source-Level "Mark as Read":** Keep your feed clean with easy options to archive articles you've already seen, either individually or in batches.
- **Dynamic & Responsive UI:** Built with modern web standards, featuring an intuitive sidebar, smooth animations, and a responsive layout that looks great on both desktop and mobile devices.
- **Automatic Background Sync:** Feeds are fetched and processed automatically in the background, ensuring your news is always up-to-date and displayed in your local timezone.

## How It Works

1. **Backend (Python):** A continuous background process (`sync.py`) polls RSS feeds, extracts content, and stores it in an SQLite database. It leverages an AI engine to group related articles into clusters and generates a comprehensive summary for each cluster.
2. **Frontend (HTML/Vanilla JS/CSS):** A sleek single-page application that connects to the backend API. It handles the local caching of feeds and stories, time conversions, and all user interactions like saving bookmarks and archiving read items.

## Setup & Running

*(Instructions for setting up the environment, installing dependencies, and running the backend and frontend servers would go here once finalized.)*
