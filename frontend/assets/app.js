// API Base URL - Dynamically resolves to match the client's access host (local, Tailscale, or domain)
const API_BASE = `${window.location.origin}/api`;

// App State Cache
let allFeeds = [];
let allStories = [];
let selectedFeedId = null;
let selectedCoverage = "all"; // Coverage filter state: 'all' | 'multi' | 'single'

// Initialize App Data and States
document.addEventListener("DOMContentLoaded", () => {
    renderCoverageButtonsUI(); // Set up button states
    fetchFeeds();
    fetchStories();
    
    // Poll stories every 10 seconds to catch live background sync updates
    setInterval(fetchStories, 10000);
});

// Helper: Format ISO Dates elegantly in user's local timezone
function formatDate(isoString) {
    if (!isoString) return "";
    let dateStr = isoString;
    // Standardize ISO timestamps without explicit offsets to treat as UTC (ensuring correct local translation)
    if (!dateStr.endsWith("Z") && !dateStr.includes("+") && !dateStr.includes("-")) {
        dateStr += "Z";
    }
    const date = new Date(dateStr);
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
                    <span class="text-xs font-bold truncate font-outfit">${escapeHTML(feed.title)}</span>
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
        const res = await fetch(`${API_BASE}/stories?t=${Date.now()}`);
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
        
        // Get absolute latest scan time based on published_at
        const times = allStories.map(s => {
            const dateVal = s.published_at || s.created_at;
            return new Date(dateVal + (dateVal.endsWith("Z") ? "" : "Z")).getTime();
        });
        const maxTime = new Date(Math.max(...times));
        scanSpan.textContent = maxTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

                <!-- Coverage Sources -->
                <div class="flex flex-col gap-2 border-t border-slate-900 pt-5">
                    <span class="text-[10px] uppercase font-bold tracking-wider text-slate-500 font-outfit">Review Original Coverage</span>
                    <div class="flex flex-wrap gap-2 mt-1">
                        ${story.articles.map(art => `
                            <div 
                                onclick="openReader(event, ${art.id}, ${story.id})" 
                                class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-950/50 hover:bg-purple-950/20 border border-slate-900 hover:border-purple-500/30 text-xs font-medium text-slate-300 hover:text-purple-300 transition-all duration-200 cursor-pointer select-none"
                            >
                                <span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                                <span class="font-semibold text-slate-200">${escapeHTML(art.source_name)}</span>
                                <span class="hidden sm:inline-block text-[10px] text-slate-500 font-light truncate max-w-[120px]">${escapeHTML(art.title)}</span>
                                <a 
                                    href="${art.url}" 
                                    target="_blank" 
                                    onclick="event.stopPropagation()"
                                    class="p-0.5 hover:text-slate-200 text-slate-500 hover:scale-105 active:scale-95 transition-all duration-150"
                                    title="Open original website directly in new tab"
                                >
                                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
                                    </svg>
                                </a>
                            </div>
                        `).join("")}
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
    
    // Set content
    document.getElementById("reader-title").textContent = article.title;
    document.getElementById("reader-source").textContent = article.source_name;
    document.getElementById("reader-date").textContent = formatDate(article.published_at);
    document.getElementById("reader-link").href = article.url;
    
    // Clean and set summary HTML
    const contentContainer = document.getElementById("reader-content");
    contentContainer.innerHTML = article.summary || "<p class='text-slate-500 italic'>No description provided in RSS feed.</p>";
    
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
    }, 300);
}
