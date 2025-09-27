// SafAI MySQL IMAP Gmail Monitoring Server with App Password Authentication
// This implements Gmail monitoring using IMAP with MySQL database

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mysql = require('mysql2/promise');
const WebSocket = require('ws');
const crypto = require('crypto');
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors({
    origin: [
        'http://localhost:8080',
        'http://localhost:8081',
        'http://localhost:8082',
        'http://localhost:8083',
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

// MySQL connection
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'safai_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

let db;

// Initialize MySQL connection and create tables
async function initDatabase() {
    try {
        db = mysql.createPool(dbConfig);

        // Test connection
        const connection = await db.getConnection();
        console.log('Connected to MySQL database');
        connection.release();

        // Create database if it doesn't exist
        await db.execute(`CREATE DATABASE IF NOT EXISTS ${dbConfig.database}`);

        // Create tables
        await createTables();

        console.log('Database initialized successfully');
    } catch (error) {
        console.warn('MySQL not available - running in demo mode:', error.message);
        db = null;
    }
}

async function createTables() {
    // Users table
    await db.execute(`
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            encrypted_password TEXT,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_sync TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);

    // Monitoring configurations table
    await db.execute(`
        CREATE TABLE IF NOT EXISTS monitoring_configs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            email VARCHAR(255) NOT NULL,
            sensitivity ENUM('low', 'medium', 'high') DEFAULT 'medium',
            categories JSON,
            frequency ENUM('realtime', '30s', '1m', '5m') DEFAULT 'realtime',
            notifications JSON,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // AI Analysis table for email content analysis
    await db.execute(`
        CREATE TABLE IF NOT EXISTS ai_analyses (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            message_id VARCHAR(500),
            account_email VARCHAR(255) NOT NULL,
            subject TEXT,
            sender VARCHAR(255),
            content TEXT,
            has_attachments BOOLEAN DEFAULT FALSE,
            attachment_analysis JSON,
            annotated_images JSON,
            ai_analysis JSON,
            risk_level ENUM('safe', 'warning', 'danger') DEFAULT 'safe',
            risk_score INT DEFAULT 0,
            flagged_categories JSON,
            explanation TEXT,
            received_at TIMESTAMP,
            analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // Violations table (legacy - keeping for backward compatibility)
    await db.execute(`
        CREATE TABLE IF NOT EXISTS violations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            message_id VARCHAR(500),
            account_email VARCHAR(255) NOT NULL,
            subject TEXT,
            sender VARCHAR(255),
            content TEXT,
            violations JSON,
            overall_severity ENUM('low', 'medium', 'high'),
            status ENUM('new', 'reviewed', 'resolved') DEFAULT 'new',
            received_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    console.log('Database tables created/verified');
}

// Initialize database on startup
initDatabase();

// Initialize AI clients
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

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

// AI Analysis Service
class AIAnalysisService {
    constructor() {
        this.analysisPrompt = `You are SafAI, an advanced AI content moderation system for workplace communications.

Your job is to analyze email content for potentially offensive, dangerous, or illegal content. Focus on:

1. HARASSMENT & BULLYING: Personal attacks, intimidation, threatening language
2. DISCRIMINATORY LANGUAGE: Racism, sexism, homophobia, religious discrimination
3. INAPPROPRIATE CONTENT: Sexual content, violence, hate speech
4. ILLEGAL ACTIVITIES: Drug dealing, weapons trafficking, fraud, copyright infringement
5. WORKPLACE VIOLATIONS: Confidential information sharing, insider trading
6. THREATS & VIOLENCE: Direct or implied threats, violence promotion
7. DANGEROUS INSTRUCTIONS: Bomb making, weapon creation, harmful activities

Analyze the provided content and respond with a JSON object:
{
  "risk_level": "safe" | "warning" | "danger",
  "risk_score": 0-100,
  "flagged_categories": ["category1", "category2"],
  "explanation": "Clear explanation of why this content was flagged",
  "specific_issues": ["issue1", "issue2"]
}

If content is safe, use risk_level "safe", risk_score 0, and empty arrays.
For concerning content, use "warning" (score 1-70) or "danger" (score 71-100).`;
    }

    async analyzeTextContent(emailContent) {
        try {
            const message = await anthropic.messages.create({
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 1000,
                messages: [{
                    role: "user",
                    content: `${this.analysisPrompt}

Analyze this email content:

Subject: ${emailContent.subject || 'No Subject'}
From: ${emailContent.from || 'Unknown'}
Content: ${emailContent.text || 'No content'}

Respond with valid JSON only, no other text.`
                }]
            });

            const analysis = JSON.parse(message.content[0].text);
            return analysis;
        } catch (error) {
            console.error('Claude text analysis error:', error);
            // Simulate AI analysis when Claude API is unavailable for demo purposes
            return this.simulateAIAnalysis(emailContent);
        }
    }

    async analyzeTextWithImages(emailContent, attachments) {
        try {
            // Use Claude for analysis with vision capabilities
            const imageContent = [];

            // Add text content
            imageContent.push({
                type: "text",
                text: `${this.analysisPrompt}

You can also analyze images. Look for weapons, illegal items, inappropriate content, threatening gestures, or dangerous activities in images.

Analyze this email with attachments:

Subject: ${emailContent.subject || 'No Subject'}
From: ${emailContent.from || 'Unknown'}
Content: ${emailContent.text || 'No content'}

This email has ${attachments.length} image attachment(s). Analyze both text and images for dangerous content.

Respond with valid JSON only, no other text.`
            });

            // Add each image
            for (const attachment of attachments) {
                imageContent.push({
                    type: "image",
                    source: {
                        type: "base64",
                        media_type: attachment.contentType,
                        data: attachment.content.toString('base64')
                    }
                });
            }

            const message = await anthropic.messages.create({
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 1000,
                messages: [{
                    role: "user",
                    content: imageContent
                }]
            });

            const analysis = JSON.parse(message.content[0].text);

            // If dangerous content is detected in images, generate annotations using Nano-Banana
            if (analysis.risk_level === 'danger' || analysis.risk_level === 'warning') {
                console.log(`🎨 Starting annotation for ${attachments.length} images with risk level: ${analysis.risk_level}`);
                analysis.annotated_images = await this.annotateImages(attachments, analysis);
                console.log(`🎨 Annotation completed. Generated ${analysis.annotated_images?.length || 0} annotated images`);
            } else {
                console.log(`ℹ️ No annotation needed for risk level: ${analysis.risk_level}`);
            }

            return analysis;
        } catch (error) {
            console.error('Claude vision analysis error:', error);
            // Fallback to simulated image analysis
            return await this.simulateImageAnalysis(emailContent, attachments);
        }
    }

    async analyzeEmail(emailData) {
        const hasImages = emailData.attachments && emailData.attachments.length > 0;
        let analysis;

        if (hasImages) {
            analysis = await this.analyzeTextWithImages(emailData, emailData.attachments);
        } else {
            analysis = await this.analyzeTextContent(emailData);
        }

        // Store analysis in database
        if (db) {
            try {
                await db.execute(`
                    INSERT INTO ai_analyses (
                        user_id, message_id, account_email, subject, sender, content,
                        has_attachments, attachment_analysis, annotated_images, ai_analysis, risk_level,
                        risk_score, flagged_categories, explanation, received_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    emailData.userId || 1,
                    emailData.messageId,
                    emailData.accountEmail,
                    emailData.subject,
                    emailData.from,
                    emailData.text,
                    hasImages,
                    hasImages ? JSON.stringify(emailData.attachments.map(a => ({ contentType: a.contentType, size: a.size }))) : null,
                    analysis.annotated_images ? JSON.stringify(analysis.annotated_images) : null,
                    JSON.stringify(analysis),
                    analysis.risk_level,
                    analysis.risk_score,
                    JSON.stringify(analysis.flagged_categories),
                    analysis.explanation,
                    emailData.date || new Date()
                ]);
            } catch (dbError) {
                console.error('Failed to store AI analysis:', dbError);
            }
        }

        return analysis;
    }

    // Simulate AI analysis for demo purposes when OpenAI API is unavailable
    simulateAIAnalysis(emailContent) {
        const subject = (emailContent.subject || '').toLowerCase();
        const text = (emailContent.text || '').toLowerCase();
        const from = (emailContent.from || '').toLowerCase();

        // Combine all content for analysis
        const fullContent = `${subject} ${text} ${from}`;

        // Define dangerous keywords/patterns that would trigger AI analysis
        const dangerPatterns = [
            // Illegal activities
            { keywords: ['illegal', 'rave', 'parties', 'drugs', 'narcotics'], category: 'Illegal Activity', severity: 'danger', score: 85 },
            { keywords: ['weapon', 'gun', 'bomb', 'explosive', 'violence'], category: 'Violence/Weapons', severity: 'danger', score: 90 },
            { keywords: ['threat', 'kill', 'harm', 'attack', 'revenge'], category: 'Threats', severity: 'danger', score: 88 },

            // Warning level patterns
            { keywords: ['drugs', 'party', 'alcohol', 'substance'], category: 'Substance Use', severity: 'warning', score: 45 },
            { keywords: ['harassment', 'discriminat', 'offensive', 'inappropriate'], category: 'Harassment', severity: 'warning', score: 50 },
            { keywords: ['confidential', 'leak', 'secret', 'unauthorized'], category: 'Information Security', severity: 'warning', score: 40 }
        ];

        let highestRisk = { severity: 'safe', score: 0, categories: [], issues: [] };

        // Check content against patterns
        dangerPatterns.forEach(pattern => {
            const matchCount = pattern.keywords.filter(keyword =>
                fullContent.includes(keyword)
            ).length;

            if (matchCount > 0) {
                const riskScore = pattern.score + (matchCount - 1) * 10; // Increase score for multiple matches

                if (riskScore > highestRisk.score) {
                    highestRisk = {
                        severity: pattern.severity,
                        score: Math.min(riskScore, 100), // Cap at 100
                        categories: [pattern.category],
                        issues: pattern.keywords.filter(keyword => fullContent.includes(keyword))
                    };
                }
            }
        });

        // Generate appropriate response based on risk level
        if (highestRisk.severity === 'safe') {
            return {
                risk_level: 'safe',
                risk_score: 0,
                flagged_categories: [],
                explanation: 'Email content appears safe and does not contain concerning material.',
                specific_issues: []
            };
        } else if (highestRisk.severity === 'warning') {
            return {
                risk_level: 'warning',
                risk_score: highestRisk.score,
                flagged_categories: highestRisk.categories,
                explanation: `Email contains potentially concerning content related to ${highestRisk.categories.join(', ')}. Content should be reviewed for policy compliance.`,
                specific_issues: highestRisk.issues.map(issue => `Detected reference to: ${issue}`)
            };
        } else { // danger
            return {
                risk_level: 'danger',
                risk_score: highestRisk.score,
                flagged_categories: highestRisk.categories,
                explanation: `Email contains dangerous or illegal content related to ${highestRisk.categories.join(', ')}. This requires immediate attention and may violate workplace policies or laws.`,
                specific_issues: highestRisk.issues.map(issue => `High-risk keyword detected: ${issue}`)
            };
        }
    }

    async annotateImages(attachments, analysis) {
        console.log(`🔍 Entering annotateImages with ${attachments.length} attachments`);
        const annotatedImages = [];

        try {
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-image-preview" });
            console.log(`🤖 Initialized Nano-Banana model for annotation`);

            for (let i = 0; i < attachments.length; i++) {
                const attachment = attachments[i];

                // Create annotation instruction based on the detected issues
                const annotationInstruction = this.generateAnnotationInstruction(analysis);

                const imagePart = {
                    inlineData: {
                        data: attachment.content.toString('base64'),
                        mimeType: attachment.contentType
                    }
                };

                const prompt = `${annotationInstruction}

Please analyze this image and identify the specific dangerous items or content. Describe exactly where in the image the problematic content is located (e.g., "top-left corner", "center of image", "person's hand"). Provide coordinates or clear location descriptions for highlighting.`;

                try {
                    console.log(`📸 Processing image ${i + 1}/${attachments.length} with Nano-Banana`);
                    const result = await model.generateContent([prompt, imagePart]);
                    const response = await result.response;
                    const annotationText = response.text();
                    console.log(`✅ Successfully annotated image ${i + 1}: ${annotationText.substring(0, 100)}...`);

                    annotatedImages.push({
                        index: i,
                        filename: attachment.filename || `attachment-${i + 1}`,
                        contentType: attachment.contentType,
                        originalImage: attachment.content.toString('base64'),
                        annotationText: annotationText,
                        detectedIssues: analysis.flagged_categories,
                        riskLevel: analysis.risk_level
                    });
                } catch (error) {
                    console.error(`Error annotating image ${i}:`, error);
                    // Fallback annotation based on analysis
                    annotatedImages.push({
                        index: i,
                        filename: attachment.filename || `attachment-${i + 1}`,
                        contentType: attachment.contentType,
                        originalImage: attachment.content.toString('base64'),
                        annotationText: `Simulated annotation: This image has been flagged for containing ${analysis.flagged_categories.join(', ').toLowerCase()} content. Manual review recommended.`,
                        detectedIssues: analysis.flagged_categories,
                        riskLevel: analysis.risk_level
                    });
                }
            }
        } catch (error) {
            console.error('Error in image annotation process:', error);
        }

        return annotatedImages;
    }

    generateAnnotationInstruction(analysis) {
        const categoryInstructions = {
            'Violence/Weapons': 'Look for weapons such as guns, knives, bombs, or other dangerous weapons. Highlight and describe their exact location.',
            'Illegal Activity': 'Identify any illegal substances, drug paraphernalia, or evidence of illegal activities. Point out specific items and their locations.',
            'Threats': 'Look for threatening gestures, signs, or visual elements that could be interpreted as threats or intimidation.',
            'Harassment': 'Identify inappropriate gestures, offensive symbols, or content that could constitute harassment.',
            'Substance Use': 'Look for alcohol, drugs, smoking materials, or substance use paraphernalia.',
            'Information Security': 'Identify any confidential documents, screens with sensitive information, or security breaches visible in the image.'
        };

        let instruction = "You are an AI safety analyst. Your task is to annotate this image to highlight dangerous or inappropriate content.\n\n";

        if (analysis.flagged_categories && analysis.flagged_categories.length > 0) {
            instruction += "Focus on detecting and describing the location of:\n";
            analysis.flagged_categories.forEach(category => {
                if (categoryInstructions[category]) {
                    instruction += `- ${categoryInstructions[category]}\n`;
                }
            });
        } else {
            instruction += "Look for any dangerous, illegal, or inappropriate content and describe its location.\n";
        }

        return instruction;
    }

    async simulateImageAnalysis(emailContent, attachments) {
        // First perform text analysis
        const textAnalysis = this.simulateAIAnalysis(emailContent);

        // Simulate image content analysis based on email text context
        const subject = (emailContent.subject || '').toLowerCase();
        const text = (emailContent.text || '').toLowerCase();
        const combinedText = `${subject} ${text}`;

        // Enhanced analysis when images are present with suspicious text
        const imageRiskPatterns = [
            { keywords: ['3d print', 'print', 'weapon', 'gun'], riskIncrease: 30, category: 'Violence/Weapons' },
            { keywords: ['show', 'image', 'picture', 'weapon'], riskIncrease: 25, category: 'Violence/Weapons' },
            { keywords: ['drug', 'substance', 'illegal', 'photo'], riskIncrease: 20, category: 'Illegal Activity' },
            { keywords: ['threat', 'intimidat', 'photo', 'image'], riskIncrease: 25, category: 'Threats' }
        ];

        let imageRiskIncrease = 0;
        let additionalCategories = [];

        imageRiskPatterns.forEach(pattern => {
            const matches = pattern.keywords.filter(keyword => combinedText.includes(keyword));
            if (matches.length >= 2) { // Need at least 2 matches to increase suspicion
                imageRiskIncrease = Math.max(imageRiskIncrease, pattern.riskIncrease);
                if (!additionalCategories.includes(pattern.category)) {
                    additionalCategories.push(pattern.category);
                }
            }
        });

        // Enhance the text analysis with image-based risk
        if (imageRiskIncrease > 0) {
            textAnalysis.risk_score = Math.min(textAnalysis.risk_score + imageRiskIncrease, 100);
            textAnalysis.flagged_categories = [...new Set([...textAnalysis.flagged_categories, ...additionalCategories])];

            // Update risk level based on new score
            if (textAnalysis.risk_score >= 71) {
                textAnalysis.risk_level = 'danger';
            } else if (textAnalysis.risk_score >= 40) {
                textAnalysis.risk_level = 'warning';
            }

            textAnalysis.explanation += ` Email contains images which, combined with the text content, increases the risk assessment. The presence of images with contextual text like "${combinedText.slice(0, 50)}..." suggests potential policy violations.`;

            // Generate simulated annotations for demonstration
            textAnalysis.annotated_images = attachments.map((attachment, index) => ({
                index: index,
                filename: attachment.filename || `attachment-${index + 1}`,
                contentType: attachment.contentType,
                originalImage: attachment.content.toString('base64'),
                annotationText: `Simulated Analysis: This image has been flagged in combination with email text containing keywords like "${combinedText.split(' ').slice(0, 5).join(' ')}". The image may contain ${additionalCategories.join(' or ').toLowerCase()} content that violates workplace policies. Manual review recommended.`,
                detectedIssues: additionalCategories,
                riskLevel: textAnalysis.risk_level
            }));
        } else {
            textAnalysis.annotated_images = [];
        }

        return textAnalysis;
    }
}

const aiAnalysisService = new AIAnalysisService();

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
        // Extract image attachments from parsed email
        console.log('🔍 Processing email:', {
            subject: email.subject,
            hasAttachments: !!email.attachments,
            attachmentsLength: email.attachments?.length || 0,
            attachmentTypes: email.attachments?.map(a => a.contentType) || []
        });

        const attachments = [];
        if (email.attachments) {
            console.log(`📎 Found ${email.attachments.length} attachments in email`);
            for (const attachment of email.attachments) {
                console.log('📎 Attachment details:', {
                    filename: attachment.filename,
                    contentType: attachment.contentType,
                    size: attachment.size || attachment.content?.length || 0
                });
                if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                    console.log('🖼️ Adding image attachment:', attachment.contentType);
                    attachments.push({
                        filename: attachment.filename || 'unknown',
                        contentType: attachment.contentType,
                        content: attachment.content,
                        size: attachment.size || attachment.content?.length || 0
                    });
                }
            }
        } else {
            console.log('❌ No attachments found in email object');
        }

        console.log(`📎 Final attachment count: ${attachments.length} image attachments extracted`);

        const emailData = {
            userId: userId,
            accountEmail: accountEmail,
            subject: email.subject || '',
            from: email.from?.text || '',
            to: email.to?.text || '',
            date: email.date,
            messageId: email.messageId,
            text: email.text || email.html || '',
            body: email.text || email.html || '',
            attachments: attachments
        };

        // Use AI analysis with image support
        const analysis = await this.analyzeEmail(emailData);

        // Send real-time notification for flagged content
        if (analysis.risk_level === 'danger' || analysis.risk_level === 'warning') {
            this.sendRealTimeNotification(userId, {
                type: 'ai_flagged',
                analysis: {
                    subject: emailData.subject,
                    sender: emailData.from,
                    risk_level: analysis.risk_level,
                    risk_score: analysis.risk_score,
                    flagged_categories: analysis.flagged_categories,
                    hasImages: emailData.attachments && emailData.attachments.length > 0,
                    createdAt: new Date()
                }
            });

            console.log(`AI flagged email from ${emailData.from} (${analysis.risk_level}): ${analysis.flagged_categories?.join(', ')}`);
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

    async fetchRecentEmails(email, appPassword, limit = 20) {
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
            }, 15000);

            imap.once('ready', () => {
                clearTimeout(timeout);
                imap.openBox('INBOX', true, (err, box) => {
                    if (err) {
                        imap.end();
                        reject(err);
                        return;
                    }

                    // Get recent messages (both read and unread)
                    const searchCriteria = ['ALL'];
                    const fetchOptions = {
                        bodies: ['HEADER', 'TEXT'],
                        markSeen: false,
                        struct: true
                    };

                    // Search for recent messages
                    imap.search(searchCriteria, (err, results) => {
                        if (err) {
                            imap.end();
                            reject(err);
                            return;
                        }

                        if (!results || results.length === 0) {
                            imap.end();
                            resolve([]);
                            return;
                        }

                        // Get the most recent messages (reverse order to get newest first)
                        const recentResults = results.slice(-limit).reverse();
                        const fetch = imap.fetch(recentResults, fetchOptions);
                        const emails = [];

                        fetch.on('message', (msg, seqno) => {
                            const email = { seqno, attachments: [] };

                            msg.on('body', (stream, info) => {
                                let buffer = '';
                                stream.on('data', (chunk) => {
                                    buffer += chunk.toString('utf8');
                                });

                                stream.once('end', () => {
                                    if (info.which === 'HEADER') {
                                        const parsed = Imap.parseHeader(buffer);
                                        email.subject = parsed.subject ? parsed.subject[0] : 'No Subject';
                                        email.from = parsed.from ? parsed.from[0] : 'Unknown Sender';
                                        email.to = parsed.to ? parsed.to[0] : '';
                                        email.date = parsed.date ? new Date(parsed.date[0]) : new Date();
                                        email.messageId = parsed['message-id'] ? parsed['message-id'][0] : null;
                                    } else if (info.which === 'TEXT') {
                                        email.text = buffer.substring(0, 1000); // Limit to first 1000 chars
                                    } else if (typeof info.which === 'string' && info.which.startsWith('BODY[')) {
                                        // This is attachment content
                                        const attachmentIndex = email.attachments.findIndex(att => att.partID === info.which);
                                        if (attachmentIndex >= 0) {
                                            email.attachments[attachmentIndex].content = Buffer.from(buffer, 'base64');
                                        }
                                    }
                                });
                            });

                            msg.once('attributes', (attrs) => {
                                email.uid = attrs.uid;
                                email.flags = attrs.flags;
                                email.isRead = attrs.flags.includes('\\Seen');

                                // Process body structure to find attachments
                                if (attrs.struct) {
                                    console.log(`🔍 Email BODYSTRUCTURE for "${email.subject}":`, JSON.stringify(attrs.struct, null, 2));
                                    email.attachments = this.extractAttachmentsFromStructure(attrs.struct);
                                    console.log(`📎 Found ${email.attachments.length} potential attachments in email: ${email.subject}`);
                                }
                            });

                            msg.once('end', () => {
                                emails.push(email);
                            });
                        });

                        fetch.once('error', (err) => {
                            imap.end();
                            reject(err);
                        });

                        fetch.once('end', () => {
                            // Now fetch attachment content for emails that have image attachments
                            const emailsWithAttachments = emails.filter(email => email.attachments && email.attachments.length > 0);

                            if (emailsWithAttachments.length === 0) {
                                imap.end();
                                // Sort by date (newest first)
                                emails.sort((a, b) => new Date(b.date) - new Date(a.date));
                                resolve(emails);
                                return;
                            }

                            console.log(`📎 Fetching attachment content for ${emailsWithAttachments.length} emails`);

                            // Create bodies array for attachment fetching
                            const attachmentBodies = [];
                            emailsWithAttachments.forEach(email => {
                                email.attachments.forEach(att => {
                                    attachmentBodies.push(att.partID);
                                });
                            });

                            // Create a map of UIDs for emails with attachments
                            const uidToEmail = {};
                            emailsWithAttachments.forEach(email => {
                                uidToEmail[email.uid] = email;
                            });

                            // Fetch attachment content
                            const uids = emailsWithAttachments.map(email => email.uid);
                            const attachmentFetch = imap.fetch(uids, {
                                bodies: attachmentBodies,
                                markSeen: false
                            });

                            attachmentFetch.on('message', (msg, seqno) => {
                                let currentEmail = null;

                                msg.once('attributes', (attrs) => {
                                    currentEmail = uidToEmail[attrs.uid];
                                });

                                msg.on('body', (stream, info) => {
                                    let buffer = '';
                                    stream.on('data', (chunk) => {
                                        buffer += chunk.toString('binary');
                                    });

                                    stream.once('end', () => {
                                        if (currentEmail && info.which.startsWith('BODY[')) {
                                            const attachment = currentEmail.attachments.find(att => att.partID === info.which);
                                            if (attachment) {
                                                attachment.content = Buffer.from(buffer, 'binary');
                                                console.log(`📥 Fetched ${attachment.filename}: ${attachment.content.length} bytes`);
                                            }
                                        }
                                    });
                                });
                            });

                            attachmentFetch.once('end', () => {
                                imap.end();
                                // Sort by date (newest first)
                                emails.sort((a, b) => new Date(b.date) - new Date(a.date));
                                resolve(emails);
                            });

                            attachmentFetch.once('error', (err) => {
                                console.error('Error fetching attachments:', err);
                                imap.end();
                                // Still resolve with emails, just without attachment content
                                emails.sort((a, b) => new Date(b.date) - new Date(a.date));
                                resolve(emails);
                            });
                        });
                    });
                });
            });

            imap.once('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });

            imap.connect();
        });
    }

    extractAttachmentsFromStructure(struct, path = '1') {
        const attachments = [];

        if (Array.isArray(struct)) {
            // Multipart message
            struct.forEach((part, index) => {
                if (index < struct.length - 1) { // Skip the last element (multipart subtype)
                    const partPath = path === '1' ? (index + 1).toString() : `${path}.${index + 1}`;
                    const partAttachments = this.extractAttachmentsFromStructure(part, partPath);
                    attachments.push(...partAttachments);
                }
            });
        } else {
            // Single part
            const type = struct.type ? struct.type.toLowerCase() : '';
            const subtype = struct.subtype ? struct.subtype.toLowerCase() : '';
            const contentType = `${type}/${subtype}`;

            // Check if this is an image attachment
            if (type === 'image') {
                const disposition = struct.disposition || {};
                const params = struct.params || {};
                const filename = disposition.params?.filename || params.name || `attachment-${path}.${subtype}`;

                console.log(`🖼️ Found image attachment: ${contentType} - ${filename}`);

                attachments.push({
                    partID: `BODY[${path}]`,
                    contentType: contentType,
                    filename: filename,
                    size: struct.size || 0,
                    encoding: struct.encoding || 'base64',
                    content: null // Will be filled later when fetching
                });
            }
        }

        return attachments;
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
            let userId;

            if (db) {
                // Save or update user in MySQL
                const [existing] = await db.execute(
                    'SELECT id FROM users WHERE email = ?',
                    [email]
                );

                if (existing.length > 0) {
                    // Update existing user
                    userId = existing[0].id;
                    await db.execute(
                        'UPDATE users SET encrypted_password = ?, last_sync = CURRENT_TIMESTAMP WHERE id = ?',
                        [encrypt(appPassword), userId]
                    );
                } else {
                    // Create new user
                    const [insertResult] = await db.execute(
                        'INSERT INTO users (email, encrypted_password) VALUES (?, ?)',
                        [email, encrypt(appPassword)]
                    );
                    userId = insertResult.insertId;
                }
            } else {
                // Demo mode
                userId = 'demo_' + Date.now();
            }

            // Generate JWT token
            const token = jwt.sign(
                { userId, email },
                process.env.JWT_SECRET || 'safai-secret-key',
                { expiresIn: '24h' }
            );

            res.json({
                success: true,
                message: 'Connected to Gmail successfully',
                token,
                userId,
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

        let user = null;
        let appPassword = null;

        if (db) {
            // Get user from database
            const [users] = await db.execute(
                'SELECT id, encrypted_password FROM users WHERE id = ?',
                [decoded.userId]
            );

            if (users.length === 0) {
                return res.status(404).json({ success: false, message: 'User not found' });
            }

            user = users[0];
            appPassword = decrypt(user.encrypted_password);

            // Create monitoring configuration
            await db.execute(
                `INSERT INTO monitoring_configs (user_id, email, sensitivity, categories, frequency, notifications)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    user.id,
                    email,
                    sensitivity,
                    JSON.stringify(categories),
                    frequency,
                    JSON.stringify(notifications)
                ]
            );
        } else {
            // Demo mode - use hardcoded credentials for testing
            appPassword = 'fqiqgkaymynvrqsd'; // Your test app password
        }

        // Start monitoring
        const result = await gmailService.startMonitoring(decoded.userId, email, appPassword, {
            sensitivity,
            categories,
            frequency
        });

        res.json({
            success: true,
            message: 'Monitoring started successfully',
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

        if (db) {
            const [violations] = await db.execute(
                `SELECT id, message_id, account_email, subject, sender, content, violations,
                        overall_severity, status, received_at, created_at
                 FROM violations WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
                [decoded.userId]
            );

            // Parse JSON fields
            const parsedViolations = violations.map(v => ({
                ...v,
                violations: JSON.parse(v.violations)
            }));

            res.json({
                success: true,
                violations: parsedViolations
            });
        } else {
            // Demo mode
            res.json({
                success: true,
                violations: []
            });
        }

    } catch (error) {
        console.error('Error fetching violations:', error);
        res.status(500).json({ error: 'Failed to fetch violations' });
    }
});

// Get emails from Gmail
app.get('/api/emails', async (req, res) => {
    try {
        const { authorization } = req.headers;
        if (!authorization) {
            return res.status(401).json({ error: 'No authorization token' });
        }

        const token = authorization.replace('Bearer ', '');

        // Demo mode bypass for testing
        let decoded;
        if (token === 'DEMO_MODE') {
            decoded = { userId: 1, email: 'hackathonreceiver1@gmail.com' };
        } else {
            decoded = jwt.verify(token, process.env.JWT_SECRET || 'safai-secret-key');
        }

        let user = null;
        let appPassword = null;

        if (db) {
            // Get user from database
            const [users] = await db.execute(
                'SELECT id, email, encrypted_password FROM users WHERE id = ?',
                [decoded.userId]
            );

            if (users.length === 0) {
                return res.status(404).json({ success: false, message: 'User not found' });
            }

            user = users[0];
            appPassword = decrypt(user.encrypted_password);
        } else {
            // Demo mode
            appPassword = 'fqiqgkaymynvrqsd';
            user = { email: decoded.email };
        }

        // Fetch emails from Gmail
        const emails = await gmailService.fetchRecentEmails(user.email, appPassword, 20);

        // Perform AI analysis on each email
        const analyzedEmails = [];
        for (const email of emails) {
            try {
                // Prepare email data for AI analysis
                const emailData = {
                    userId: user.id || 1,
                    messageId: email.messageId,
                    accountEmail: user.email,
                    subject: email.subject,
                    from: email.from,
                    text: email.text,
                    date: email.date,
                    attachments: email.attachments || []
                };

                // Perform AI analysis
                const analysis = await aiAnalysisService.analyzeEmail(emailData);

                // Add analysis results to email object
                email.aiAnalysis = analysis;
                email.riskLevel = analysis.risk_level;
                email.riskScore = analysis.risk_score;
                email.flaggedCategories = analysis.flagged_categories;
                email.explanation = analysis.explanation;
                email.annotatedImages = analysis.annotated_images || [];

                analyzedEmails.push(email);
            } catch (analysisError) {
                console.error('AI analysis failed for email:', email.messageId, analysisError);
                // Add email without analysis on error
                email.aiAnalysis = { risk_level: 'safe', risk_score: 0, explanation: 'Analysis failed' };
                email.riskLevel = 'safe';
                email.riskScore = 0;
                email.flaggedCategories = [];
                email.explanation = 'Analysis failed - marked as safe';
                email.annotatedImages = [];
                analyzedEmails.push(email);
            }
        }

        res.json({
            success: true,
            emails: analyzedEmails
        });

    } catch (error) {
        console.error('Error fetching emails:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch emails',
            message: error.message
        });
    }
});

// Get connected accounts endpoint
app.get('/api/accounts', async (req, res) => {
    try {
        if (db) {
            // Get all connected accounts from database
            const [rows] = await db.execute(`
                SELECT id, email, is_active, created_at, last_sync
                FROM users
                WHERE is_active = TRUE
                ORDER BY last_sync DESC
            `);

            res.json({
                success: true,
                accounts: rows.map(row => ({
                    id: row.id,
                    email: row.email,
                    isActive: row.is_active,
                    connectedAt: row.created_at,
                    lastSync: row.last_sync
                }))
            });
        } else {
            // Demo mode - return empty array
            res.json({
                success: true,
                accounts: []
            });
        }
    } catch (error) {
        console.error('Error fetching accounts:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch connected accounts'
        });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date(),
        activeMonitors: gmailService.activeMonitors.size,
        activeConnections: activeConnections.size,
        service: 'MySQL IMAP Gmail Monitoring',
        database: db ? 'Connected' : 'Demo Mode'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`SafAI MySQL server running on port ${PORT}`);
    console.log('WebSocket server running on port 8080');
    console.log('Using Gmail IMAP with MySQL database');
});

module.exports = app;