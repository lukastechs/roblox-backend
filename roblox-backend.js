const express = require('express');
const axios = require('axios');
const cors = require('cors');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const cache = new NodeCache({ stdTTL: 300, checkperiod: 120 }); // Cache for 5 minutes

// Rate limiter: 100 requests per minute per IP
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // Limit each IP to 100 requests per window
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/roblox', limiter); // Apply to Roblox endpoints only

// Calculate account age in human-readable format
function calculateAccountAge(createdAt) {
  const now = new Date();
  const created = new Date(createdAt);
  const diffMs = now - created;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const years = Math.floor(diffDays / 365);
  const months = Math.floor((diffDays % 365) / 30);
  return years > 0 ? `${years} years, ${months} months` : `${months} months`;
}

// Calculate age in days
function calculateAgeDays(createdAt) {
  const now = new Date();
  const created = new Date(createdAt);
  const diffMs = now - created;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// Shared handler for fetching Roblox data
async function fetchRobloxData(username) {
  // Check cache first
  const cachedData = cache.get(username);
  if (cachedData) {
    console.log(`Cache hit for ${username}`);
    return cachedData;
  }

  // Get user ID and basic info
  const userSearch = await axios.post('https://users.roblox.com/v1/usernames/users', {
    usernames: [username],
    excludeBannedUsers: false,
  });
  const users = userSearch.data.data;
  if (users.length === 0) throw new Error('User not found');
  const basicUser = users[0];
  const userId = basicUser.id;

  // Get user info (includes created, description, verified, banned)
  const userInfoRes = await axios.get(`https://users.roblox.com/v1/users/${userId}`);
  const userInfo = userInfoRes.data;

  // Parallelize independent API calls
  const [
    followersRes,
    followingsRes,
    friendsRes,
    groupsRes,
    avatarRes,
    historyRes,
    presenceRes,
  ] = await Promise.allSettled([
    axios.get(`https://friends.roblox.com/v1/users/${userId}/followers/count`),
    axios.get(`https://friends.roblox.com/v1/users/${userId}/followings/count`),
    axios.get(`https://friends.roblox.com/v1/users/${userId}/friends/count`).catch(() => ({ data: { count: 0 } })),
    axios.get(`https://groups.roblox.com/v1/users/${userId}/groups/roles`).catch(() => ({ data: { data: [] } })),
    axios.get(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=420x420&format=Png&isCircular=false`)
      .catch(() => ({ data: { data: [{ imageUrl: 'https://via.placeholder.com/150' }] } })),
    axios.get(`https://users.roblox.com/v1/users/${userId}/username-history?limit=10&sortOrder=Asc`)
      .catch(() => ({ data: { data: [] } })),
    axios.post('https://presence.roblox.com/v1/presence/users', { userIds: [userId] })
      .catch(() => ({ data: { userPresences: [{ userPresenceType: null }] } })),
  ]);

  // Extract values with defaults
  const followers = followersRes.status === 'fulfilled' ? followersRes.value.data.count : 0;
  const followings = followingsRes.status === 'fulfilled' ? followingsRes.value.data.count : 0;
  const friends = friendsRes.status === 'fulfilled' ? friendsRes.value.data.count : 0;
  const groups_count = groupsRes.status === 'fulfilled' ? groupsRes.value.data.data.length : 0;
  const avatarUrl = avatarRes.status === 'fulfilled' ? avatarRes.value.data.data[0].imageUrl : 'https://via.placeholder.com/150';
  const previousUsernames = historyRes.status === 'fulfilled' ? historyRes.value.data.data.map(h => h.name) : [];

  let onlineStatus = 'Unknown';
  if (presenceRes.status === 'fulfilled') {
    const presence = presenceRes.value.data.userPresences[0];
    if (presence) {
      switch (presence.userPresenceType) {
        case 0: onlineStatus = 'Offline'; break;
        case 1: onlineStatus = 'Online'; break;
        case 2: onlineStatus = 'In Game'; break;
        case 3: onlineStatus = 'In Studio'; break;
      }
    }
  }

  const activeStatus = userInfo.isBanned ? 'Banned' : 'Active';
  const profile_link = `https://www.roblox.com/users/${userId}/profile`;

  // Compile response
  const response = {
    username: basicUser.name || username,
    display_name: basicUser.displayName || 'N/A',
    estimated_creation_date: userInfo.created ? new Date(userInfo.created).toLocaleDateString() : 'N/A',
    account_age: userInfo.created ? calculateAccountAge(userInfo.created) : 'N/A',
    age_days: userInfo.created ? calculateAgeDays(userInfo.created) : 0,
    followers: followers,
    followings: followings,
    friends: friends,
    groups_count: groups_count,
    verified: userInfo.hasVerifiedBadge || false,
    description: userInfo.description || 'N/A',
    user_id: userId,
    avatar: avatarUrl,
    previous_usernames: previousUsernames,
    active_status: activeStatus,
    online_status: onlineStatus,
    profile_link: profile_link,
  };

  // Cache the result
  cache.set(username, response);
  return response;
}

// Root endpoint
app.get('/', (req, res) => {
  res.send('Roblox Account Age Checker API is running');
});

// Roblox age checker endpoint (POST)
app.post('/api/roblox/:username', async (req, res) => {
  try {
    const data = await fetchRobloxData(req.params.username);
    res.json(data);
  } catch (error) {
    console.error('Roblox API Error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to fetch Roblox data' });
  }
});

// Roblox age checker endpoint (GET for testing)
app.get('/api/roblox/:username', async (req, res) => {
  try {
    const data = await fetchRobloxData(req.params.username);
    res.json(data);
  } catch (error) {
    console.error('Roblox API Error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to fetch Roblox data' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Roblox Server running on port ${PORT}`);
});
