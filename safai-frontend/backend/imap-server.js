// SafAI IMAP Gmail Monitoring Server with App Password Authentication
// This implements Gmail monitoring using IMAP instead of Gmail API

const express = require('express');
const cors = require('cors');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mongoose = require('mongoose');
const WebSocket = require('ws');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors({
    origin: [
        'http://localhost:8080',
        'http://localhost:8081',
        'http://localhost:8082',
        process.env.FRONTEND_URL || 'http://localhost:8080'
    ],
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

app.use(express.json({ limit: '10mb' }));

// MongoDB connection (optional - works without MongoDB for demo)
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/safai', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
}).catch(err => {
    console.warn('MongoDB not available - running in demo mode:', err.message);
});

// Database schemas
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    encryptedPassword: String, // Encrypted app password
    createdAt: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true },
    lastSync: Date
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
    messageId: { type: String, required: true },
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
    receivedAt: Date,
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const MonitoringConfig = mongoose.model('MonitoringConfig', MonitoringConfigSchema);
const Violation = mongoose.model('Violation', ViolationSchema);

// WebSocket server for real-time updates
const wss = new WebSocket.Server({ port: 8080 });
const activeConnections = new Map();

wss.on('connection', (ws) => {
    console.log('WebSocket client connected');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'authenticate' && data.userId) {
                activeConnections.set(data.userId, ws);
                console.log(`User ${data.userId} authenticated via WebSocket`);
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
                console.log(`User ${userId} disconnected from WebSocket`);
                break;
            }
        }
    });
});

// Encryption functions
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32);
const IV_LENGTH = 16;

function encrypt(text) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipher('aes-256-cbc', ENCRYPTION_KEY);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];
    const decipher = crypto.createDecipher('aes-256-cbc', ENCRYPTION_KEY);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

// Gmail monitoring service class
class GmailIMAPService {
    constructor() {
        this.activeMonitors = new Map();
    }

    async testConnection(email, appPassword) {
        return new Promise((resolve, reject) => {
            const imap = new Imap({
                user: email,
                password: appPassword,
                host: 'imap.gmail.com',
                port: 993,
                tls: true,
                tlsOptions: { rejectUnauthorized: false }
            });

            const timeout = setTimeout(() => {
                imap.destroy();
                reject(new Error('Connection timeout'));
            }, 10000);

            imap.once('ready', () => {
                clearTimeout(timeout);
                imap.openBox('INBOX', true, (err, box) => {
                    if (err) {
                        imap.end();
                        reject(err);
                    } else {
                        imap.end();
                        resolve({
                            success: true,
                            totalMessages: box.messages.total,
                            newMessages: box.messages.new
                        });
                    }
                });
            });

            imap.once('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });

            imap.connect();
        });
    }

    async startMonitoring(userId, email, appPassword, config) {
        const monitorId = `${userId}_${email}`;

        // Stop existing monitor if any
        if (this.activeMonitors.has(monitorId)) {
            clearInterval(this.activeMonitors.get(monitorId).interval);
        }

        // Set up monitoring interval
        const interval = this.getCheckInterval(config.frequency);

        const monitor = {
            userId,
            email,
            appPassword,
            config,
            interval: setInterval(async () => {
                try {
                    await this.checkNewEmails(userId, email, appPassword, config);
                } catch (error) {
                    console.error(`Monitoring error for ${email}:`, error);
                    this.sendRealTimeNotification(userId, {
                        type: 'error',
                        message: 'Monitoring connection error',
                        error: error.message
                    });
                }
            }, interval),
            lastCheck: new Date()
        };

        this.activeMonitors.set(monitorId, monitor);

        // Perform initial check
        await this.checkNewEmails(userId, email, appPassword, config);

        console.log(`Started monitoring for ${email} (${config.frequency})`);
        return { success: true, monitorId };
    }

    async checkNewEmails(userId, email, appPassword, config) {
        return new Promise((resolve, reject) => {
            const imap = new Imap({
                user: email,
                password: appPassword,
                host: 'imap.gmail.com',
                port: 993,
                tls: true,
                tlsOptions: { rejectUnauthorized: false }
            });

            imap.once('ready', () => {
                imap.openBox('INBOX', false, async (err, box) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Get recent emails (last 50 unread)
                    const searchCriteria = ['UNSEEN'];
                    const fetchOptions = { bodies: '', markSeen: false };

                    imap.search(searchCriteria, (err, results) => {
                        if (err) {
                            reject(err);
                            return;
                        }

                        if (!results || results.length === 0) {
                            imap.end();
                            resolve({ processed: 0 });
                            return;
                        }

                        const fetch = imap.fetch(results.slice(0, 50), fetchOptions);
                        let processed = 0;

                        fetch.on('message', (msg) => {
                            msg.on('body', (stream) => {
                                simpleParser(stream, async (err, parsed) => {
                                    if (err) {
                                        console.error('Email parsing error:', err);
                                        return;
                                    }

                                    try {
                                        await this.processEmail(userId, email, parsed, config);
                                        processed++;
                                    } catch (error) {
                                        console.error('Email processing error:', error);
                                    }
                                });
                            });
                        });

                        fetch.once('end', () => {
                            imap.end();
                            resolve({ processed });
                        });

                        fetch.once('error', (err) => {
                            reject(err);
                        });
                    });
                });
            });

            imap.once('error', (err) => {
                reject(err);
            });

            imap.connect();
        });
    }

    async processEmail(userId, accountEmail, email, config) {
        const emailData = {
            subject: email.subject || '',
            from: email.from?.text || '',
            to: email.to?.text || '',
            date: email.date,
            messageId: email.messageId,
            body: email.text || email.html || ''
        };

        // Analyze content for violations
        const analysis = await this.analyzeEmailContent(emailData, config.sensitivity, config.categories);

        if (analysis.hasViolation) {
            // Create violation record
            const violation = new Violation({
                userId,
                messageId: emailData.messageId,
                accountEmail,
                subject: emailData.subject,
                sender: emailData.from,
                content: emailData.body.substring(0, 1000), // Limit stored content
                violations: analysis.violations,
                overallSeverity: analysis.severity,
                receivedAt: emailData.date
            });

            await violation.save();

            // Send real-time notification
            this.sendRealTimeNotification(userId, {
                type: 'violation',
                violation: {
                    id: violation._id,
                    subject: violation.subject,
                    sender: violation.sender,
                    severity: violation.overallSeverity,
                    violationCount: violation.violations.length,
                    createdAt: violation.createdAt
                }
            });

            console.log(`Violation detected in email from ${emailData.from}: ${analysis.violations.length} violations`);
        }
    }

    async analyzeEmailContent(emailData, sensitivity, categories) {
        // Advanced pattern-based detection
        const violationPatterns = {
            harassment: {
                keywords: ['harass', 'bully', 'intimidate', 'threaten', 'stalk', 'abuse', 'torment'],
                patterns: [
                    /you\s+(are|re)\s+(stupid|idiot|useless|worthless)/i,
                    /(shut\s+up|go\s+away|get\s+lost|leave\s+me\s+alone)/i,
                    /(stop\s+bothering|quit\s+being|you\s+suck)/i
                ]
            },
            discrimination: {
                keywords: ['racist', 'sexist', 'bigot', 'discriminate', 'prejudice'],
                patterns: [
                    /(because\s+you\s+(are|re)\s+a?\s*(woman|man|black|white|asian|hispanic|gay|lesbian))/i,
                    /(you\s+people|those\s+people|your\s+kind)/i,
                    /(go\s+back\s+to|where\s+you\s+belong)/i
                ]
            },
            inappropriate: {
                keywords: ['inappropriate', 'offensive', 'vulgar', 'profanity', 'explicit'],
                patterns: [
                    /f[*!@#$%^&u]ck/i,
                    /s[*!@#$%^&h]t/i,
                    /b[*!@#$%^&i]tch/i,
                    /d[*!@#$%^&a]mn/i
                ]
            },
            threats: {
                keywords: ['kill', 'harm', 'violence', 'destroy', 'attack', 'hurt', 'murder'],
                patterns: [
                    /(i\s+will\s+(kill|destroy|harm|hurt)\s+you)/i,
                    /(you\s+will\s+(pay|regret|suffer))/i,
                    /(watch\s+your\s+back|you\s+better\s+watch)/i
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
            low: ['annoying', 'rude'],
            medium: ['inappropriate', 'offensive', 'stupid', 'idiot'],
            high: ['threaten', 'kill', 'harm', 'racist', 'discriminate', 'violence']
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

    sendRealTimeNotification(userId, data) {
        const connection = activeConnections.get(userId.toString());
        if (connection && connection.readyState === WebSocket.OPEN) {
            connection.send(JSON.stringify(data));
        }
    }

    getCheckInterval(frequency) {
        const intervals = {
            realtime: 30000,    // 30 seconds for IMAP
            '30s': 30000,
            '1m': 60000,
            '5m': 300000
        };
        return intervals[frequency] || intervals.realtime;
    }

    stopMonitoring(userId, email) {
        const monitorId = `${userId}_${email}`;
        const monitor = this.activeMonitors.get(monitorId);
        if (monitor) {
            clearInterval(monitor.interval);
            this.activeMonitors.delete(monitorId);
            console.log(`Stopped monitoring for ${email}`);
        }
    }
}

const gmailService = new GmailIMAPService();

// API Routes

// Test Gmail connection with App Password
app.post('/api/gmail/connect', async (req, res) => {
    try {
        const { email, appPassword } = req.body;

        if (!email || !appPassword) {
            return res.status(400).json({
                success: false,
                message: 'Email and app password are required'
            });
        }

        // Test IMAP connection
        const result = await gmailService.testConnection(email, appPassword);

        if (result.success) {
            // Create demo user object (no database save in demo mode)
            const demoUser = {
                _id: 'demo_' + Date.now(),
                email,
                encryptedPassword: encrypt(appPassword)
            };

            // Generate JWT token
            const token = jwt.sign(
                { userId: demoUser._id, email: demoUser.email },
                process.env.JWT_SECRET || 'safai-secret-key',
                { expiresIn: '24h' }
            );

            res.json({
                success: true,
                message: 'Connected to Gmail successfully',
                token,
                userId: demoUser._id,
                totalMessages: result.totalMessages,
                newMessages: result.newMessages
            });

        } else {
            res.status(401).json({
                success: false,
                message: 'Failed to connect to Gmail. Please check your credentials.'
            });
        }

    } catch (error) {
        console.error('Gmail connection error:', error);

        let message = 'Connection failed';
        if (error.message.includes('Invalid credentials')) {
            message = 'Invalid email or app password - please check your credentials';
        } else if (error.message.includes('timeout')) {
            message = 'Connection timeout. Please try again.';
        } else if (error.message.includes('EAUTH')) {
            message = 'Authentication failed. Please verify your Gmail address and App Password.';
        } else if (error.message.includes('ECONNREFUSED')) {
            message = 'Cannot connect to Gmail servers. Please check your internet connection.';
        }

        res.status(401).json({
            success: false,
            message
        });
    }
});

// Start monitoring
app.post('/api/monitoring/start', async (req, res) => {
    try {
        const { email, sensitivity, categories, frequency, notifications, token } = req.body;

        // Verify JWT token
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'safai-secret-key');
        const user = await User.findById(decoded.userId);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Decrypt app password
        const appPassword = decrypt(user.encryptedPassword);

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
        const result = await gmailService.startMonitoring(user._id, email, appPassword, {
            sensitivity,
            categories,
            frequency
        });

        res.json({
            success: true,
            message: 'Monitoring started successfully',
            configId: config._id,
            ...result
        });

    } catch (error) {
        console.error('Error starting monitoring:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to start monitoring'
        });
    }
});

// Get violations
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

        res.json({
            success: true,
            violations
        });

    } catch (error) {
        console.error('Error fetching violations:', error);
        res.status(500).json({ error: 'Failed to fetch violations' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date(),
        activeMonitors: gmailService.activeMonitors.size,
        activeConnections: activeConnections.size,
        service: 'IMAP Gmail Monitoring'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`SafAI IMAP server running on port ${PORT}`);
    console.log('WebSocket server running on port 8080');
    console.log('Using Gmail IMAP for email monitoring');
});

module.exports = app;