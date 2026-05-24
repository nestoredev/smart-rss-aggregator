// API Base URL - Dynamically resolves to match the client's access host (local, Tailscale, or domain)
const API_BASE = `${window.location.origin}/api`;

// App State Cache
let allFeeds = [];
let allStories = [];
let selectedFeedId = null;
let selectedCoverage = "all"; // Coverage filter state: 'all' | 'multi' | 'single'
let activeFeedViewFilter = "unread"; // 'unread' | 'saved'
let currentArticleId = null;
let currentStoryId = null;

// Initialize App Data and States
document.addEventListener("DOMContentLoaded", () => {
    renderCoverageButtonsUI(); // Set up button states
    fetchFeeds();
    fetchStories();
    updateSavedBadgeCount(); // Fetch and render bookmarked count
    
    // Poll stories every 10 seconds to catch live background sync updates
    setInterval(fetchStories, 10000);
    setInterval(updateSavedBadgeCount, 10000); // Poll saved count
});

// Safari-safe ISO 8601 Parser (truncates microseconds to prevent Invalid Date on iOS/Safari)
function parseISOToLocalDate(isoString) {
    if (!isoString) return null;
    let dateStr = isoString;
    
    // Strip microseconds to exactly 3 decimal places for Safari compliance
    if (dateStr.includes(".")) {
        const parts = dateStr.split(".");
        let msPart = parts[1];
        let offset = "";
        if (msPart.endsWith("Z")) {
            offset = "Z";
            msPart = msPart.slice(0, -1);
        } else if (msPart.includes("+")) {
            const idx = msPart.indexOf("+");
            offset = msPart.substring(idx);
            msPart = msPart.substring(0, idx);
        } else if (msPart.includes("-")) {
            const idx = msPart.indexOf("-");
            offset = msPart.substring(idx);
            msPart = msPart.substring(0, idx);
        }
        dateStr = parts[0] + "." + msPart.substring(0, 3) + offset;
    }
    
    // Append UTC 'Z' if no explicit timezone offset is present (inspect timePart only to prevent date hyphen matches)
    const timePart = dateStr.includes("T") ? dateStr.split("T")[1] : dateStr;
    const hasOffset = dateStr.endsWith("Z") || timePart.includes("+") || timePart.includes("-");
    if (!hasOffset) {
        dateStr += "Z";
    }
    
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
}

// Helper: Format ISO Dates elegantly in user's local timezone
function formatDate(isoString) {
    const date = parseISOToLocalDate(isoString);
    if (!date) return "";
    return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}

// 1. Fetch Tracked RSS Feeds
async function fetchFeeds() {
    try {
        const res = await fetch(`${API_BASE}/feeds?t=${Date.now()}`);
        if (!res.ok) throw new Error("Failed to fetch feeds list");
        
        allFeeds = await res.json();
        renderFeedsUI();
        updateLastScannedTime(); // Update Last Scanned indicator using real fetch timestamps!
        
    } catch (err) {
        console.error("Error fetching feeds:", err);
    }
}

// Render the Feeds list sidebar
function renderFeedsUI() {
    const listContainer = document.getElementById("feeds-list");
    const countSpan = document.getElementById("feeds-count");
    
    countSpan.textContent = allFeeds.length;
    
    if (allFeeds.length === 0) {
        listContainer.innerHTML = `
            <div class="text-xs text-slate-500 text-center py-6">
                No sources added yet.
            </div>
        `;
        return;
    }
    
    listContainer.innerHTML = allFeeds.map(feed => {
        // Loose equality comparison to defend against string vs number differences
        const isActive = selectedFeedId == feed.id;
        const activeClass = isActive 
            ? "border-purple-500 bg-purple-950/30 shadow-lg shadow-purple-900/10 text-purple-200" 
            : "bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700/80";
            
        return `
            <div 
                onclick="toggleFeedFilter(${feed.id})"
                class="flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all duration-200 group ${activeClass}"
            >
                <div class="flex flex-col truncate pr-2">
                    <div class="flex items-center gap-2">
                        <span class="text-xs font-bold truncate font-outfit">${escapeHTML(feed.title)}</span>
                        ${feed.unread_count > 0 ? `<span class="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-300 font-bold leading-none">${feed.unread_count}</span>` : ''}
                    </div>
                    <span class="text-[9px] text-slate-500 truncate mt-0.5">${escapeHTML(feed.site_url)}</span>
                </div>
                <button 
                    onclick="deleteFeed(event, ${feed.id})" 
                    title="Remove Source"
                    class="text-slate-500 hover:text-rose-400 p-1.5 rounded-lg bg-slate-950/20 hover:bg-rose-500/10 opacity-60 group-hover:opacity-100 transition-all duration-150"
                >
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                    </svg>
                </button>
            </div>
        `;
    }).join("");
}

// 2. Fetch Aggregated Master Stories
async function fetchStories() {
    try {
        const res = await fetch(`${API_BASE}/stories?filter=${activeFeedViewFilter}&t=${Date.now()}`);
        if (!res.ok) throw new Error("Failed to fetch master stories");
        
        allStories = await res.json();
        renderStoriesUI();
        
    } catch (err) {
        console.error("Error fetching stories:", err);
    }
}

// Render the main pane master stories feed
function renderStoriesUI() {
    const feedContainer = document.getElementById("stories-feed");
    const countSpan = document.getElementById("stories-count");
    const statusSpan = document.getElementById("aggregator-status");
    const scanSpan = document.getElementById("last-scanned");
    const filterBanner = document.getElementById("filter-banner");
    
    // Filter stories based on selected source ID (using type-resilient double equals)
    let storiesToRender = allStories;
    if (selectedFeedId != null) {
        console.log(`Filtering stories for selectedFeedId: ${selectedFeedId} (type: ${typeof selectedFeedId})`);
        storiesToRender = allStories.filter(story => {
            const matches = story.articles.some(art => {
                console.log(` - Checking story article "${art.title}" (art.feed_id: ${art.feed_id}, type: ${typeof art.feed_id})`);
                return art.feed_id == selectedFeedId;
            });
            return matches;
        });
    }
    
    // Filter stories based on selected coverage level
    if (selectedCoverage === "multi") {
        storiesToRender = storiesToRender.filter(story => story.articles.length > 1);
    } else if (selectedCoverage === "single") {
        storiesToRender = storiesToRender.filter(story => story.articles.length === 1);
    }
    
    countSpan.textContent = `${storiesToRender.length} ${storiesToRender.length === 1 ? 'story' : 'stories'}`;
    
    // Render Filter Banner if source filter is active
    if (selectedFeedId != null) {
        const activeFeed = allFeeds.find(f => f.id == selectedFeedId);
        const sourceName = activeFeed ? activeFeed.title : "Selected Source";
        filterBanner.innerHTML = `
            <div class="flex items-center justify-between p-4 rounded-2xl bg-purple-950/20 border border-purple-500/20 text-xs font-semibold text-purple-300">
                <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></span>
                    <span>Filtering by Coverage: <strong class="text-purple-200">${escapeHTML(sourceName)}</strong></span>
                </div>
                <button 
                    onclick="clearFeedFilter()" 
                    class="px-3 py-1.5 rounded-lg bg-purple-950/40 border border-purple-500/30 hover:bg-purple-600 hover:text-white transition-all duration-150 font-bold uppercase tracking-wider text-[10px]"
                >
                    Clear Filter
                </button>
            </div>
        `;
        filterBanner.classList.remove("hidden");
    } else {
        filterBanner.classList.add("hidden");
    }
    
    if (allStories.length > 0) {
        statusSpan.textContent = "Idle";
        statusSpan.className = "text-xs font-semibold text-slate-200 mt-0.5";
    }
    
    if (storiesToRender.length === 0) {
        feedContainer.innerHTML = `
            <div class="glass-panel rounded-3xl p-12 text-center flex flex-col items-center justify-center gap-4 border-dashed border-2 border-slate-800">
                <div class="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center">
                    <svg class="w-8 h-8 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"></path>
                    </svg>
                </div>
                <div>
                    <h4 class="font-outfit font-bold text-base text-slate-300">
                        ${selectedFeedId != null ? 'No matching coverage found' : 'Feed is empty'}
                    </h4>
                    <p class="text-xs text-slate-500 mt-1 max-w-sm">
                        ${selectedFeedId != null 
                            ? 'No master stories contain articles from this specific source.' 
                            : 'Add feed source domains in the sidebar (e.g. macrumors.com) to trigger intelligent summary consolidation.'}
                    </p>
                </div>
            </div>
        `;
        return;
    }
    
    feedContainer.innerHTML = storiesToRender.map(story => {
        const hasMultipleSources = story.articles.length > 1;
        const isStorySaved = story.articles.every(a => a.is_saved);
        const uniqueAnglesHtml = story.unique_angles && story.unique_angles.length > 0
            ? `
                <div class="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/10 flex flex-col gap-2 mt-2">
                    <div class="flex items-center gap-2 text-amber-400">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                        </svg>
                        <span class="text-xs font-bold uppercase tracking-wider font-outfit">Differing Perspectives</span>
                    </div>
                    <div class="flex flex-col gap-1.5 pl-6 list-disc">
                        ${story.unique_angles.map(angle => `
                            <p class="text-xs text-amber-200/80 leading-relaxed font-light">${escapeHTML(angle)}</p>
                        `).join("")}
                    </div>
                </div>
            `
            : "";

        return `
            <div class="glass-panel intel-border-glow rounded-3xl p-5 sm:p-6 lg:p-8 flex flex-col gap-6 relative overflow-hidden group">
                <!-- Glow Gradient bar -->
                <div class="absolute left-0 top-0 bottom-0 w-[4px] bg-gradient-to-b from-blue-500 via-purple-500 to-pink-500 rounded-r"></div>

                <!-- Header -->
                <div class="flex flex-col gap-2">
                    <div class="flex items-center gap-3">
                        <span class="text-[10px] font-bold uppercase tracking-wider font-outfit text-purple-400 bg-purple-950/20 px-2.5 py-0.5 rounded-full border border-purple-500/10">
                            ${hasMultipleSources ? `✨ Consolidated Digest (${story.articles.length} Sources)` : '✨ Single Source Digest'}
                        </span>
                        <span class="text-slate-700">•</span>
                        <span class="text-[10px] text-slate-400 font-medium">${formatDate(story.published_at)}</span>
                    </div>
                    <h4 class="font-outfit font-extrabold text-xl text-slate-100 group-hover:text-white transition-colors mt-1">
                        ${escapeHTML(story.title)}
                    </h4>
                </div>

                <!-- Bullets -->
                <div class="flex flex-col gap-3.5 pl-2">
                    ${story.summary_bullets.map(bullet => `
                        <div class="flex items-start gap-3">
                            <span class="mt-2 w-1.5 h-1.5 rounded-full bg-purple-500 flex-shrink-0"></span>
                            <p class="text-sm text-slate-300 leading-relaxed font-light">${escapeHTML(bullet)}</p>
                        </div>
                    `).join("")}
                </div>

                <!-- Unique Angles Callout -->
                ${uniqueAnglesHtml}

                <!-- Coverage Sources & Actions -->
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-t border-slate-900 pt-5 mt-1">
                    <div class="flex flex-col gap-2">
                        <span class="text-[10px] uppercase font-bold tracking-wider text-slate-500 font-outfit">Review Original Coverage</span>
                        <div class="flex flex-wrap gap-2 mt-1">
                            ${story.articles.map(art => {
                                const isSaved = art.is_saved;
                                const dotColorClass = isSaved ? "bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.6)] animate-pulse" : "bg-blue-500";
                                
                                let borderClass = isSaved 
                                    ? "border-amber-500/30 bg-amber-950/20 text-amber-200 hover:border-amber-500/50 shadow-md shadow-amber-950/20" 
                                    : "bg-slate-950/50 border-slate-900 hover:border-purple-500/30 text-slate-300 hover:text-purple-300";
                                
                                if (art.is_read) {
                                    borderClass += " opacity-40 hover:opacity-100 transition-opacity duration-150";
                                }
                                
                                return `
                                    <div 
                                        onclick="openReader(event, ${art.id}, ${story.id})" 
                                        class="flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-all duration-200 cursor-pointer select-none ${borderClass}"
                                    >
                                        <span class="w-1.5 h-1.5 rounded-full ${dotColorClass}"></span>
                                        <span class="font-semibold">${escapeHTML(art.source_name)}</span>
                                        <span class="hidden sm:inline-block text-[10px] opacity-75 font-light truncate max-w-[120px]">${escapeHTML(art.title)}</span>
                                        
                                        <!-- Inline publication date/time in local timezone -->
                                        <span class="text-[9px] opacity-60 font-semibold bg-slate-950/60 px-1.5 py-0.5 rounded-md border border-slate-900/60 select-none">${formatArticleTime(art.published_at)}</span>
                                        
                                        <!-- Inline Toggle Read Button -->
                                        <button 
                                            onclick="toggleArticleReadInline(event, ${art.id}, ${story.id})"
                                            class="p-0.5 hover:text-emerald-400 text-slate-500 hover:scale-105 active:scale-95 transition-all duration-150 ml-1"
                                            title="${art.is_read ? 'Mark as Unread' : 'Mark as Read'}"
                                        >
                                            <svg class="w-3.5 h-3.5 ${art.is_read ? 'text-emerald-400' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                                            </svg>
                                        </button>

                                        <a 
                                            href="${art.url}" 
                                            target="_blank" 
                                            onclick="event.stopPropagation()"
                                            class="p-0.5 hover:text-slate-200 text-slate-500 hover:scale-105 active:scale-95 transition-all duration-150"
                                            title="Open original website directly in new tab"
                                        >
                                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
                                            </svg>
                                        </a>
                                    </div>
                                `;
                            }).join("")}
                        </div>
                    </div>
                    
                    <div class="flex items-center gap-2.5 self-start sm:self-center">
                        <!-- Archive Story Button -->
                        <button 
                            onclick="markStoryAsRead(event, ${story.id})" 
                            class="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-purple-950/30 border border-purple-500/20 hover:bg-purple-600 hover:border-purple-500 hover:text-white transition-all duration-150 text-xs font-bold uppercase tracking-wider text-purple-300 cursor-pointer active:scale-95 shadow-sm"
                            title="Mark all articles in this story as read"
                        >
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                            </svg>
                            <span>Archive</span>
                        </button>
                        
                        <!-- Save Story / Read Later Button -->
                        <button 
                            onclick="toggleStorySave(event, ${story.id})" 
                            class="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl border transition-all duration-150 text-xs font-bold uppercase tracking-wider cursor-pointer active:scale-95 shadow-sm ${isStorySaved ? 'border-amber-500/30 bg-amber-950/20 text-amber-300 hover:text-amber-200 hover:bg-amber-900/30' : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:text-white hover:bg-slate-800/60'}"
                            title="${isStorySaved ? 'Remove story from Read Later' : 'Add story to Read Later'}"
                        >
                            <svg class="w-3.5 h-3.5 ${isStorySaved ? 'text-amber-400 fill-amber-400' : 'text-slate-400'}" fill="${isStorySaved ? 'currentColor' : 'none'}" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"></path>
                            </svg>
                            <span>${isStorySaved ? 'Saved' : 'Save Story'}</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join("");
}

// Toggle active source filter (using loose inequality checks)
function toggleFeedFilter(feedId) {
    if (selectedFeedId == feedId) {
        selectedFeedId = null; // Deselect
    } else {
        selectedFeedId = feedId; // Select
    }
    renderFeedsUI();
    renderStoriesUI();
    closeMobileSidebar(); // Auto-close sidebar panel on mobile devices
}

// Reset/Clear source filter
function clearFeedFilter() {
    selectedFeedId = null;
    renderFeedsUI();
    renderStoriesUI();
    closeMobileSidebar(); // Auto-close sidebar panel on mobile devices
}

// Set coverage filter ('all' | 'multi' | 'single')
function setCoverageFilter(type) {
    selectedCoverage = type;
    renderCoverageButtonsUI();
    renderStoriesUI();
    closeMobileSidebar(); // Auto-close sidebar panel on mobile devices
}

// Render active state style on coverage selector buttons
function renderCoverageButtonsUI() {
    const types = ["all", "multi", "single"];
    types.forEach(t => {
        const btn = document.getElementById(`filter-coverage-${t}`);
        if (!btn) return;
        if (selectedCoverage === t) {
            btn.className = "px-3 py-1.5 rounded-lg text-purple-300 bg-purple-950/40 border border-purple-500/20 shadow-sm transition-all duration-200";
        } else {
            btn.className = "px-3 py-1.5 rounded-lg hover:text-slate-200 transition-all duration-200";
        }
    });
}

// 3. Add a New Source Domain
async function addFeed(e) {
    e.preventDefault();
    const urlInput = document.getElementById("feed-url");
    const addBtn = document.getElementById("add-feed-btn");
    const statusSpan = document.getElementById("aggregator-status");
    const domain = urlInput.value.trim();
    
    if (!domain) return;
    
    addBtn.disabled = true;
    addBtn.innerHTML = `
        <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
        <span>Discovering...</span>
    `;
    
    // Show loader on main feed
    document.getElementById("feed-loader").classList.remove("hidden");
    
    try {
        const res = await fetch(`${API_BASE}/feeds`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: domain })
        });
        
        if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.detail || "Discovery failed");
        }
        
        urlInput.value = "";
        await fetchFeeds();
        await fetchStories();
        
    } catch (err) {
        alert(`Failed to add feed: ${err.message}`);
    } finally {
        document.getElementById("feed-loader").classList.add("hidden");
        statusSpan.textContent = "Idle";
        statusSpan.className = "text-xs font-semibold text-slate-200 mt-0.5";
        addBtn.disabled = false;
        addBtn.innerHTML = `<span>Discover & Add</span>`;
    }
}

// 4. Delete Source Feed
async function deleteFeed(event, feedId) {
    // Prevent triggering the parent filter onclick toggle handler
    event.stopPropagation();
    
    if (!confirm("Are you sure you want to remove this source and all its articles?")) return;
    
    try {
        const res = await fetch(`${API_BASE}/feeds/${feedId}`, {
            method: "DELETE"
        });
        if (!res.ok) throw new Error("Delete failed");
        
        // If the deleted feed was selected, clear the active filter
        if (selectedFeedId == feedId) {
            selectedFeedId = null;
        }
        
        await fetchFeeds();
        await fetchStories();
    } catch (err) {
        alert(err.message);
    }
}

// 5. Trigger Manual Feed Sync
async function triggerSync() {
    const syncBtn = document.getElementById("sync-btn");
    const syncIcon = document.getElementById("sync-icon");
    const syncText = document.getElementById("sync-text");
    const statusSpan = document.getElementById("aggregator-status");
    
    syncBtn.disabled = true;
    syncIcon.classList.add("animate-spin");
    syncText.textContent = "Synchronizing...";
    
    statusSpan.textContent = "Syncing Feeds";
    statusSpan.className = "text-xs font-semibold text-purple-400 animate-pulse mt-0.5";
    
    // Show loading spinner on feed
    document.getElementById("feed-loader").classList.remove("hidden");
    
    try {
        const res = await fetch(`${API_BASE}/sync`, { method: "POST" });
        if (!res.ok) throw new Error("Sync failed");
        
        await fetchFeeds();
        await fetchStories();
        
    } catch (err) {
        alert(err.message);
    } finally {
        document.getElementById("feed-loader").classList.add("hidden");
        syncBtn.disabled = false;
        syncIcon.classList.remove("animate-spin");
        syncText.textContent = "Force Sync Feeds";
        statusSpan.textContent = "Idle";
        statusSpan.className = "text-xs font-semibold text-slate-200 mt-0.5";
    }
}

// Helper: Escape HTML to prevent XSS
function escapeHTML(str) {
    if (!str) return "";
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// --- RESPONSIVE MOBILE SIDEBAR CONTROLLERS ---

// Toggle mobile slide-out sidebar panel and overlay background
function toggleMobileSidebar() {
    const sidebar = document.querySelector("aside");
    const overlay = document.getElementById("sidebar-overlay");
    if (!sidebar || !overlay) return;
    
    if (sidebar.classList.contains("-translate-x-full")) {
        sidebar.classList.remove("-translate-x-full");
        overlay.classList.remove("hidden");
    } else {
        sidebar.classList.add("-translate-x-full");
        overlay.classList.add("hidden");
    }
}

// Auto-close slide-out sidebar panel when feed elements are interacted with on mobile
function closeMobileSidebar() {
    const sidebar = document.querySelector("aside");
    const overlay = document.getElementById("sidebar-overlay");
    if (!sidebar || !overlay) return;
    
    if (!sidebar.classList.contains("-translate-x-full")) {
        sidebar.classList.add("-translate-x-full");
        overlay.classList.add("hidden");
    }
}

// --- ARTICLE READER DRAWER CONTROLLERS ---

// Open Article Reader Drawer
function openReader(event, articleId, storyId) {
    if (event) event.stopPropagation();
    
    // Find the story containing the article
    const story = allStories.find(s => s.id === storyId);
    if (!story) return;
    
    // Find the article inside the story
    const article = story.articles.find(a => a.id === articleId);
    if (!article) return;
    
    // Cache active identifiers for footer toggles
    currentArticleId = articleId;
    currentStoryId = storyId;
    
    // Set content
    document.getElementById("reader-title").textContent = article.title;
    document.getElementById("reader-source").textContent = article.source_name;
    document.getElementById("reader-date").textContent = formatDate(article.published_at);
    document.getElementById("reader-link").href = article.url;
    
    // Clean and set summary HTML
    const contentContainer = document.getElementById("reader-content");
    contentContainer.innerHTML = article.summary || "<p class='text-slate-500 italic'>No description provided in RSS feed.</p>";
    
    // Update Control Buttons (Read and Bookmark States)
    updateReaderButtonsUI(article);
    
    // Display Drawer
    const drawer = document.getElementById("reader-drawer");
    const overlay = document.getElementById("reader-overlay");
    const panel = document.getElementById("reader-panel");
    
    drawer.classList.remove("hidden");
    // Small delay to allow the browser to register the hidden class removal before initiating CSS transitions
    setTimeout(() => {
        drawer.classList.remove("pointer-events-none");
        drawer.classList.add("opacity-100");
        overlay.classList.remove("opacity-0");
        overlay.classList.add("opacity-100");
        panel.classList.remove("translate-x-full");
    }, 15);
}

// Update the buttons inside the Reading Drawer based on article states
function updateReaderButtonsUI(article) {
    const readBtn = document.getElementById("reader-read-btn");
    const saveBtn = document.getElementById("reader-save-btn");
    
    if (!readBtn || !saveBtn) return;
    
    // 1. Mark as Read Button
    if (article.is_read) {
        readBtn.className = "flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-800 bg-slate-900/60 text-slate-400 hover:text-white hover:bg-slate-800/60 transition-all duration-150 text-xs font-bold uppercase tracking-wider cursor-pointer";
        readBtn.innerHTML = `
            <svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path>
            </svg>
            <span id="reader-read-text">Mark as Unread</span>
        `;
    } else {
        readBtn.className = "flex items-center gap-2 px-4 py-2.5 rounded-xl border border-purple-500/20 bg-purple-950/20 text-purple-300 hover:text-white hover:bg-purple-900/30 transition-all duration-150 text-xs font-bold uppercase tracking-wider cursor-pointer";
        readBtn.innerHTML = `
            <svg class="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
            </svg>
            <span id="reader-read-text">Mark as Read</span>
        `;
    }
    
    // 2. Save for Later Button
    if (article.is_saved) {
        saveBtn.className = "flex items-center gap-2 px-4 py-2.5 rounded-xl border border-amber-500/30 bg-amber-950/20 text-amber-300 hover:text-amber-200 hover:bg-amber-900/30 transition-all duration-150 text-xs font-bold uppercase tracking-wider cursor-pointer";
        saveBtn.innerHTML = `
            <svg id="reader-save-icon" class="w-4 h-4 text-amber-400 fill-amber-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"></path>
            </svg>
            <span id="reader-save-text">Saved</span>
        `;
    } else {
        saveBtn.className = "flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-800 bg-slate-900/60 text-slate-300 hover:text-white hover:bg-slate-800/60 transition-all duration-150 text-xs font-bold uppercase tracking-wider cursor-pointer";
        saveBtn.innerHTML = `
            <svg id="reader-save-icon" class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"></path>
            </svg>
            <span id="reader-save-text">Save for Later</span>
        `;
    }
}

// Close Article Reader Drawer
function closeReaderDrawer() {
    const drawer = document.getElementById("reader-drawer");
    const overlay = document.getElementById("reader-overlay");
    const panel = document.getElementById("reader-panel");
    
    panel.classList.add("translate-x-full");
    overlay.classList.remove("opacity-100");
    overlay.classList.add("opacity-0");
    drawer.classList.remove("opacity-100");
    drawer.classList.add("pointer-events-none");
    
    setTimeout(() => {
        drawer.classList.add("hidden");
        // Reset cached active identifiers when closed
        currentArticleId = null;
        currentStoryId = null;
    }, 300);
}

// --- READER STATE MANAGER & FILTER ACTIONS ---

// Set feed view filter mode ('unread' | 'saved')
function setFeedViewFilter(view) {
    if (view !== "unread" && view !== "saved") return;
    
    activeFeedViewFilter = view;
    
    // Toggle active style on navigation buttons
    const unreadBtn = document.getElementById("filter-view-unread");
    const savedBtn = document.getElementById("filter-view-saved");
    
    if (unreadBtn && savedBtn) {
        if (view === "unread") {
            // Unread Active
            unreadBtn.className = "w-full flex items-center justify-between py-2.5 px-4 rounded-xl border border-purple-500/20 bg-purple-950/20 text-sm font-semibold text-purple-200 hover:text-white transition-all duration-200 select-none shadow-sm cursor-pointer";
            // Saved Inactive
            savedBtn.className = "w-full flex items-center justify-between py-2.5 px-4 rounded-xl border border-slate-800 bg-slate-900/60 hover:bg-slate-800/50 text-sm font-semibold text-slate-300 hover:text-white transition-all duration-200 select-none cursor-pointer";
        } else {
            // Unread Inactive
            unreadBtn.className = "w-full flex items-center justify-between py-2.5 px-4 rounded-xl border border-slate-800 bg-slate-900/60 hover:bg-slate-800/50 text-sm font-semibold text-slate-300 hover:text-white transition-all duration-200 select-none cursor-pointer";
            // Saved Active
            savedBtn.className = "w-full flex items-center justify-between py-2.5 px-4 rounded-xl border border-amber-500/20 bg-amber-950/20 text-sm font-semibold text-amber-200 hover:text-white transition-all duration-200 select-none shadow-sm cursor-pointer";
        }
    }
    
    // Refetch stories to load the corresponding database state
    fetchStories();
}

// Fetch bookmark (Read Later) count from database and update badge
async function updateSavedBadgeCount() {
    try {
        const res = await fetch(`${API_BASE}/articles/saved/count?t=${Date.now()}`);
        if (!res.ok) throw new Error("Failed to fetch saved count");
        
        const data = await res.json();
        const badge = document.getElementById("saved-badge");
        
        if (badge) {
            badge.textContent = data.count;
            if (data.count > 0) {
                badge.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-950/40 border border-amber-500/30 text-amber-400 font-bold shadow-[0_0_8px_rgba(245,158,11,0.15)] animate-pulse";
            } else {
                badge.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-950/60 border border-slate-800 text-slate-400 font-bold";
            }
        }
    } catch (err) {
        console.error("Error updating saved badge count:", err);
    }
}

// Toggle read state of the currently open article in reader
async function toggleCurrentArticleReadState() {
    if (!currentArticleId || !currentStoryId) return;
    
    // Find the current article in cached stories
    const story = allStories.find(s => s.id === currentStoryId);
    if (!story) return;
    
    const article = story.articles.find(a => a.id === currentArticleId);
    if (!article) return;
    
    const newReadState = !article.is_read;
    
    try {
        const res = await fetch(`${API_BASE}/articles/${currentArticleId}/read`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: newReadState })
        });
        
        if (!res.ok) throw new Error("Failed to update read state");
        
        // Optimistically update local article state in cache
        article.is_read = newReadState;
        
        // Update Drawer buttons instantly
        updateReaderButtonsUI(article);
        
        // Refresh master stories and feeds in the background
        await fetchStories();
        await fetchFeeds();
        
    } catch (err) {
        alert(`Failed to update read state: ${err.message}`);
    }
}

// Toggle saved (Read Later) bookmark state of currently open article in reader
async function toggleCurrentArticleSaveState() {
    if (!currentArticleId || !currentStoryId) return;
    
    // Find the current article in cached stories
    const story = allStories.find(s => s.id === currentStoryId);
    if (!story) return;
    
    const article = story.articles.find(a => a.id === currentArticleId);
    if (!article) return;
    
    const newSaveState = !article.is_saved;
    
    try {
        const res = await fetch(`${API_BASE}/articles/${currentArticleId}/save`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: newSaveState })
        });
        
        if (!res.ok) throw new Error("Failed to update saved state");
        
        // Optimistically update local article state in cache
        article.is_saved = newSaveState;
        
        // Update Drawer buttons instantly
        updateReaderButtonsUI(article);
        
        // Refresh saved count indicators and master stories in the background
        await updateSavedBadgeCount();
        await fetchStories();
        
    } catch (err) {
        alert(`Failed to update save state: ${err.message}`);
    }
}

// Toggle read state of an article directly inline from the main view feed card
async function toggleArticleReadInline(event, articleId, storyId) {
    if (event) event.stopPropagation(); // Avoid triggering openReader
    
    const story = allStories.find(s => s.id === storyId);
    if (!story) return;
    
    const article = story.articles.find(a => a.id === articleId);
    if (!article) return;
    
    const newReadState = !article.is_read;
    
    try {
        const res = await fetch(`${API_BASE}/articles/${articleId}/read`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: newReadState })
        });
        
        if (!res.ok) throw new Error("Failed to update read state");
        
        // Optimistically update local article state in cache
        article.is_read = newReadState;
        
        // If this article was currently loaded in the open reader, sync reader drawer controls as well
        if (currentArticleId === articleId) {
            updateReaderButtonsUI(article);
        }
        
        // Refresh master stories and feed counts
        await fetchStories();
        await fetchFeeds();
        
    } catch (err) {
        console.error("Failed to toggle read state inline:", err);
    }
}

// Mark all articles in a consolidated story as read in a single batch call from card header
async function markStoryAsRead(event, storyId) {
    if (event) event.stopPropagation(); // Avoid triggering card drawer
    
    const story = allStories.find(s => s.id === storyId);
    if (!story) return;
    
    // Get all articles in this story that are currently unread
    const unreadArticles = story.articles.filter(a => !a.is_read);
    if (unreadArticles.length === 0) return;
    
    try {
        // Run parallel API updates
        await Promise.all(unreadArticles.map(art => 
            fetch(`${API_BASE}/articles/${art.id}/read`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ state: true })
            })
        ));
        
        // Optimistically mark them read in cache
        unreadArticles.forEach(art => { 
            art.is_read = true; 
            // Sync reader drawer controls if this specific article is currently open
            if (currentArticleId === art.id) {
                updateReaderButtonsUI(art);
            }
        });
        
        // Refresh master stories and feed counts
        await fetchStories();
        await fetchFeeds();
        
    } catch (err) {
        console.error("Error marking story articles as read:", err);
    }
}

// Mark all articles in the current view as read (supports full feed or specific source filters)
async function markAllArticlesAsRead() {
    // 1. Filter the stories exactly like renderStoriesUI does
    let storiesToFilter = allStories;
    if (selectedFeedId != null) {
        storiesToFilter = allStories.filter(story => 
            story.articles.some(art => art.feed_id == selectedFeedId)
        );
    }
    
    if (selectedCoverage === "multi") {
        storiesToFilter = storiesToFilter.filter(story => story.articles.length > 1);
    } else if (selectedCoverage === "single") {
        storiesToFilter = storiesToFilter.filter(story => story.articles.length === 1);
    }
    
    // 2. Extract unread articles we want to mark as read
    let targetArticles = [];
    storiesToFilter.forEach(story => {
        story.articles.forEach(art => {
            if (!art.is_read) {
                // If a source filter is selected, only target articles from that source
                if (selectedFeedId == null || art.feed_id == selectedFeedId) {
                    targetArticles.push(art);
                }
            }
        });
    });
    
    if (targetArticles.length === 0) return;
    
    // Confirm if marking a large set of items as read to prevent accidental triggers
    if (targetArticles.length > 5 && !confirm(`Are you sure you want to mark all ${targetArticles.length} items in the current view as read?`)) {
        return;
    }
    
    // 3. Update UI button to loading state
    const markBtn = document.getElementById("mark-all-read-btn");
    const markText = document.getElementById("mark-all-read-text");
    if (markBtn && markText) {
        markBtn.disabled = true;
        markText.textContent = "Marking read...";
    }
    
    try {
        // Run updates in parallel
        await Promise.all(targetArticles.map(art => 
            fetch(`${API_BASE}/articles/${art.id}/read`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ state: true })
            })
        ));
        
        // Optimistically update cache
        targetArticles.forEach(art => {
            art.is_read = true;
            if (currentArticleId === art.id) {
                updateReaderButtonsUI(art);
            }
        });
        
        // Refresh master stories and feed counts
        await fetchStories();
        await fetchFeeds();
        
    } catch (err) {
        console.error("Failed to mark all articles as read:", err);
    } finally {
        if (markBtn && markText) {
            markBtn.disabled = false;
            markText.textContent = "Mark All as Read";
        }
    }
}

// Helper: Format article post time in user's local timezone with intelligent relative tags
function formatArticleTime(isoString) {
    const date = parseISOToLocalDate(isoString);
    if (!date) return "";
    
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    // Check if yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();
    
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    
    if (isToday) {
        return `Today at ${timeStr}`;
    } else if (isYesterday) {
        return `Yesterday at ${timeStr}`;
    } else {
        const datePart = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        return `${datePart} at ${timeStr}`;
    }
}

// Fetch actual scan time from feeds data and render in user local timezone
function updateLastScannedTime() {
    const scanSpan = document.getElementById("last-scanned");
    if (!scanSpan) return;
    if (!allFeeds || allFeeds.length === 0) {
        scanSpan.textContent = "Never";
        return;
    }
    
    // Extract last_fetched values that are non-null
    const fetchedTimes = allFeeds
        .map(f => f.last_fetched)
        .filter(t => t != null);
        
    if (fetchedTimes.length === 0) {
        scanSpan.textContent = "Never";
        return;
    }
    
    // Parse dates safely using parseISOToLocalDate
    const timestamps = fetchedTimes.map(t => {
        const date = parseISOToLocalDate(t);
        return date ? date.getTime() : 0;
    }).filter(time => time > 0);
    
    if (timestamps.length === 0) {
        scanSpan.textContent = "Never";
        return;
    }
    
    const maxTimestamp = Math.max(...timestamps);
    const maxDate = new Date(maxTimestamp);
    // Format using our beautiful local-time-aware relative formatter
    scanSpan.textContent = formatArticleTime(maxDate.toISOString());
}

// Toggle saved bookmark state of all articles inside a master story
async function toggleStorySave(event, storyId) {
    if (event) event.stopPropagation(); // Prevent opening card reader drawer
    
    const story = allStories.find(s => s.id === storyId);
    if (!story) return;
    
    const isCurrentlySaved = story.articles.every(a => a.is_saved);
    const targetSaveState = !isCurrentlySaved;
    
    try {
        // Run parallel API bookmark updates
        await Promise.all(story.articles.map(art => 
            fetch(`${API_BASE}/articles/${art.id}/save`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ state: targetSaveState })
            })
        ));
        
        // Optimistically update all articles in the story
        story.articles.forEach(art => {
            art.is_saved = targetSaveState;
            // Sync reader drawer controls if this specific article is currently open
            if (currentArticleId === art.id) {
                updateReaderButtonsUI(art);
            }
        });
        
        // Refresh dynamic UI elements
        await updateSavedBadgeCount();
        await fetchStories();
        
    } catch (err) {
        console.error("Error toggling story save state:", err);
    }
}
