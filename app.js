// Browser compatibility: Use browser namespace for cross-browser support
const browserAPI = typeof chrome !== 'undefined' ? chrome : browser;

// Initialize arrays
let followers = [];
let followings = [];
let unfollowers = [];

// DOM elements
const getUnfollowersBtnEl = document.getElementById('get-unfollowers');
const unfollowersEl = document.getElementById('unfollowers');
const headerEl = document.getElementById('header');
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const filterEl = document.getElementById('filter');
const toggleHistoryBtnEl = document.getElementById('toggle-history');
const historyEl = document.getElementById('history');

// Message listener for page source
browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getSource") {
        try {
            // Parse Instagram's shared data
            const match = request.source.match(/"XIGSharedData",\[\],\{"raw":"(.*?)","native":/);
            if (!match) throw new Error("Failed to parse Instagram data");
            const script = JSON.parse(JSON.parse(match[1]));
            const loggedUser = script.config.viewer;
            if (!loggedUser) throw new Error("User not logged in");
            init(loggedUser);
        } catch (error) {
            showError("Error parsing Instagram data. Please ensure you're logged in.");
            console.error(error);
        }
    }
});

// Check if on Instagram
browserAPI.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentTab = tabs[0];
    if (!currentTab.url.includes('instagram.com')) {
        showError("Please navigate to instagram.com to use this extension!");
    } else {
        browserAPI.scripting.executeScript({
            target: { tabId: currentTab.id },
            func: () => {
                browserAPI.runtime.sendMessage({
                    action: "getSource",
                    source: document.documentElement.outerHTML
                });
            }
        });
    }
});

// Initialize the app
function init(loggedUser) {
    unfollowers = JSON.parse(localStorage.getItem(`IUF-unfollowers[${loggedUser.username}]`)) || [];
    followers = JSON.parse(localStorage.getItem(`IUF-followers[${loggedUser.username}]`)) || [];
    getUnfollowersBtnEl.classList.remove('hidden');

    if (unfollowers.length) {
        headerEl.textContent = `Total unfollowers: ${unfollowers.length}`;
        renderUnfollowers(unfollowers);
    }

    getUnfollowersBtnEl.addEventListener('click', () => fetchUnfollowers(loggedUser));
    filterEl.addEventListener('input', () => {
        const filtered = unfollowers.filter(user =>
            user.username.toLowerCase().includes(filterEl.value.toLowerCase()) ||
            user.name.toLowerCase().includes(filterEl.value.toLowerCase())
        );
        renderUnfollowers(filtered);
    });

    toggleHistoryBtnEl.addEventListener('click', () => {
        historyEl.classList.toggle('hidden');
        toggleHistoryBtnEl.textContent = historyEl.classList.contains('hidden') ? 'Show History' : 'Hide History';
        if (!historyEl.classList.contains('hidden') && historyEl.innerHTML === '') {
            renderHistory(loggedUser.username);
        }
    });
}

// Fetch unfollowers
async function fetchUnfollowers(user) {
    try {
        resetState();
        showLoading(true);
        followers = [];
        followings = [];
        unfollowers = [];
        await getFollowers(user);
        await getFollowings(user);
        setUnfollowers(user.username);
        showLoading(false);
    } catch (error) {
        showError("Failed to fetch unfollowers. Please try again.");
        console.error(error);
        showLoading(false);
        getUnfollowersBtnEl.classList.remove('hidden');
    }
}

// Get followers
async function getFollowers(user, after = null) {
    const cacheKey = `IUF-followers[${user.username}]`;
    const cacheTimestampKey = `IUF-followers-timestamp[${user.username}]`;
    const cachedFollowers = JSON.parse(localStorage.getItem(cacheKey));
    const cachedTimestamp = localStorage.getItem(cacheTimestampKey);
    const cacheAge = cachedTimestamp ? (Date.now() - parseInt(cachedTimestamp)) / (1000 * 60 * 60) : Infinity;

    if (cachedFollowers && cacheAge < 24) {
        followers = cachedFollowers;
        return;
    }

    const response = await axios.get(`https://www.instagram.com/graphql/query/?query_hash=c76146de99bb02f6415203be841dd25a&variables=${encodeURIComponent(JSON.stringify({
        id: user.id,
        include_reel: false,
        fetch_mutual: false,
        first: 100,
        after
    }))}`);

    followers.push(...response.data.data.user.edge_followed_by.edges.map(user => Number(user.node.id)));
    if (response.data.data.user.edge_followed_by.page_info.has_next_page) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        await getFollowers(user, response.data.data.user.edge_followed_by.page_info.end_cursor);
    }

    localStorage.setItem(cacheKey, JSON.stringify(followers));
    localStorage.setItem(cacheTimestampKey, Date.now().toString());
}

// Get followings
async function getFollowings(user, after = null) {
    const response = await axios.get(`https://www.instagram.com/graphql/query/?query_hash=d04b0a864b4b54837c0d870b0e77e076&variables=${encodeURIComponent(JSON.stringify({
        id: user.id,
        include_reel: false,
        fetch_mutual: false,
        first: 100,
        after
    }))}`);

    followings.push(...response.data.data.user.edge_follow.edges.map(user => ({
        id: Number(user.node.id),
        name: user.node.full_name,
        username: user.node.username
    })));
    if (response.data.data.user.edge_follow.page_info.has_next_page) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        await getFollowings(user, response.data.data.user.edge_follow.page_info.end_cursor);
    }
}

// Set unfollowers and update history
function setUnfollowers(username) {
    const previousUnfollowers = JSON.parse(localStorage.getItem(`IUF-unfollowers[${username}]`)) || [];
    const history = JSON.parse(localStorage.getItem(`IUF-unfollower-history[${username}]`)) || [];
    const currentDate = new Date().toISOString();

    unfollowers = followings.filter(following => !followers.includes(following.id));

    // Identify new unfollowers
    const newUnfollowers = unfollowers.filter(user => !previousUnfollowers.some(prev => prev.id === user.id));
    newUnfollowers.forEach(user => {
        history.push({
            id: user.id,
            name: user.name,
            username: user.username,
            date: currentDate
        });
    });

    localStorage.setItem(`IUF-unfollowers[${username}]`, JSON.stringify(unfollowers));
    localStorage.setItem(`IUF-unfollower-history[${username}]`, JSON.stringify(history));
    headerEl.textContent = `Total unfollowers: ${unfollowers.length}`;
    renderUnfollowers(unfollowers);

    if (newUnfollowers.length > 0) {
        showError(`${newUnfollowers.length} new unfollower(s) detected!`);
    }
}

// Render unfollowers
function renderUnfollowers(users) {
    unfollowersEl.innerHTML = '';
    users.forEach((user, index) => {
        const p = document.createElement('p');
        p.className = 'text-lg';
        p.innerHTML = `${index + 1}. <a href="https://instagram.com/${user.username}/" target="_blank">${user.name || user.username} (@${user.username})</a>`;
        unfollowersEl.appendChild(p);
    });
}

// Render unfollower history
function renderHistory(username) {
    const history = JSON.parse(localStorage.getItem(`IUF-unfollower-history[${username}]`)) || [];
    historyEl.innerHTML = '';
    if (history.length === 0) {
        historyEl.innerHTML = '<p class="text-gray-500">No unfollower history available.</p>';
        return;
    }
    history.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach((user, index) => {
        const p = document.createElement('p');
        p.className = 'text-sm history-item';
        p.innerHTML = `${index + 1}. <a href="https://instagram.com/${user.username}/" target="_blank">${user.name || user.username} (@${user.username})</a> - ${new Date(user.date).toLocaleString()}`;
        historyEl.appendChild(p);
    });
}

// Utility functions
function showLoading(show) {
    loadingEl.classList.toggle('hidden', !show);
    getUnfollowersBtnEl.classList.toggle('hidden', show);
}

function showError(message) {
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
    setTimeout(() => errorEl.classList.add('hidden'), 5000);
}

function resetState() {
    errorEl.classList.add('hidden');
    unfollowersEl.innerHTML = '';
    historyEl.innerHTML = '';
    headerEl.textContent = 'Fetching unfollowers... Please wait!';
}