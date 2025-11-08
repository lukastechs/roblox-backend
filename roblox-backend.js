const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Simple in-memory cache implementation (no external dependency needed)
class SimpleCache {
  constructor() {
    this.cache = new Map();
    this.defaultTTL = parseInt(process.env.CACHE_TTL) || 300000; // 5 minutes in ms
  }

  set(key, value, ttl = this.defaultTTL) {
    this.cache.set(key, {
      value,
      expiry: Date.now() + ttl
    });
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }
    
    return item.value;
  }

  del(key) {
    return this.cache.delete(key);
  }

  keys() {
    return Array.from(this.cache.keys());
  }

  getStats() {
    return {
      keys: this.cache.size,
      hits: 0, // Simplified version without hit tracking
      misses: 0
    };
  }

  clear() {
    const count = this.cache.size;
    this.cache.clear();
    return count;
  }
}

// Simple rate limiting middleware (no external dependency needed)
function createRateLimit(windowMs = 60000, max = 50) {
  const requests = new Map();
  
  setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of requests.entries()) {
      const validTimestamps = timestamps.filter(time => now - time < windowMs);
      if (validTimestamps.length === 0) {
        requests.delete(ip);
      } else {
        requests.set(ip, validTimestamps);
      }
    }
  }, 60000); // Cleanup every minute

  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    if (!requests.has(ip)) {
      requests.set(ip, []);
    }
    
    const timestamps = requests.get(ip);
    const recentRequests = timestamps.filter(time => now - time < windowMs);
    
    if (recentRequests.length >= max) {
      return res.status(429).json({
        error: 'Too many requests, please try again later.',
        retryAfter: '1 minute'
      });
    }
    
    recentRequests.push(now);
    requests.set(ip, recentRequests);
    next();
  };
}

// Initialize cache and rate limiting
const cache = new SimpleCache();
const limiter = createRateLimit(
  parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
  parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 50
);

// Middleware
app.use(cors());
app.use(express.json());
app.use('/api/roblox/', limiter);

const PORT = process.env.PORT || 3000;

// Request queue for Roblox API calls
class RobloxAPIQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.batchSize = 3;
    this.delayBetweenBatches = parseInt(process.env.BATCH_DELAY_MS) || 1200;
  }

  async add(request) {
    return new Promise((resolve, reject) => {
      this.queue.push({ request, resolve, reject });
      if (!this.processing) {
        this.process();
      }
    });
  }

  async process() {
    if (this.processing) return;
    
    this.processing = true;
    
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, Math.min(this.batchSize, this.queue.length));
      
      await Promise.allSettled(
        batch.map(item => this.executeRequest(item))
      );
      
      if (this.queue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, this.delayBetweenBatches));
      }
    }
    
    this.processing = false;
  }

  async executeRequest({ request, resolve, reject }) {
    try {
      const result = await request();
      resolve(result);
    } catch (error) {
      reject(error);
    }
  }
}

const robloxQueue = new RobloxAPIQueue();

// Calculate account age in human-readable format
function calculateAccountAge(createdAt) {
  const now = new Date();
  const created = new Date(createdAt);
  const diffMs = now - created;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const years = Math.floor(diffDays / 365);
  const months = Math.floor((diffDays % 365) / 30);
  const days = diffDays % 30;
  
  if (years > 0) {
    return `${years} years, ${months} months, ${days} days`;
  } else if (months > 0) {
    return `${months} months, ${days} days`;
  } else {
    return `${days} days`;
  }
}

// Calculate age in days
function calculateAgeDays(createdAt) {
  const now = new Date();
  const created = new Date(createdAt);
  const diffMs = now - created;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// Main function to fetch Roblox user data
async function fetchRobloxUserData(username) {
  const cacheKey = `user:${username.toLowerCase()}`;
  
  // Try cache first for the entire user data
  const cachedUserData = cache.get(cacheKey);
  if (cachedUserData) {
    console.log(`Cache hit for: ${username}`);
    return cachedUserData;
  }

  console.log(`Cache miss for: ${username}`);
  
  // Get user ID first
  const userSearch = await axios.post('https://users.roblox.com/v1/usernames/users', {
    usernames: [username],
    excludeBannedUsers: false
  }, { 
    timeout: 10000,
    headers: {
      'User-Agent': 'Roblox-Account-Checker/1.0',
      'Accept': 'application/json'
    }
  });

  const users = userSearch.data.data;
  if (users.length === 0) throw new Error('User not found');
  
  const basicUser = users[0];
  const userId = basicUser.id;

  // Make parallel requests for independent data
  const [
    userInfoRes,
    followersRes,
    followingsRes
  ] = await Promise.allSettled([
    axios.get(`https://users.roblox.com/v1/users/${userId}`, { 
      timeout: 10000,
      headers: { 'User-Agent': 'Roblox-Account-Checker/1.0' }
    }),
    axios.get(`https://friends.roblox.com/v1/users/${userId}/followers/count`, { 
      timeout: 10000,
      headers: { 'User-Agent': 'Roblox-Account-Checker/1.0' }
    }),
    axios.get(`https://friends.roblox.com/v1/users/${userId}/followings/count`, { 
      timeout: 10000,
      headers: { 'User-Agent': 'Roblox-Account-Checker/1.0' }
    })
  ]);

  // Handle optional requests separately with shorter timeouts
  const optionalRequests = await Promise.allSettled([
    axios.get(`https://friends.roblox.com/v1/users/${userId}/friends/count`, { 
      timeout: 5000,
      headers: { 'User-Agent': 'Roblox-Account-Checker/1.0' }
    }),
    axios.get(`https://groups.roblox.com/v1/users/${userId}/groups/roles`, { 
      timeout: 5000,
      headers: { 'User-Agent': 'Roblox-Account-Checker/1.0' }
    }),
    axios.get(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=420x420&format=Png&isCircular=false`, { 
      timeout: 5000,
      headers: { 'User-Agent': 'Roblox-Account-Checker/1.0' }
    }),
    axios.get(`https://users.roblox.com/v1/users/${userId}/username-history?limit=10&sortOrder=Asc`, { 
      timeout: 5000,
      headers: { 'User-Agent': 'Roblox-Account-Checker/1.0' }
    }),
    axios.post('https://presence.roblox.com/v1/presence/users', 
      { userIds: [userId] }, 
      { 
        timeout: 5000,
        headers: { 
          'User-Agent': 'Roblox-Account-Checker/1.0',
          'Content-Type': 'application/json'
        }
      }
    )
  ]);

  // Extract results from settled promises
  const userInfo = userInfoRes.status === 'fulfilled' ? userInfoRes.value.data : {};
  const followers = followersRes.status === 'fulfilled' ? followersRes.value.data.count : 0;
  const followings = followingsRes.status === 'fulfilled' ? followingsRes.value.data.count : 0;
  
  const friends = optionalRequests[0].status === 'fulfilled' ? optionalRequests[0].value.data.count : 0;
  const groups_count = optionalRequests[1].status === 'fulfilled' ? optionalRequests[1].value.data.data.length : 0;
  const avatarUrl = optionalRequests[2].status === 'fulfilled' ? 
    (optionalRequests[2].value.data.data[0]?.imageUrl || 'https://via.placeholder.com/150') : 
    'https://via.placeholder.com/150';
  const previousUsernames = optionalRequests[3].status === 'fulfilled' ? 
    optionalRequests[3].value.data.data.map(h => h.name) : [];
  
  let onlineStatus = 'Unknown';
  if (optionalRequests[4].status === 'fulfilled' && optionalRequests[4].value.data.userPresences[0]) {
    const presence = optionalRequests[4].value.data.userPresences[0];
    onlineStatus = ['Offline', 'Online', 'In Game', 'In Studio'][presence.userPresenceType] || 'Unknown';
  }

  const activeStatus = userInfo.isBanned ? 'Banned' : 'Active';
  const profile_link = `https://www.roblox.com/users/${userId}/profile`;

  const result = {
    username: basicUser.name || username,
    display_name: basicUser.displayName || 'N/A',
    estimated_creation_date: userInfo.created ? new Date(userInfo.created).toLocaleDateString() : 'N/A',
    account_age: userInfo.created ? calculateAccountAge(userInfo.created) : 'N/A',
    age_days: userInfo.created ? calculateAgeDays(userInfo.created) : 0,
    followers,
    followings,
    friends,
    groups_count,
    verified: userInfo.hasVerifiedBadge || false,
    description: userInfo.description || 'N/A',
    user_id: userId,
    avatar: avatarUrl,
    previous_usernames: previousUsernames,
    active_status: activeStatus,
    online_status: onlineStatus,
    profile_link,
    last_updated: new Date().toISOString()
  };

  // Cache the complete user data
  cache.set(cacheKey, result);
  return result;
}

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Roblox Account Age Checker API is running',
    endpoints: {
      '/api/roblox/:username': 'GET/POST - Get Roblox user information',
      '/health': 'GET - Health check',
      '/cache/stats': 'GET - Cache statistics',
      '/cache/clear': 'POST - Clear cache'
    },
    rateLimit: {
      windowMs: '1 minute',
      maxRequests: 50
    }
  });
});

// Roblox age checker endpoint (POST)
app.post('/api/roblox/:username', async (req, res) => {
  try {
    const username = req.params.username;
    
    if (!username || username.trim().length === 0) {
      return res.status(400).json({
        error: 'Username is required',
        details: 'Please provide a valid Roblox username'
      });
    }

    console.log(`Processing request for username: ${username}`);
    
    const result = await robloxQueue.add(() => fetchRobloxUserData(username.trim()));
    res.json(result);
    
  } catch (error) {
    console.error('Roblox API Error:', error.response?.data || error.message);
    
    // Handle specific error cases
    if (error.message === 'User not found') {
      return res.status(404).json({
        error: 'User not found',
        details: 'The specified Roblox username does not exist'
      });
    }
    
    if (error.code === 'ECONNABORTED' || error.response?.status === 429) {
      return res.status(429).json({
        error: 'Roblox API rate limit exceeded',
        details: 'Please try again in a few moments',
        retryAfter: '30 seconds'
      });
    }
    
    res.status(error.response?.status || 500).json({
      error: error.message || 'Failed to fetch Roblox data',
      details: error.response?.data || 'No additional details',
    });
  }
});

// Roblox age checker endpoint (GET)
app.get('/api/roblox/:username', async (req, res) => {
  try {
    const username = req.params.username;
    
    if (!username || username.trim().length === 0) {
      return res.status(400).json({
        error: 'Username is required',
        details: 'Please provide a valid Roblox username'
      });
    }

    console.log(`Processing GET request for username: ${username}`);
    
    const result = await robloxQueue.add(() => fetchRobloxUserData(username.trim()));
    res.json(result);
    
  } catch (error) {
    console.error('Roblox API Error:', error.response?.data || error.message);
    
    if (error.message === 'User not found') {
      return res.status(404).json({
        error: 'User not found',
        details: 'The specified Roblox username does not exist'
      });
    }
    
    if (error.code === 'ECONNABORTED' || error.response?.status === 429) {
      return res.status(429).json({
        error: 'Roblox API rate limit exceeded',
        details: 'Please try again in a few moments',
        retryAfter: '30 seconds'
      });
    }
    
    res.status(error.response?.status || 500).json({
      error: error.message || 'Failed to fetch Roblox data',
      details: error.response?.data || 'No additional details',
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  const cacheStats = cache.getStats();
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cache: {
      keys: cacheStats.keys,
      size: cacheStats.keys
    }
  };
  res.json(health);
});

// Cache statistics endpoint
app.get('/cache/stats', (req, res) => {
  const stats = {
    ...cache.getStats(),
    keys: cache.keys(),
    keyCount: cache.keys().length
  };
  res.json(stats);
});

// Clear cache endpoint (for maintenance)
app.post('/cache/clear', (req, res) => {
  const clearedCount = cache.clear();
  res.json({
    message: 'Cache cleared successfully',
    clearedEntries: clearedCount
  });
});

// Clear specific user cache
app.delete('/cache/user/:username', (req, res) => {
  const username = req.params.username;
  const cacheKey = `user:${username.toLowerCase()}`;
  const deleted = cache.del(cacheKey);
  
  res.json({
    message: deleted ? 'User cache cleared' : 'User not found in cache',
    username: username,
    cacheKey: cacheKey
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: 'Something went wrong on our end'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    message: `The requested endpoint ${req.originalUrl} does not exist`
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Roblox Server running on port ${PORT}`);
  console.log(`📊 Rate limiting: 50 requests per minute`);
  console.log(`💾 Cache TTL: 5 minutes`);
  console.log(`⏰ Batch delay: 1200ms`);
  console.log(`✅ No additional dependencies required!`);
});
