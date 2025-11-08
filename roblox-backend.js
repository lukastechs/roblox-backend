const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

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

// Root endpoint
app.get('/', (req, res) => {
  res.send('Roblox Account Age Checker API is running');
});

// Roblox age checker endpoint (POST for frontend, no reCAPTCHA)
app.post('/api/roblox/:username', async (req, res) => {
  try {
    const username = req.params.username;
    // Get user ID and basic info from username
    const userSearch = await axios.post('https://users.roblox.com/v1/usernames/users', {
      usernames: [username],
      excludeBannedUsers: false
    });
    const users = userSearch.data.data;
    if (users.length === 0) throw new Error('User not found');
    const basicUser = users[0];
    const userId = basicUser.id;

    // Get detailed user info
    const userInfoRes = await axios.get(`https://users.roblox.com/v1/users/${userId}`);
    const userInfo = userInfoRes.data;

    // Followers count
    const followersRes = await axios.get(`https://friends.roblox.com/v1/users/${userId}/followers/count`);
    const followers = followersRes.data.count;

    // Followings count
    const followingsRes = await axios.get(`https://friends.roblox.com/v1/users/${userId}/followings/count`);
    const followings = followingsRes.data.count;

    // Friends count
    let friends = 0;
    try {
      const friendsRes = await axios.get(`https://friends.roblox.com/v1/users/${userId}/friends/count`);
      friends = friendsRes.data.count;
    } catch (e) {
      console.error('Friends count error:', e.message);
    }

    // Groups count
    let groups_count = 0;
    try {
      const groupsRes = await axios.get(`https://groups.roblox.com/v1/users/${userId}/groups/roles`);
      groups_count = groupsRes.data.data.length;
    } catch (e) {
      console.error('Groups count error:', e.message);
    }

    // Avatar URL (full body avatar)
    let avatarUrl = 'https://via.placeholder.com/150';
    try {
      const avatarRes = await axios.get(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=420x420&format=Png&isCircular=false`);
      avatarUrl = avatarRes.data.data[0].imageUrl;
    } catch (e) {
      console.error('Avatar fetch error:', e.message);
    }

    // Username history (only names, as API does not provide dates)
    let previousUsernames = [];
    try {
      const historyRes = await axios.get(`https://users.roblox.com/v1/users/${userId}/username-history?limit=10&sortOrder=Asc`);
      previousUsernames = historyRes.data.data.map(h => h.name);
    } catch (e) {
      console.error('Username history error:', e.message);
    }

    // Active status (based on ban status)
    const activeStatus = userInfo.isBanned ? 'Banned' : 'Active';

    // Online status
    let onlineStatus = 'Unknown';
    try {
      const presenceRes = await axios.post('https://presence.roblox.com/v1/presence/users', {
        userIds: [userId]
      });
      const presence = presenceRes.data.userPresences[0];
      if (presence) {
        switch (presence.userPresenceType) {
          case 0:
            onlineStatus = 'Offline';
            break;
          case 1:
            onlineStatus = 'Online';
            break;
          case 2:
            onlineStatus = 'In Game';
            break;
          case 3:
            onlineStatus = 'In Studio';
            break;
          default:
            onlineStatus = 'Unknown';
        }
      }
    } catch (e) {
      console.error('Presence error:', e.message);
    }

    // Profile link
    const profile_link = `https://www.roblox.com/users/${userId}/profile`;

    // Compile response
    res.json({
      username: basicUser.name || username,
      display_name: basicUser.displayName || 'N/A',
      estimated_creation_date: userInfo.created ? new Date(userInfo.created).toLocaleDateString() : 'N/A',
      account_age: userInfo.created ? calculateAccountAge(userInfo.created) : 'N/A',
      age_days: userInfo.created ? calculateAgeDays(userInfo.created) : 0,
      followers: followers || 0,
      followings: followings || 0,
      friends: friends || 0,
      groups_count: groups_count || 0,
      verified: userInfo.hasVerifiedBadge || false,
      description: userInfo.description || 'N/A',
      user_id: userId,
      avatar: avatarUrl,
      previous_usernames: previousUsernames,
      active_status: activeStatus,
      online_status: onlineStatus,
      profile_link: profile_link
    });
  } catch (error) {
    console.error('Roblox API Error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.message || 'Failed to fetch Roblox data',
      details: error.response?.data || 'No additional details',
    });
  }
});

// Roblox age checker endpoint (GET for testing, no reCAPTCHA)
app.get('/api/roblox/:username', async (req, res) => {
  try {
    const username = req.params.username;
    // Same logic as POST
    const userSearch = await axios.post('https://users.roblox.com/v1/usernames/users', {
      usernames: [username],
      excludeBannedUsers: false
    });
    const users = userSearch.data.data;
    if (users.length === 0) throw new Error('User not found');
    const basicUser = users[0];
    const userId = basicUser.id;

    const userInfoRes = await axios.get(`https://users.roblox.com/v1/users/${userId}`);
    const userInfo = userInfoRes.data;

    const followersRes = await axios.get(`https://friends.roblox.com/v1/users/${userId}/followers/count`);
    const followers = followersRes.data.count;

    const followingsRes = await axios.get(`https://friends.roblox.com/v1/users/${userId}/followings/count`);
    const followings = followingsRes.data.count;

    let friends = 0;
    try {
      const friendsRes = await axios.get(`https://friends.roblox.com/v1/users/${userId}/friends/count`);
      friends = friendsRes.data.count;
    } catch (e) {
      console.error('Friends count error:', e.message);
    }

    let groups_count = 0;
    try {
      const groupsRes = await axios.get(`https://groups.roblox.com/v1/users/${userId}/groups/roles`);
      groups_count = groupsRes.data.data.length;
    } catch (e) {
      console.error('Groups count error:', e.message);
    }

    let avatarUrl = 'https://via.placeholder.com/150';
    try {
      const avatarRes = await axios.get(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=420x420&format=Png&isCircular=false`);
      avatarUrl = avatarRes.data.data[0].imageUrl;
    } catch (e) {
      console.error('Avatar fetch error:', e.message);
    }

    let previousUsernames = [];
    try {
      const historyRes = await axios.get(`https://users.roblox.com/v1/users/${userId}/username-history?limit=10&sortOrder=Asc`);
      previousUsernames = historyRes.data.data.map(h => h.name);
    } catch (e) {
      console.error('Username history error:', e.message);
    }

    const activeStatus = userInfo.isBanned ? 'Banned' : 'Active';

    let onlineStatus = 'Unknown';
    try {
      const presenceRes = await axios.post('https://presence.roblox.com/v1/presence/users', {
        userIds: [userId]
      });
      const presence = presenceRes.data.userPresences[0];
      if (presence) {
        switch (presence.userPresenceType) {
          case 0:
            onlineStatus = 'Offline';
            break;
          case 1:
            onlineStatus = 'Online';
            break;
          case 2:
            onlineStatus = 'In Game';
            break;
          case 3:
            onlineStatus = 'In Studio';
            break;
          default:
            onlineStatus = 'Unknown';
        }
      }
    } catch (e) {
      console.error('Presence error:', e.message);
    }

    const profile_link = `https://www.roblox.com/users/${userId}/profile`;

    res.json({
      username: basicUser.name || username,
      display_name: basicUser.displayName || 'N/A',
      estimated_creation_date: userInfo.created ? new Date(userInfo.created).toLocaleDateString() : 'N/A',
      account_age: userInfo.created ? calculateAccountAge(userInfo.created) : 'N/A',
      age_days: userInfo.created ? calculateAgeDays(userInfo.created) : 0,
      followers: followers || 0,
      followings: followings || 0,
      friends: friends || 0,
      groups_count: groups_count || 0,
      verified: userInfo.hasVerifiedBadge || false,
      description: userInfo.description || 'N/A',
      user_id: userId,
      avatar: avatarUrl,
      previous_usernames: previousUsernames,
      active_status: activeStatus,
      online_status: onlineStatus,
      profile_link: profile_link
    });
  } catch (error) {
    console.error('Roblox API Error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.message || 'Failed to fetch Roblox data',
      details: error.response?.data || 'No additional details',
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Roblox Server running on port ${PORT}`);
});
