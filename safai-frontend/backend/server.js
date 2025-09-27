// SafAI Backend Server for Gmail Monitoring
// Enterprise-grade Node.js server with Gmail API integration

const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mongoose = require('mongoose');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:8080',
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/safai', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

// Database schemas
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    name: String,
    googleId: String,
    accessToken: String,
    refreshToken: String,
    createdAt: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true }
});

const MonitoringConfigSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    email: { type: String, required: true },
    sensitivity: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    categories: [String],
    frequency: { type: String, enum: ['realtime', '30s', '1m', '5m'], default: 'realtime' },
    notifications: [String],
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});

const ViolationSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    emailId: { type: String, required: true },
    accountEmail: { type: String, required: true },
    subject: String,
    sender: String,
    content: String,
    violations: [{
        category: String,
        keyword: String,
        context: String,
        severity: { type: String, enum: ['low', 'medium', 'high'] },
        confidence: Number
    }],
    overallSeverity: { type: String, enum: ['low', 'medium', 'high'] },
    status: { type: String, enum: ['new', 'reviewed', 'resolved'], default: 'new' },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const MonitoringConfig = mongoose.model('MonitoringConfig', MonitoringConfigSchema);
const Violation = mongoose.model('Violation', ViolationSchema);

// Google OAuth configuration
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback'
);

// Gmail API setup
const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

// WebSocket server for real-time updates
const wss = new WebSocket.Server({ port: 8080 });
const activeConnections = new Map();

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'authenticate' && data.userId) {
                activeConnections.set(data.userId, ws);
            }
        } catch (error) {
            console.error('WebSocket message error:', error);
        }
    });

    ws.on('close', () => {
        // Remove connection from active connections
        for (const [userId, connection] of activeConnections.entries()) {
            if (connection === ws) {
                activeConnections.delete(userId);
                break;
            }
        }
    });
});

// Monitoring service class
class GmailMonitoringService {
    constructor() {
        this.activeMonitors = new Map();
    }

    async startMonitoring(config) {
        const { userId, email, accessToken } = config;

        // Set up OAuth client with user's tokens
        oauth2Client.setCredentials({
            access_token: accessToken
        });

        // Start monitoring interval
        const interval = this.getCheckInterval(config.frequency);
        const monitorId = `${userId}_${email}`;

        if (this.activeMonitors.has(monitorId)) {
            clearInterval(this.activeMonitors.get(monitorId));
        }

        const monitor = setInterval(async () => {
            try {
                await this.checkEmailsForUser(config);
            } catch (error) {
                console.error(`Monitoring error for ${email}:`, error);
                this.handleMonitoringError(userId, error);
            }
        }, interval);

        this.activeMonitors.set(monitorId, monitor);

        // Perform initial check
        await this.checkEmailsForUser(config);

        return { success: true, monitorId };
    }

    async checkEmailsForUser(config) {
        const { userId, email, sensitivity, categories } = config;

        try {
            // Get recent emails
            const response = await gmail.users.messages.list({
                userId: 'me',
                q: 'is:unread',
                maxResults: 50
            });

            if (response.data.messages) {
                for (const message of response.data.messages) {
                    await this.processEmail(userId, email, message.id, sensitivity, categories);
                }
            }
        } catch (error) {
            console.error('Error checking emails:', error);
            throw error;
        }
    }

    async processEmail(userId, accountEmail, messageId, sensitivity, categories) {
        try {
            // Get full message
            const messageResponse = await gmail.users.messages.get({
                userId: 'me',
                id: messageId,
                format: 'full'
            });

            const message = messageResponse.data;
            const emailData = this.extractEmailContent(message);

            // Analyze content
            const analysis = await this.analyzeEmailContent(emailData, sensitivity, categories);

            if (analysis.hasViolation) {
                // Create violation record
                const violation = new Violation({
                    userId,
                    emailId: messageId,
                    accountEmail,
                    subject: emailData.subject,
                    sender: emailData.from,
                    content: emailData.body,
                    violations: analysis.violations,
                    overallSeverity: analysis.severity
                });

                await violation.save();

                // Send real-time notification
                this.sendRealTimeNotification(userId, violation);

                // Mark email as read (optional)
                // await gmail.users.messages.modify({
                //     userId: 'me',
                //     id: messageId,
                //     resource: { removeLabelIds: ['UNREAD'] }
                // });
            }
        } catch (error) {
            console.error('Error processing email:', error);
        }
    }

    extractEmailContent(message) {
        const headers = message.payload.headers || [];
        const getHeader = (name) => {
            const header = headers.find(h => h.name === name);
            return header ? header.value : '';
        };

        let body = '';
        if (message.payload.body && message.payload.body.data) {
            body = Buffer.from(message.payload.body.data, 'base64').toString();
        } else if (message.payload.parts) {
            for (const part of message.payload.parts) {
                if (part.mimeType === 'text/plain' && part.body.data) {
                    body += Buffer.from(part.body.data, 'base64').toString();
                }
            }
        }

        return {
            subject: getHeader('Subject'),
            from: getHeader('From'),
            to: getHeader('To'),
            date: getHeader('Date'),
            body: body.substring(0, 5000) // Limit body length
        };
    }

    async analyzeEmailContent(emailData, sensitivity, categories) {
        // Advanced AI analysis would go here
        // For now, implementing comprehensive keyword detection

        const violationPatterns = {
            harassment: {
                keywords: ['harass', 'bully', 'intimidate', 'threaten', 'stalk', 'abuse'],
                patterns: [
                    /you\s+(are|re)\s+(stupid|idiot|useless)/i,
                    /(shut\s+up|go\s+away|get\s+lost)/i
                ]
            },
            discrimination: {
                keywords: ['racist', 'sexist', 'bigot', 'discriminate'],
                patterns: [
                    /(because\s+you\s+(are|re)\s+a?\s*(woman|man|black|white|asian))/i,
                    /(you\s+people|those\s+people)/i
                ]
            },
            inappropriate: {
                keywords: ['inappropriate', 'offensive', 'vulgar', 'profanity'],
                patterns: [
                    /f[*!@#$%^&]ck/i,
                    /s[*!@#$%^&]t/i,
                    /b[*!@#$%^&]tch/i
                ]
            },
            threats: {
                keywords: ['kill', 'harm', 'violence', 'destroy', 'attack'],
                patterns: [
                    /(i\s+will\s+(kill|destroy|harm)\s+you)/i,
                    /(you\s+will\s+(pay|regret|suffer))/i
                ]
            }
        };

        const analysis = {
            hasViolation: false,
            violations: [],
            severity: 'low',
            confidence: 0
        };

        const content = `${emailData.subject} ${emailData.body}`.toLowerCase();

        // Check enabled categories
        for (const category of categories) {
            if (violationPatterns[category]) {
                const pattern = violationPatterns[category];

                // Check keywords
                for (const keyword of pattern.keywords) {
                    if (content.includes(keyword)) {
                        analysis.violations.push({
                            category,
                            keyword,
                            context: this.extractContext(content, keyword),
                            severity: this.calculateSeverity(keyword, sensitivity),
                            confidence: 0.7
                        });
                    }
                }

                // Check regex patterns
                for (const regex of pattern.patterns || []) {
                    const match = content.match(regex);
                    if (match) {
                        analysis.violations.push({
                            category,
                            keyword: match[0],
                            context: this.extractContext(content, match[0]),
                            severity: this.calculateSeverity(match[0], sensitivity),
                            confidence: 0.9
                        });
                    }
                }
            }
        }

        if (analysis.violations.length > 0) {
            analysis.hasViolation = true;
            analysis.severity = this.calculateOverallSeverity(analysis.violations);
            analysis.confidence = Math.min(0.95,
                analysis.violations.reduce((sum, v) => sum + v.confidence, 0) / analysis.violations.length
            );
        }

        return analysis;
    }

    extractContext(content, keyword) {
        const index = content.indexOf(keyword.toLowerCase());
        if (index === -1) return '';

        const start = Math.max(0, index - 50);
        const end = Math.min(content.length, index + keyword.length + 50);
        return content.substring(start, end);
    }

    calculateSeverity(keyword, sensitivityLevel) {
        const severityMap = {
            low: ['spam', 'annoying'],
            medium: ['inappropriate', 'offensive', 'rude'],
            high: ['threaten', 'kill', 'harm', 'racist', 'discriminate']
        };

        for (const [level, keywords] of Object.entries(severityMap)) {
            if (keywords.some(k => keyword.toLowerCase().includes(k))) {
                return level;
            }
        }

        return sensitivityLevel === 'high' ? 'medium' : 'low';
    }

    calculateOverallSeverity(violations) {
        const severities = violations.map(v => v.severity);
        if (severities.includes('high')) return 'high';
        if (severities.includes('medium')) return 'medium';
        return 'low';
    }

    sendRealTimeNotification(userId, violation) {
        const connection = activeConnections.get(userId.toString());
        if (connection && connection.readyState === WebSocket.OPEN) {
            connection.send(JSON.stringify({
                type: 'violation',
                data: violation
            }));
        }
    }

    getCheckInterval(frequency) {
        const intervals = {
            realtime: 10000,    // 10 seconds
            '30s': 30000,       // 30 seconds
            '1m': 60000,        // 1 minute
            '5m': 300000        // 5 minutes
        };
        return intervals[frequency] || intervals.realtime;
    }

    handleMonitoringError(userId, error) {
        console.error(`Monitoring error for user ${userId}:`, error);

        const connection = activeConnections.get(userId.toString());
        if (connection && connection.readyState === WebSocket.OPEN) {
            connection.send(JSON.stringify({
                type: 'error',
                data: { message: 'Monitoring error occurred', error: error.message }
            }));
        }
    }
}

const monitoringService = new GmailMonitoringService();

// API Routes

// Authentication routes
app.get('/auth/google', (req, res) => {
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/userinfo.email'
        ]
    });
    res.redirect(authUrl);
});

app.get('/auth/google/callback', async (req, res) => {
    const { code } = req.query;

    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        // Get user info
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const userInfo = await oauth2.userinfo.get();

        // Save or update user
        let user = await User.findOne({ googleId: userInfo.data.id });
        if (!user) {
            user = new User({
                email: userInfo.data.email,
                name: userInfo.data.name,
                googleId: userInfo.data.id,
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token
            });
            await user.save();
        } else {
            user.accessToken = tokens.access_token;
            if (tokens.refresh_token) {
                user.refreshToken = tokens.refresh_token;
            }
            await user.save();
        }

        // Generate JWT token
        const jwtToken = jwt.sign(
            { userId: user._id, email: user.email },
            process.env.JWT_SECRET || 'safai-secret-key',
            { expiresIn: '24h' }
        );

        res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:8080'}?token=${jwtToken}`);
    } catch (error) {
        console.error('OAuth callback error:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
});

// Monitoring configuration routes
app.post('/api/monitoring/config', async (req, res) => {
    try {
        const { email, sensitivity, categories, frequency, notifications, accessToken } = req.body;

        // Verify access token and get user
        oauth2Client.setCredentials({ access_token: accessToken });
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const userInfo = await oauth2.userinfo.get();

        let user = await User.findOne({ googleId: userInfo.data.id });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Create monitoring configuration
        const config = new MonitoringConfig({
            userId: user._id,
            email,
            sensitivity,
            categories,
            frequency,
            notifications
        });

        await config.save();

        // Start monitoring
        const monitoringResult = await monitoringService.startMonitoring({
            userId: user._id,
            email,
            accessToken,
            sensitivity,
            categories,
            frequency
        });

        res.json({
            success: true,
            configId: config._id,
            ...monitoringResult
        });
    } catch (error) {
        console.error('Error creating monitoring config:', error);
        res.status(500).json({ error: 'Failed to create monitoring configuration' });
    }
});

// Get user's monitoring configurations
app.get('/api/monitoring/configs', async (req, res) => {
    try {
        const { authorization } = req.headers;
        if (!authorization) {
            return res.status(401).json({ error: 'No authorization token' });
        }

        const token = authorization.replace('Bearer ', '');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'safai-secret-key');

        const configs = await MonitoringConfig.find({ userId: decoded.userId, isActive: true });
        res.json(configs);
    } catch (error) {
        console.error('Error fetching configs:', error);
        res.status(500).json({ error: 'Failed to fetch configurations' });
    }
});

// Violations routes
app.get('/api/violations', async (req, res) => {
    try {
        const { authorization } = req.headers;
        if (!authorization) {
            return res.status(401).json({ error: 'No authorization token' });
        }

        const token = authorization.replace('Bearer ', '');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'safai-secret-key');

        const violations = await Violation.find({ userId: decoded.userId })
            .sort({ createdAt: -1 })
            .limit(100);

        res.json(violations);
    } catch (error) {
        console.error('Error fetching violations:', error);
        res.status(500).json({ error: 'Failed to fetch violations' });
    }
});

// Mark violation as resolved
app.patch('/api/violations/:id/resolve', async (req, res) => {
    try {
        const violation = await Violation.findByIdAndUpdate(
            req.params.id,
            { status: 'resolved' },
            { new: true }
        );

        res.json(violation);
    } catch (error) {
        console.error('Error resolving violation:', error);
        res.status(500).json({ error: 'Failed to resolve violation' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date(),
        activeMonitors: monitoringService.activeMonitors.size,
        activeConnections: activeConnections.size
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`SafAI server running on port ${PORT}`);
    console.log('WebSocket server running on port 8080');
});

module.exports = app;