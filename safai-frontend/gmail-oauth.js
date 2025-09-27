// Gmail OAuth 2.0 Integration for SafAI
// This implements real Gmail API access using OAuth 2.0

class GmailOAuthManager {
    constructor() {
        // Replace these with your actual Google Cloud Console credentials
        this.CLIENT_ID = 'YOUR_ACTUAL_CLIENT_ID.googleusercontent.com'; // Replace with your Client ID
        this.API_KEY = 'YOUR_ACTUAL_API_KEY'; // Replace with your API Key
        this.DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest';
        this.SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email';

        this.gapi = null;
        this.googleAuth = null;
        this.isSignedIn = false;
        this.currentUser = null;
        this.monitoringAccounts = new Map();
    }

    async initializeGoogleAPI() {
        try {
            // Load Google API client
            await this.loadGoogleAPI();

            // Initialize the API client
            await gapi.load('client:auth2', async () => {
                await gapi.client.init({
                    apiKey: this.API_KEY,
                    clientId: this.CLIENT_ID,
                    discoveryDocs: [this.DISCOVERY_DOC],
                    scope: this.SCOPES
                });

                this.googleAuth = gapi.auth2.getAuthInstance();
                this.isSignedIn = this.googleAuth.isSignedIn.get();

                console.log('Google API initialized successfully');
                this.updateUIBasedOnSignInStatus();
            });
        } catch (error) {
            console.error('Error initializing Google API:', error);
            this.showSetupInstructions();
        }
    }

    loadGoogleAPI() {
        return new Promise((resolve, reject) => {
            if (typeof gapi !== 'undefined') {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://apis.google.com/js/api.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    async signIn() {
        try {
            const authResult = await this.googleAuth.signIn();
            this.currentUser = authResult;
            this.isSignedIn = true;

            const profile = authResult.getBasicProfile();
            const userInfo = {
                id: profile.getId(),
                email: profile.getEmail(),
                name: profile.getName(),
                imageUrl: profile.getImageUrl(),
                accessToken: authResult.getAuthResponse().access_token
            };

            console.log('User signed in:', userInfo);
            this.displayConnectedAccount(userInfo);

            return userInfo;
        } catch (error) {
            console.error('Sign-in failed:', error);
            this.showAuthError(error);
            throw error;
        }
    }

    async signOut() {
        try {
            await this.googleAuth.signOut();
            this.isSignedIn = false;
            this.currentUser = null;
            this.updateUIBasedOnSignInStatus();
            console.log('User signed out');
        } catch (error) {
            console.error('Sign-out failed:', error);
        }
    }

    async startMonitoring(userInfo, monitoringConfig) {
        try {
            const accountId = userInfo.email;

            // Create monitoring configuration
            const config = {
                email: userInfo.email,
                accessToken: userInfo.accessToken,
                sensitivity: monitoringConfig.sensitivity || 'medium',
                categories: monitoringConfig.categories || ['harassment', 'discrimination'],
                frequency: monitoringConfig.frequency || 'realtime',
                notifications: monitoringConfig.notifications || ['email', 'dashboard']
            };

            // Store account for monitoring
            this.monitoringAccounts.set(accountId, {
                ...config,
                status: 'active',
                startTime: new Date(),
                lastCheck: null,
                messageCount: 0,
                violationCount: 0
            });

            // Start the monitoring process
            await this.beginEmailMonitoring(accountId);

            // Save to backend
            await this.saveMonitoringConfig(config);

            return {
                success: true,
                accountId,
                message: 'Monitoring started successfully'
            };
        } catch (error) {
            console.error('Failed to start monitoring:', error);
            throw error;
        }
    }

    async beginEmailMonitoring(accountId) {
        const account = this.monitoringAccounts.get(accountId);
        if (!account) return;

        console.log(`Starting monitoring for ${accountId}`);

        // Set up periodic email checking
        const checkInterval = this.getCheckInterval(account.frequency);

        account.monitoringInterval = setInterval(async () => {
            try {
                await this.checkNewEmails(accountId);
            } catch (error) {
                console.error(`Error checking emails for ${accountId}:`, error);
                this.handleMonitoringError(accountId, error);
            }
        }, checkInterval);

        // Perform initial email scan
        await this.checkNewEmails(accountId);
    }

    async checkNewEmails(accountId) {
        const account = this.monitoringAccounts.get(accountId);
        if (!account) return;

        try {
            // Get recent emails using Gmail API
            const response = await gapi.client.gmail.users.messages.list({
                userId: 'me',
                q: account.lastCheck ? `after:${account.lastCheck.getTime() / 1000}` : 'is:unread',
                maxResults: 100
            });

            if (response.result.messages) {
                for (const message of response.result.messages) {
                    await this.processEmail(accountId, message.id);
                }
            }

            account.lastCheck = new Date();
            this.updateAccountStats(accountId);

        } catch (error) {
            console.error('Error fetching emails:', error);
            throw error;
        }
    }

    async processEmail(accountId, messageId) {
        try {
            // Get full message details
            const messageResponse = await gapi.client.gmail.users.messages.get({
                userId: 'me',
                id: messageId,
                format: 'full'
            });

            const message = messageResponse.result;
            const account = this.monitoringAccounts.get(accountId);

            // Extract email content
            const emailData = this.extractEmailContent(message);

            // Analyze content for violations
            const analysis = await this.analyzeEmailContent(emailData, account);

            // Update statistics
            account.messageCount++;

            if (analysis.hasViolation) {
                account.violationCount++;
                await this.handleViolation(accountId, emailData, analysis);
            }

            // Update UI
            this.updateMonitoringDashboard(accountId);

        } catch (error) {
            console.error('Error processing email:', error);
        }
    }

    extractEmailContent(message) {
        const headers = message.payload.headers;
        const emailData = {
            id: message.id,
            threadId: message.threadId,
            subject: this.getHeader(headers, 'Subject'),
            from: this.getHeader(headers, 'From'),
            to: this.getHeader(headers, 'To'),
            date: this.getHeader(headers, 'Date'),
            body: this.getMessageBody(message.payload)
        };

        return emailData;
    }

    getHeader(headers, name) {
        const header = headers.find(h => h.name === name);
        return header ? header.value : '';
    }

    getMessageBody(payload) {
        let body = '';

        if (payload.body && payload.body.data) {
            body = atob(payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
        } else if (payload.parts) {
            for (const part of payload.parts) {
                if (part.mimeType === 'text/plain' && part.body.data) {
                    body += atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'));
                }
            }
        }

        return body;
    }

    async analyzeEmailContent(emailData, account) {
        // This would integrate with your AI analysis service
        // For now, implementing basic keyword detection

        const violationKeywords = {
            harassment: ['harass', 'bully', 'intimidate', 'threaten'],
            discrimination: ['discriminate', 'racist', 'sexist', 'bigot'],
            inappropriate: ['inappropriate', 'offensive', 'vulgar'],
            threats: ['threat', 'kill', 'harm', 'violence']
        };

        const analysis = {
            hasViolation: false,
            violations: [],
            severity: 'low',
            confidence: 0
        };

        const content = (emailData.subject + ' ' + emailData.body).toLowerCase();

        // Check each category if enabled
        for (const category of account.categories) {
            if (violationKeywords[category]) {
                for (const keyword of violationKeywords[category]) {
                    if (content.includes(keyword)) {
                        analysis.hasViolation = true;
                        analysis.violations.push({
                            category,
                            keyword,
                            context: this.extractContext(content, keyword)
                        });
                    }
                }
            }
        }

        // Calculate severity and confidence
        if (analysis.violations.length > 0) {
            analysis.severity = analysis.violations.length > 2 ? 'high' : 'medium';
            analysis.confidence = Math.min(0.9, analysis.violations.length * 0.3);
        }

        return analysis;
    }

    extractContext(content, keyword) {
        const index = content.indexOf(keyword);
        const start = Math.max(0, index - 50);
        const end = Math.min(content.length, index + 50);
        return content.substring(start, end);
    }

    async handleViolation(accountId, emailData, analysis) {
        console.log('Violation detected:', {
            account: accountId,
            email: emailData.id,
            violations: analysis.violations
        });

        // Create violation record
        const violation = {
            id: this.generateViolationId(),
            accountId,
            emailId: emailData.id,
            timestamp: new Date(),
            emailData,
            analysis,
            status: 'new'
        };

        // Send notifications
        await this.sendViolationNotifications(violation);

        // Update dashboard
        this.displayViolationAlert(violation);

        // Save to backend
        await this.saveViolation(violation);
    }

    async sendViolationNotifications(violation) {
        const account = this.monitoringAccounts.get(violation.accountId);

        if (account.notifications.includes('email')) {
            await this.sendEmailNotification(violation);
        }

        if (account.notifications.includes('dashboard')) {
            this.showDashboardAlert(violation);
        }
    }

    // UI Update Methods
    updateUIBasedOnSignInStatus() {
        const connectBtn = document.querySelector('.gmail-oauth-btn');
        const connectedAccount = document.getElementById('connected-account');

        if (this.isSignedIn && this.currentUser) {
            const profile = this.currentUser.getBasicProfile();
            this.displayConnectedAccount({
                email: profile.getEmail(),
                name: profile.getName(),
                imageUrl: profile.getImageUrl()
            });
        } else {
            if (connectBtn) connectBtn.style.display = 'block';
            if (connectedAccount) connectedAccount.style.display = 'none';
        }
    }

    displayConnectedAccount(userInfo) {
        const connectBtn = document.querySelector('.gmail-oauth-btn');
        const connectedAccount = document.getElementById('connected-account');
        const userEmail = document.getElementById('user-email');
        const profileImage = document.getElementById('profile-image');

        if (connectBtn) connectBtn.style.display = 'none';
        if (connectedAccount) connectedAccount.style.display = 'block';

        if (userEmail) userEmail.textContent = userInfo.email;
        if (profileImage && userInfo.imageUrl) {
            profileImage.innerHTML = `<img src="${userInfo.imageUrl}" alt="Profile" style="width: 100%; height: 100%; border-radius: 50%;">`;
        }

        // Enable next step
        const nextBtn = document.getElementById('next-btn');
        if (nextBtn) {
            nextBtn.disabled = false;
            nextBtn.innerHTML = 'Next <i class="fas fa-arrow-right"></i>';
        }
    }

    showSetupInstructions() {
        const modal = document.createElement('div');
        modal.className = 'setup-instructions-modal';
        modal.innerHTML = `
            <div class="setup-modal-content">
                <h3>Google API Setup Required</h3>
                <p>To enable real Gmail monitoring, you need to set up Google Cloud credentials:</p>
                <ol>
                    <li>Go to <a href="https://console.cloud.google.com" target="_blank">Google Cloud Console</a></li>
                    <li>Create a new project or select existing one</li>
                    <li>Enable the Gmail API</li>
                    <li>Create OAuth 2.0 credentials</li>
                    <li>Add your domain to authorized origins</li>
                    <li>Update CLIENT_ID and API_KEY in gmail-oauth.js</li>
                </ol>
                <div class="setup-actions">
                    <button onclick="this.parentElement.parentElement.parentElement.remove()">Got it</button>
                    <a href="https://developers.google.com/gmail/api/quickstart/js" target="_blank">View Documentation</a>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    // Utility methods
    getCheckInterval(frequency) {
        const intervals = {
            realtime: 10000,    // 10 seconds
            '30s': 30000,       // 30 seconds
            '1m': 60000,        // 1 minute
            '5m': 300000        // 5 minutes
        };
        return intervals[frequency] || intervals.realtime;
    }

    generateViolationId() {
        return 'violation_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    async saveMonitoringConfig(config) {
        // Save to your backend API
        try {
            const response = await fetch('/api/monitoring/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });
            return response.json();
        } catch (error) {
            console.warn('Could not save to backend:', error);
        }
    }

    async saveViolation(violation) {
        // Save violation to your backend
        try {
            const response = await fetch('/api/violations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(violation)
            });
            return response.json();
        } catch (error) {
            console.warn('Could not save violation to backend:', error);
        }
    }
}

// Initialize the Gmail OAuth manager
const gmailOAuth = new GmailOAuthManager();

// Global functions for the UI
window.initiateGmailAuth = async function() {
    try {
        const connectBtn = document.querySelector('.gmail-oauth-btn');
        connectBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connecting...';
        connectBtn.disabled = true;

        await gmailOAuth.initializeGoogleAPI();
        const userInfo = await gmailOAuth.signIn();

        console.log('Gmail authentication successful:', userInfo);

    } catch (error) {
        console.error('Gmail authentication failed:', error);
        const connectBtn = document.querySelector('.gmail-oauth-btn');
        connectBtn.innerHTML = '<i class="fab fa-google"></i> Connect with Gmail';
        connectBtn.disabled = false;

        alert('Authentication failed. Please try again or check your setup.');
    }
};

window.startGmailMonitoring = async function(config) {
    try {
        if (!gmailOAuth.isSignedIn || !gmailOAuth.currentUser) {
            throw new Error('User not authenticated');
        }

        const profile = gmailOAuth.currentUser.getBasicProfile();
        const userInfo = {
            email: profile.getEmail(),
            name: profile.getName(),
            accessToken: gmailOAuth.currentUser.getAuthResponse().access_token
        };

        const result = await gmailOAuth.startMonitoring(userInfo, config);
        console.log('Monitoring started:', result);

        return result;
    } catch (error) {
        console.error('Failed to start monitoring:', error);
        throw error;
    }
};

// Initialize when page loads
document.addEventListener('DOMContentLoaded', function() {
    gmailOAuth.initializeGoogleAPI().catch(console.error);
});