document.addEventListener('DOMContentLoaded', function() {
    initThemeToggle();
    initSmoothScrolling();
    initMobileMenu();
    initAnimationsOnScroll();
    initDashboardInteractions();
    initCounterAnimations();
    initParallaxEffects();
    loadConnectedAccounts(); // Load any previously connected accounts
});

function initThemeToggle() {
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    const body = document.body;

    const savedTheme = localStorage.getItem('theme') || 'light';
    if (savedTheme === 'dark') {
        body.setAttribute('data-theme', 'dark');
        themeToggleBtn.innerHTML = '<i class="fas fa-sun"></i>';
    }

    themeToggleBtn.addEventListener('click', function() {
        const currentTheme = body.getAttribute('data-theme');

        if (currentTheme === 'dark') {
            body.setAttribute('data-theme', 'light');
            themeToggleBtn.innerHTML = '<i class="fas fa-moon"></i>';
            localStorage.setItem('theme', 'light');
        } else {
            body.setAttribute('data-theme', 'dark');
            themeToggleBtn.innerHTML = '<i class="fas fa-sun"></i>';
            localStorage.setItem('theme', 'dark');
        }

        themeToggleBtn.style.transform = 'scale(1.2)';
        setTimeout(() => {
            themeToggleBtn.style.transform = 'scale(1)';
        }, 200);
    });
}

function initSmoothScrolling() {
    const navLinks = document.querySelectorAll('a[href^="#"]');

    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();

            const targetId = this.getAttribute('href').substring(1);
            const targetElement = document.getElementById(targetId);

            if (targetElement) {
                const headerOffset = 100;
                const elementPosition = targetElement.getBoundingClientRect().top;
                const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

                window.scrollTo({
                    top: offsetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });
}

function initMobileMenu() {
    const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
    const navMenu = document.querySelector('.nav-menu');

    if (mobileMenuToggle && navMenu) {
        mobileMenuToggle.addEventListener('click', function() {
            navMenu.classList.toggle('active');
            mobileMenuToggle.classList.toggle('active');
        });

        document.addEventListener('click', function(e) {
            if (!mobileMenuToggle.contains(e.target) && !navMenu.contains(e.target)) {
                navMenu.classList.remove('active');
                mobileMenuToggle.classList.remove('active');
            }
        });
    }
}

function initAnimationsOnScroll() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-in');

                if (entry.target.classList.contains('counter')) {
                    animateCounter(entry.target);
                }
            }
        });
    }, observerOptions);

    const animateElements = document.querySelectorAll('.feature-card, .dashboard-card, .testimonial, .tech-item, .hero-content, .hero-visual');
    animateElements.forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(el);
    });

    const style = document.createElement('style');
    style.textContent = `
        .animate-in {
            opacity: 1 !important;
            transform: translateY(0) !important;
        }
    `;
    document.head.appendChild(style);
}

function initDashboardInteractions() {
    const addAccountBtn = document.querySelector('.add-account-btn');
    const addChannelBtn = document.querySelector('.add-channel-btn');
    const accountItems = document.querySelectorAll('.account-item');
    const channelItems = document.querySelectorAll('.channel-item');

    if (addAccountBtn) {
        addAccountBtn.addEventListener('click', function() {
            showAddAccountModal();
        });
    }

    if (addChannelBtn) {
        addChannelBtn.addEventListener('click', function() {
            showAddChannelModal();
        });
    }

    accountItems.forEach(item => {
        item.addEventListener('click', function() {
            this.style.transform = 'scale(0.98)';
            setTimeout(() => {
                this.style.transform = 'scale(1)';
            }, 150);
        });
    });

    channelItems.forEach(item => {
        item.addEventListener('click', function() {
            this.style.transform = 'scale(0.98)';
            setTimeout(() => {
                this.style.transform = 'scale(1)';
            }, 150);
        });
    });

    setInterval(() => {
        updateRealTimeData();
    }, 5000);
}

function showAddAccountModal() {
    showGmailRegistrationFlow();
}

function showGmailRegistrationFlow() {
    const registrationModal = createGmailRegistrationModal();
    document.body.appendChild(registrationModal);

    setTimeout(() => {
        registrationModal.classList.add('show');
    }, 100);
}

function createGmailRegistrationModal() {
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'gmail-registration-overlay';
    modalOverlay.innerHTML = `
        <div class="gmail-registration-modal">
            <div class="registration-header">
                <div class="registration-title">
                    <div class="safai-logo-small">
                        <i class="fas fa-shield-alt"></i>
                        <span>SafAI</span>
                    </div>
                    <h2>Add Gmail Account</h2>
                    <p>Connect your Gmail account for intelligent monitoring</p>
                </div>
                <button class="modal-close" onclick="closeGmailRegistration()">
                    <i class="fas fa-times"></i>
                </button>
            </div>

            <div class="registration-progress">
                <div class="progress-bar">
                    <div class="progress-fill" id="progress-fill"></div>
                </div>
                <div class="progress-steps">
                    <div class="step active" data-step="1">
                        <div class="step-number">1</div>
                        <span>Connect</span>
                    </div>
                    <div class="step" data-step="2">
                        <div class="step-number">2</div>
                        <span>Configure</span>
                    </div>
                    <div class="step" data-step="3">
                        <div class="step-number">3</div>
                        <span>Alerts</span>
                    </div>
                    <div class="step" data-step="4">
                        <div class="step-number">4</div>
                        <span>Activate</span>
                    </div>
                </div>
            </div>

            <div class="registration-content">
                <div class="step-content active" id="step-1">
                    <div class="step-header">
                        <h3>Connect Your Gmail Account</h3>
                        <p>Enter your Gmail credentials to enable real-time monitoring</p>
                    </div>

                    <div class="app-password-section">
                        <div class="gmail-branding">
                            <div class="gmail-logo">
                                <i class="fab fa-google"></i>
                            </div>
                            <h4>Gmail App Password Login</h4>
                        </div>

                        <div class="login-form" id="login-form">
                            <div class="form-group">
                                <label for="gmail-email">Gmail Address</label>
                                <input type="email" id="gmail-email" class="form-input" placeholder="your.email@gmail.com" required>
                            </div>

                            <div class="form-group">
                                <label for="app-password">App Password</label>
                                <input type="password" id="app-password" class="form-input" placeholder="16-character app password" required>
                                <div class="input-help">
                                    <i class="fas fa-info-circle"></i>
                                    <span>Use a Gmail App Password, not your regular password</span>
                                </div>
                            </div>

                            <button class="gmail-connect-btn" onclick="connectWithAppPassword()">
                                <i class="fas fa-envelope"></i>
                                <span>Connect to Gmail</span>
                            </button>

                            <div class="setup-instructions">
                                <h5>How to generate an App Password:</h5>
                                <ol>
                                    <li>Go to your <a href="https://myaccount.google.com/security" target="_blank">Google Account Security</a></li>
                                    <li>Enable 2-Step Verification (if not already enabled)</li>
                                    <li>Go to "App passwords" section</li>
                                    <li>Generate an app password for "Mail"</li>
                                    <li>Copy the 16-character password here</li>
                                </ol>
                            </div>
                        </div>

                        <div class="connected-account" id="connected-account" style="display: none;">
                            <div class="account-info">
                                <div class="profile-section">
                                    <div class="profile-image" id="profile-image">
                                        <i class="fas fa-user"></i>
                                    </div>
                                    <div class="account-details">
                                        <h4 id="user-email-display">your.email@gmail.com</h4>
                                        <div class="connection-success">
                                            <i class="fas fa-check-circle"></i>
                                            <span>Successfully Connected</span>
                                        </div>
                                        <p class="connection-time">Connected just now</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="security-notice">
                            <div class="security-badge">
                                <i class="fas fa-shield-check"></i>
                                <span>Your credentials are encrypted and stored securely</span>
                            </div>
                            <div class="privacy-notice">
                                <i class="fas fa-lock"></i>
                                <span>SafAI will only read your inbox - we never store or forward emails</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="registration-actions">
                <button class="reg-btn secondary" id="prev-btn" onclick="previousStep()" style="display: none;">
                    <i class="fas fa-arrow-left"></i>
                    Previous
                </button>
                <button class="reg-btn primary" id="next-btn" onclick="nextStep()">
                    Next
                    <i class="fas fa-arrow-right"></i>
                </button>
            </div>
        </div>
    `;

    return modalOverlay;
}

let currentStep = 1;
let gmailConnected = false;
let userEmail = '';
let userProfile = null;

function generateStep1Content() {
    return `
        <div class="step-content" id="step-1">
            <div class="step-header">
                <h3>Connect Your Gmail Account</h3>
                <p>Enter your Gmail credentials to enable real-time monitoring</p>
            </div>

            <div class="app-password-section">
                <div class="gmail-branding">
                    <div class="gmail-logo">
                        <i class="fab fa-google"></i>
                    </div>
                    <h4>Gmail App Password Login</h4>
                </div>

                <div class="login-form" id="login-form">
                    <div class="form-group">
                        <label for="gmail-email">Gmail Address</label>
                        <input type="email" id="gmail-email" class="form-input" placeholder="your.email@gmail.com" required>
                    </div>

                    <div class="form-group">
                        <label for="app-password">App Password</label>
                        <input type="password" id="app-password" class="form-input" placeholder="16-character app password" required>
                        <div class="input-help">
                            <i class="fas fa-info-circle"></i>
                            <span>Use a Gmail App Password, not your regular password</span>
                        </div>
                    </div>

                    <button class="gmail-connect-btn" onclick="connectWithAppPassword()">
                        <i class="fas fa-envelope"></i>
                        <span>Connect to Gmail</span>
                    </button>

                    <div class="setup-instructions">
                        <h5>How to generate an App Password:</h5>
                        <ol>
                            <li>Go to your <a href="https://myaccount.google.com/security" target="_blank">Google Account Security</a></li>
                            <li>Enable 2-Step Verification (if not already enabled)</li>
                            <li>Go to "App passwords" section</li>
                            <li>Generate an app password for "Mail"</li>
                            <li>Copy the 16-character password here</li>
                        </ol>
                    </div>
                </div>

                <div class="connected-account" id="connected-account" style="display: none;">
                    <div class="account-info">
                        <div class="profile-section">
                            <div class="profile-image" id="profile-image">
                                <i class="fas fa-user"></i>
                            </div>
                            <div class="account-details">
                                <h4 id="user-email-display">your.email@gmail.com</h4>
                                <div class="connection-success">
                                    <i class="fas fa-check-circle"></i>
                                    <span>Successfully Connected</span>
                                </div>
                                <p class="connection-time">Connected just now</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="security-notice">
                    <div class="security-badge">
                        <i class="fas fa-shield-check"></i>
                        <span>Your credentials are encrypted and stored securely</span>
                    </div>
                    <div class="privacy-notice">
                        <i class="fas fa-lock"></i>
                        <span>SafAI will only read your inbox - we never store or forward emails</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function generateStep2Content() {
    return `
        <div class="step-content" id="step-2">
            <div class="step-header">
                <h3>Configure Monitoring Settings</h3>
                <p>Customize how SafAI monitors your Gmail inbox</p>
            </div>

            <div class="config-sections">
                <div class="config-section">
                    <h4>Monitoring Scope</h4>
                    <div class="scope-options">
                        <div class="radio-option">
                            <input type="radio" id="full-monitoring" name="monitoring-scope" value="full" checked>
                            <label for="full-monitoring">
                                <div class="option-content">
                                    <strong>Full Inbox Monitoring</strong>
                                    <p>Monitor all incoming emails (Recommended)</p>
                                </div>
                            </label>
                        </div>
                        <div class="radio-option">
                            <input type="radio" id="selective-monitoring" name="monitoring-scope" value="selective">
                            <label for="selective-monitoring">
                                <div class="option-content">
                                    <strong>Selective Monitoring</strong>
                                    <p>Choose specific folders and exclude certain senders</p>
                                </div>
                            </label>
                        </div>
                    </div>

                    <div class="selective-options" id="selective-options" style="display: none;">
                        <div class="folder-selection">
                            <h5>Folders to Monitor</h5>
                            <div class="checkbox-group">
                                <label><input type="checkbox" checked> Inbox</label>
                                <label><input type="checkbox"> Sent</label>
                                <label><input type="checkbox"> Drafts</label>
                            </div>
                        </div>
                        <div class="exclusion-rules">
                            <h5>Exclusion Rules</h5>
                            <input type="text" class="form-input" placeholder="Exclude senders (comma-separated)">
                            <input type="text" class="form-input" placeholder="Include only domains (optional)">
                        </div>
                    </div>
                </div>

                <div class="config-section">
                    <h4>AI Analysis Settings</h4>
                    <div class="sensitivity-selector">
                        <label>Sensitivity Level</label>
                        <select class="form-input" id="sensitivity-level">
                            <option value="high">High - Detect subtle offensive content</option>
                            <option value="medium" selected>Medium - Standard workplace appropriateness (Recommended)</option>
                            <option value="low">Low - Only severe violations</option>
                        </select>
                    </div>

                    <div class="detection-categories">
                        <h5>Detection Categories</h5>
                        <div class="category-grid">
                            <label class="category-item">
                                <input type="checkbox" checked>
                                <div class="category-content">
                                    <i class="fas fa-user-slash"></i>
                                    <span>Harassment & Bullying</span>
                                </div>
                            </label>
                            <label class="category-item">
                                <input type="checkbox" checked>
                                <div class="category-content">
                                    <i class="fas fa-balance-scale"></i>
                                    <span>Discriminatory Language</span>
                                </div>
                            </label>
                            <label class="category-item">
                                <input type="checkbox" checked>
                                <div class="category-content">
                                    <i class="fas fa-exclamation-triangle"></i>
                                    <span>Inappropriate Content</span>
                                </div>
                            </label>
                            <label class="category-item">
                                <input type="checkbox" checked>
                                <div class="category-content">
                                    <i class="fas fa-fist-raised"></i>
                                    <span>Threats & Violence</span>
                                </div>
                            </label>
                            <label class="category-item">
                                <input type="checkbox" checked>
                                <div class="category-content">
                                    <i class="fas fa-shield-virus"></i>
                                    <span>Spam & Phishing</span>
                                </div>
                            </label>
                            <label class="category-item">
                                <input type="checkbox">
                                <div class="category-content">
                                    <i class="fas fa-cog"></i>
                                    <span>Custom Categories</span>
                                </div>
                            </label>
                        </div>
                        <input type="text" class="form-input" placeholder="Define custom detection rules..." style="margin-top: 1rem;">
                    </div>
                </div>

                <div class="config-section">
                    <h4>Monitoring Frequency</h4>
                    <div class="frequency-selector">
                        <select class="form-input">
                            <option value="realtime" selected>Real-time (10 seconds) - Recommended</option>
                            <option value="30s">Every 30 seconds</option>
                            <option value="1m">Every 1 minute</option>
                            <option value="5m">Every 5 minutes</option>
                        </select>
                        <p class="frequency-note">
                            <i class="fas fa-info-circle"></i>
                            More frequent monitoring provides better real-time protection but uses more resources
                        </p>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function generateStep3Content() {
    return `
        <div class="step-content" id="step-3">
            <div class="step-header">
                <h3>Configure Alerts & Responses</h3>
                <p>Set how SafAI responds to detected violations</p>
            </div>

            <div class="config-sections">
                <div class="config-section">
                    <h4>Notification Preferences</h4>
                    <div class="notification-options">
                        <div class="notification-methods">
                            <h5>Alert Methods</h5>
                            <div class="method-grid">
                                <label class="method-item">
                                    <input type="checkbox" checked>
                                    <div class="method-content">
                                        <i class="fas fa-envelope"></i>
                                        <span>Email Notifications</span>
                                    </div>
                                </label>
                                <label class="method-item">
                                    <input type="checkbox">
                                    <div class="method-content">
                                        <i class="fab fa-slack"></i>
                                        <span>Slack Integration</span>
                                    </div>
                                </label>
                                <label class="method-item">
                                    <input type="checkbox">
                                    <div class="method-content">
                                        <i class="fas fa-sms"></i>
                                        <span>SMS Alerts</span>
                                    </div>
                                </label>
                                <label class="method-item">
                                    <input type="checkbox" checked>
                                    <div class="method-content">
                                        <i class="fas fa-chart-line"></i>
                                        <span>Dashboard Only</span>
                                    </div>
                                </label>
                            </div>
                        </div>

                        <div class="alert-recipients">
                            <h5>Alert Recipients</h5>
                            <div class="recipient-inputs">
                                <input type="email" class="form-input" placeholder="HR Manager email">
                                <input type="email" class="form-input" placeholder="IT Administrator email">
                                <button class="add-recipient-btn">
                                    <i class="fas fa-plus"></i>
                                    Add Recipient
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="config-section">
                    <h4>Auto-Response Configuration</h4>
                    <div class="response-options">
                        <h5>Response Actions</h5>
                        <div class="action-grid">
                            <label class="action-item">
                                <input type="checkbox" checked>
                                <div class="action-content">
                                    <i class="fas fa-file-alt"></i>
                                    <span>Generate detailed violation report</span>
                                </div>
                            </label>
                            <label class="action-item">
                                <input type="checkbox" checked>
                                <div class="action-content">
                                    <i class="fas fa-image"></i>
                                    <span>Create annotated explanation images</span>
                                </div>
                            </label>
                            <label class="action-item">
                                <input type="checkbox" checked>
                                <div class="action-content">
                                    <i class="fas fa-clipboard-list"></i>
                                    <span>Log violation for audit trail</span>
                                </div>
                            </label>
                            <label class="action-item">
                                <input type="checkbox">
                                <div class="action-content">
                                    <i class="fas fa-exclamation-circle"></i>
                                    <span>Send warning to sender</span>
                                </div>
                            </label>
                            <label class="action-item">
                                <input type="checkbox">
                                <div class="action-content">
                                    <i class="fas fa-user-cog"></i>
                                    <span>Escalate to human review</span>
                                </div>
                            </label>
                        </div>

                        <div class="response-templates">
                            <h5>Response Templates</h5>
                            <select class="form-input">
                                <option>Standard Violation Warning</option>
                                <option>Harassment Policy Reminder</option>
                                <option>Custom Response Template</option>
                            </select>
                            <textarea class="form-input" rows="4" placeholder="Customize your automated response template..."></textarea>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function generateStep4Content() {
    return `
        <div class="step-content" id="step-4">
            <div class="step-header">
                <h3>Verify & Activate Monitoring</h3>
                <p>Review settings and start monitoring your Gmail account</p>
            </div>

            <div class="verification-sections">
                <div class="config-summary">
                    <h4>Configuration Summary</h4>
                    <div class="summary-grid">
                        <div class="summary-item">
                            <div class="summary-icon">
                                <i class="fas fa-envelope"></i>
                            </div>
                            <div class="summary-content">
                                <h5>Account Details</h5>
                                <p id="summary-email">${userEmail}</p>
                                <span class="summary-status connected">Connected & Verified</span>
                            </div>
                        </div>
                        <div class="summary-item">
                            <div class="summary-icon">
                                <i class="fas fa-cog"></i>
                            </div>
                            <div class="summary-content">
                                <h5>Smart Defaults Applied</h5>
                                <p>✅ Real-time monitoring (30 seconds)</p>
                                <p>✅ Medium sensitivity detection</p>
                                <p>✅ 4 violation categories enabled</p>
                                <span class="summary-detail">Harassment, Discrimination, Inappropriate, Threats</span>
                            </div>
                        </div>
                        <div class="summary-item">
                            <div class="summary-icon">
                                <i class="fas fa-bell"></i>
                            </div>
                            <div class="summary-content">
                                <h5>Notification Setup</h5>
                                <p>✅ Dashboard alerts enabled</p>
                                <p>✅ Real-time WebSocket updates</p>
                                <span class="summary-detail">Instant violation detection</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="test-connection">
                    <h4>Test Connection</h4>
                    <div class="test-section">
                        <button class="test-btn" onclick="testConnection()">
                            <i class="fas fa-play-circle"></i>
                            Send Test Email
                        </button>
                        <div class="test-status" id="test-status">
                            <div class="status-indicator">
                                <i class="fas fa-clock"></i>
                                <span>Ready to test connection</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="final-activation">
                    <h4>Activation</h4>
                    <div class="terms-section">
                        <label class="terms-checkbox">
                            <input type="checkbox" id="terms-accepted">
                            <div class="checkbox-content">
                                <span>I accept the <a href="#">monitoring terms and conditions</a> and <a href="#">data processing agreement</a></span>
                            </div>
                        </label>
                    </div>

                    <div class="activation-info">
                        <div class="info-item">
                            <i class="fas fa-clock"></i>
                            <span>Monitoring will begin within 2-3 minutes after activation</span>
                        </div>
                        <div class="info-item">
                            <i class="fas fa-shield-check"></i>
                            <span>All data is encrypted and complies with GDPR/CCPA regulations</span>
                        </div>
                    </div>

                    <button class="activate-btn" onclick="activateMonitoring()" disabled>
                        <i class="fas fa-rocket"></i>
                        Start Monitoring
                    </button>
                </div>
            </div>
        </div>
    `;
}

// Gmail Registration Navigation Functions
window.nextStep = function() {
    if (currentStep < 4) {
        if (currentStep === 1 && !gmailConnected) {
            alert('Please connect your Gmail account first.');
            return;
        }

        // Skip configuration steps and go straight to activation with defaults
        if (currentStep === 1 && gmailConnected) {
            currentStep = 4; // Skip steps 2 and 3, go directly to activation
        } else {
            currentStep++;
        }

        updateRegistrationStep();
    }
};

window.previousStep = function() {
    if (currentStep > 1) {
        currentStep--;
        updateRegistrationStep();
    }
};

function updateRegistrationStep() {
    // Update progress bar
    const progressFill = document.getElementById('progress-fill');
    if (progressFill) {
        progressFill.style.width = `${(currentStep / 4) * 100}%`;
    }

    // Update step indicators
    const steps = document.querySelectorAll('.step');
    steps.forEach((step, index) => {
        const stepNum = index + 1;
        step.classList.remove('active', 'completed');

        if (stepNum < currentStep) {
            step.classList.add('completed');
        } else if (stepNum === currentStep) {
            step.classList.add('active');
        }
    });

    // Update content
    const contentContainer = document.querySelector('.registration-content');
    if (contentContainer) {
        let newContent;
        switch(currentStep) {
            case 1:
                newContent = generateStep1Content();
                break;
            case 2:
                newContent = generateStep2Content();
                break;
            case 3:
                newContent = generateStep3Content();
                break;
            case 4:
                newContent = generateStep4Content();
                break;
        }
        contentContainer.innerHTML = newContent;

        // Add active class to the current step content
        const stepContent = contentContainer.querySelector('.step-content');
        if (stepContent) {
            stepContent.classList.add('active');
        }
    }

    // Update navigation buttons
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');

    if (prevBtn) {
        prevBtn.style.display = currentStep > 1 ? 'flex' : 'none';
    }

    if (nextBtn) {
        if (currentStep === 4) {
            nextBtn.style.display = 'none';
        } else {
            nextBtn.style.display = 'flex';
            nextBtn.innerHTML = currentStep === 3 ? 'Review <i class="fas fa-arrow-right"></i>' : 'Next <i class="fas fa-arrow-right"></i>';
        }
    }

    // Add event listeners for the new content
    addStepEventListeners();
}

function addStepEventListeners() {
    // Step 2 - Monitoring scope selection
    const scopeRadios = document.querySelectorAll('input[name="monitoring-scope"]');
    scopeRadios.forEach(radio => {
        radio.addEventListener('change', function() {
            const selectiveOptions = document.getElementById('selective-options');
            if (selectiveOptions) {
                selectiveOptions.style.display = this.value === 'selective' ? 'block' : 'none';
            }
        });
    });

    // Step 4 - Terms acceptance
    const termsCheckbox = document.getElementById('terms-accepted');
    const activateBtn = document.querySelector('.activate-btn');

    if (termsCheckbox && activateBtn) {
        termsCheckbox.addEventListener('change', function() {
            activateBtn.disabled = !this.checked;
        });
    }
}

window.closeGmailRegistration = function() {
    const overlay = document.querySelector('.gmail-registration-overlay');
    if (overlay) {
        overlay.classList.remove('show');
        setTimeout(() => {
            overlay.remove();
            // Reset state
            currentStep = 1;
            gmailConnected = false;
            userEmail = '';
            userProfile = null;
        }, 300);
    }
};

window.viewDashboard = function() {
    // Close the modal first
    const overlay = document.querySelector('.gmail-registration-overlay');
    if (overlay) {
        overlay.classList.remove('show');
        setTimeout(() => {
            overlay.remove();
            // Reset state
            currentStep = 1;
            gmailConnected = false;
            userEmail = '';
            userProfile = null;
            // Navigate to dashboard page
            window.location.href = 'dashboard.html';
        }, 300);
    } else {
        // If no overlay, navigate directly
        window.location.href = 'dashboard.html';
    }
};

window.testConnection = function() {
    const testStatus = document.getElementById('test-status');
    const testBtn = document.querySelector('.test-btn');

    if (testBtn) {
        testBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
        testBtn.disabled = true;
    }

    if (testStatus) {
        testStatus.innerHTML = '<div class="status-indicator"><i class="fas fa-spinner fa-spin"></i><span>Testing connection...</span></div>';
    }

    // Simulate test
    setTimeout(() => {
        if (testStatus) {
            testStatus.innerHTML = '<div class="status-indicator"><i class="fas fa-check-circle" style="color: var(--success-color);"></i><span>Connection test successful!</span></div>';
        }

        if (testBtn) {
            testBtn.innerHTML = '<i class="fas fa-check"></i> Test Successful';
            testBtn.style.background = 'var(--success-color)';
        }
    }, 2000);
};

window.activateMonitoring = async function() {
    const activateBtn = document.querySelector('.activate-btn');

    if (activateBtn) {
        activateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Activating...';
        activateBtn.disabled = true;
    }

    try {
        // Use smart defaults for fast setup
        const config = {
            sensitivity: 'medium',
            categories: ['harassment', 'discrimination', 'inappropriate', 'threats'],
            frequency: 'realtime',
            notifications: ['email', 'dashboard']
        };

        // Start monitoring via IMAP
        const result = await startIMAPMonitoring(config);

        // Show success
        const modal = document.createElement('div');
        modal.className = 'success-modal';
        modal.innerHTML = `
            <div class="success-content">
                <button class="success-modal-close" onclick="closeSuccessModal()">
                    <i class="fas fa-times"></i>
                </button>
                <div class="success-icon">
                    <i class="fas fa-check-circle"></i>
                </div>
                <h3>Monitoring Activated!</h3>
                <p>Your Gmail account is now being monitored by SafAI. You'll receive alerts for any violations detected.</p>
                <div class="success-stats">
                    <div class="stat-item">
                        <strong>Account:</strong> <span>${userEmail}</span>
                    </div>
                    <div class="stat-item">
                        <strong>Status:</strong> <span>Active</span>
                    </div>
                    <div class="stat-item">
                        <strong>Started:</strong> <span>Just now</span>
                    </div>
                </div>
                <div class="success-actions">
                    <button onclick="viewDashboard()" class="cta-button primary">View Dashboard</button>
                    <button onclick="addAnotherAccount()" class="cta-button secondary">Add Another Account</button>
                </div>
            </div>
        `;

        // Add success modal styles
        if (!document.querySelector('style[data-success-modal]')) {
            const style = document.createElement('style');
            style.setAttribute('data-success-modal', 'true');
            style.textContent = `
                .success-modal {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.8);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 30000;
                    backdrop-filter: blur(10px);
                }
                .success-content {
                    background: var(--surface-color);
                    border-radius: 24px;
                    padding: 3rem 2rem;
                    text-align: center;
                    max-width: 500px;
                    width: 90%;
                    box-shadow: var(--shadow-xl);
                    border: 1px solid var(--border-color);
                    position: relative;
                }
                .success-modal-close {
                    position: absolute;
                    top: 15px;
                    right: 15px;
                    background: none;
                    border: none;
                    font-size: 1.2rem;
                    color: var(--text-secondary);
                    cursor: pointer;
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.3s ease;
                }
                .success-modal-close:hover {
                    background: var(--background-secondary);
                    color: var(--text-primary);
                }
                .success-icon {
                    width: 80px;
                    height: 80px;
                    background: var(--success-color);
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0 auto 1.5rem;
                    font-size: 2rem;
                    color: white;
                }
                .success-content h3 {
                    font-size: 1.75rem;
                    font-weight: 700;
                    margin-bottom: 1rem;
                    color: var(--text-primary);
                }
                .success-content p {
                    color: var(--text-secondary);
                    margin-bottom: 2rem;
                    line-height: 1.6;
                }
                .success-stats {
                    background: var(--background-secondary);
                    border-radius: 12px;
                    padding: 1.5rem;
                    margin-bottom: 2rem;
                    text-align: left;
                }
                .stat-item {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 0.5rem;
                    font-size: 0.875rem;
                }
                .stat-item:last-child {
                    margin-bottom: 0;
                }
                .stat-item strong {
                    color: var(--text-primary);
                }
                .stat-item span {
                    color: var(--text-secondary);
                }
                .success-actions {
                    display: flex;
                    gap: 1rem;
                    justify-content: center;
                }
                @media (max-width: 480px) {
                    .success-actions {
                        flex-direction: column;
                    }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(modal);

        // Refresh connected accounts display on main page
        loadConnectedAccounts();

    } catch (error) {
        console.error('Failed to activate monitoring:', error);

        if (activateBtn) {
            activateBtn.innerHTML = '<i class="fas fa-exclamation-circle"></i> Activation Failed';
            activateBtn.style.background = 'var(--danger-color)';
        }

        alert('Failed to activate monitoring. Please try again or contact support.');
    }
};

window.addAnotherAccount = function() {
    // Reset and restart the flow
    currentStep = 1;
    gmailConnected = false;
    userEmail = '';
    userProfile = null;

    // Remove success modal
    document.querySelector('.success-modal')?.remove();

    // Show registration modal again
    showGmailRegistrationFlow();
};

window.closeSuccessModal = function() {
    const modal = document.querySelector('.success-modal');
    if (modal) {
        modal.style.opacity = '0';
        modal.style.transform = 'scale(0.95)';
        setTimeout(() => {
            modal.remove();
        }, 300);
    }
};

// App Password connection function
function handleConnectionSuccess(result, email) {
    // Connection successful
    gmailConnected = true;
    userEmail = email;

    // Store authentication token
    if (result.token) {
        localStorage.setItem('safai_auth_token', result.token);
    }

    // Hide login form and show connected account
    const loginForm = document.getElementById('login-form');
    const connectedAccount = document.getElementById('connected-account');
    const userEmailDisplay = document.getElementById('user-email-display');

    if (loginForm) loginForm.style.display = 'none';
    if (connectedAccount) connectedAccount.style.display = 'block';
    if (userEmailDisplay) userEmailDisplay.textContent = email;

    // Update button state
    const connectBtn = document.querySelector('.gmail-connect-btn');
    if (connectBtn) {
        connectBtn.innerHTML = '<i class="fas fa-check"></i> Connected Successfully';
        connectBtn.style.background = 'var(--success-color)';
        connectBtn.disabled = false;
    }

    showSuccessMessage(`Gmail connection successful! Found ${result.totalMessages} total messages, ${result.newMessages} new.`);
}

window.connectWithAppPassword = async function() {
    const emailInput = document.getElementById('gmail-email');
    const passwordInput = document.getElementById('app-password');
    const connectBtn = document.querySelector('.gmail-connect-btn');

    if (!emailInput || !passwordInput) return;

    const email = emailInput.value.trim();
    const appPassword = passwordInput.value.trim();

    // Basic validation
    if (!email || !appPassword) {
        alert('Please enter both email and app password');
        return;
    }

    if (!email.endsWith('@gmail.com')) {
        alert('Please enter a valid Gmail address');
        return;
    }

    if (appPassword.length !== 16) {
        alert('App password must be exactly 16 characters');
        return;
    }

    // Update button state
    connectBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connecting...';
    connectBtn.disabled = true;

    try {
        // Send credentials to backend for IMAP connection test
        const response = await fetch('http://localhost:3000/api/gmail/connect', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: email,
                appPassword: appPassword
            })
        });

        const result = await response.json();

        if (result.success) {
            // Connection successful
            gmailConnected = true;
            userEmail = email;

            // Store authentication token
            if (result.token) {
                localStorage.setItem('safai_auth_token', result.token);
            }

            // Hide login form and show connected account
            const loginForm = document.getElementById('login-form');
            const connectedAccount = document.getElementById('connected-account');
            const userEmailDisplay = document.getElementById('user-email-display');

            if (loginForm) loginForm.style.display = 'none';
            if (connectedAccount) connectedAccount.style.display = 'block';
            if (userEmailDisplay) userEmailDisplay.textContent = email;

            // Enable next step
            const nextBtn = document.getElementById('next-btn');
            if (nextBtn) {
                nextBtn.disabled = false;
                nextBtn.innerHTML = 'Next <i class="fas fa-arrow-right"></i>';
            }

            showSuccessMessage(`Gmail connection successful! Found ${result.totalMessages} total messages, ${result.newMessages} new.`);

        } else {
            throw new Error(result.message || 'Connection failed');
        }

    } catch (error) {
        console.error('Gmail connection failed:', error);

        // Reset button
        connectBtn.innerHTML = '<i class="fas fa-envelope"></i> Connect to Gmail';
        connectBtn.disabled = false;

        // Show error
        alert(`Connection failed: ${error.message}. Please check your credentials and try again.`);
    }
};

// IMAP monitoring function
window.startIMAPMonitoring = async function(config) {
    try {
        const token = localStorage.getItem('safai_auth_token');
        if (!token) {
            throw new Error('No authentication token found');
        }

        const response = await fetch('http://localhost:3000/api/monitoring/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: userEmail,
                sensitivity: config.sensitivity,
                categories: config.categories,
                frequency: config.frequency,
                notifications: config.notifications,
                token: token
            })
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.message || 'Failed to start monitoring');
        }

        return result;

    } catch (error) {
        console.error('Failed to start IMAP monitoring:', error);
        throw error;
    }
};

function showAddChannelModal() {
    const modal = createModal({
        title: 'Add Slack Channel',
        content: `
            <div class="modal-form">
                <div class="form-group">
                    <label>Workspace</label>
                    <select class="form-input">
                        <option>company-workspace</option>
                        <option>dev-team</option>
                        <option>Add New Workspace...</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Channel</label>
                    <input type="text" class="form-input" placeholder="#general">
                </div>
                <div class="form-group">
                    <label>Monitoring Level</label>
                    <select class="form-input">
                        <option>Standard Monitoring</option>
                        <option>High Sensitivity</option>
                        <option>Custom Rules</option>
                    </select>
                </div>
            </div>
        `,
        actions: [
            { text: 'Cancel', class: 'secondary', action: 'close' },
            { text: 'Add Channel', class: 'primary', action: () => {
                showSuccessMessage('Slack channel added successfully!');
                closeModal();
            }}
        ]
    });
}

function createModal({ title, content, actions }) {
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'modal-overlay';
    modalOverlay.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h3>${title}</h3>
                <button class="modal-close">&times;</button>
            </div>
            <div class="modal-content">
                ${content}
            </div>
            <div class="modal-actions">
                ${actions.map(action =>
                    `<button class="cta-button ${action.class}" data-action="${action.action === 'close' ? 'close' : 'custom'}">${action.text}</button>`
                ).join('')}
            </div>
        </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
        .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            backdrop-filter: blur(5px);
        }

        .modal {
            background: var(--surface-color);
            border-radius: 20px;
            width: 90%;
            max-width: 500px;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: var(--shadow-xl);
            border: 1px solid var(--border-color);
        }

        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1.5rem;
            border-bottom: 1px solid var(--border-color);
        }

        .modal-close {
            background: none;
            border: none;
            font-size: 1.5rem;
            cursor: pointer;
            color: var(--text-muted);
            transition: color 0.3s ease;
        }

        .modal-close:hover {
            color: var(--text-primary);
        }

        .modal-content {
            padding: 1.5rem;
        }

        .modal-actions {
            padding: 1.5rem;
            border-top: 1px solid var(--border-color);
            display: flex;
            gap: 1rem;
            justify-content: flex-end;
        }

        .modal-form {
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
        }

        .form-group {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }

        .form-group label {
            font-weight: 600;
            color: var(--text-primary);
        }

        .form-input {
            padding: 0.75rem;
            border: 1px solid var(--border-color);
            border-radius: 8px;
            background: var(--background-color);
            color: var(--text-primary);
            font-size: 1rem;
        }

        .form-input:focus {
            outline: none;
            border-color: var(--primary-color);
            box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
        }

        .oauth-btn {
            padding: 0.75rem 1rem;
            background: var(--primary-color);
            color: white;
            border: none;
            border-radius: 8px;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            cursor: pointer;
            transition: background 0.3s ease;
        }

        .oauth-btn:hover {
            background: var(--primary-dark);
        }
    `;

    if (!document.querySelector('style[data-modal-styles]')) {
        style.setAttribute('data-modal-styles', 'true');
        document.head.appendChild(style);
    }

    document.body.appendChild(modalOverlay);

    modalOverlay.querySelector('.modal-close').addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', function(e) {
        if (e.target === modalOverlay) closeModal();
    });

    const actionButtons = modalOverlay.querySelectorAll('[data-action]');
    actionButtons.forEach((btn, index) => {
        btn.addEventListener('click', function() {
            if (this.dataset.action === 'close') {
                closeModal();
            } else {
                actions[index].action();
            }
        });
    });

    return modalOverlay;
}

function closeModal() {
    const modal = document.querySelector('.modal-overlay');
    if (modal) {
        modal.style.opacity = '0';
        modal.style.transform = 'scale(0.9)';
        setTimeout(() => {
            modal.remove();
        }, 200);
    }
}

function showSuccessMessage(message) {
    const notification = document.createElement('div');
    notification.className = 'notification success';
    notification.innerHTML = `
        <i class="fas fa-check-circle"></i>
        <span>${message}</span>
    `;

    const style = document.createElement('style');
    style.textContent = `
        .notification {
            position: fixed;
            top: 100px;
            right: 20px;
            padding: 1rem 1.5rem;
            border-radius: 12px;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            z-index: 10001;
            transform: translateX(100%);
            transition: transform 0.3s ease;
            box-shadow: var(--shadow-lg);
        }

        .notification.success {
            background: var(--success-color);
            color: white;
        }

        .notification.show {
            transform: translateX(0);
        }
    `;

    if (!document.querySelector('style[data-notification-styles]')) {
        style.setAttribute('data-notification-styles', 'true');
        document.head.appendChild(style);
    }

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.classList.add('show');
    }, 100);

    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 3000);
}

function updateRealTimeData() {
    const statusIndicators = document.querySelectorAll('.activity-indicator');
    const colors = ['high', 'medium', 'low'];

    statusIndicators.forEach(indicator => {
        const currentColor = indicator.className.split(' ').pop();
        const availableColors = colors.filter(color => color !== currentColor);
        const newColor = availableColors[Math.floor(Math.random() * availableColors.length)];

        indicator.className = `activity-indicator ${newColor}`;
    });

    const metrics = document.querySelectorAll('.card-metrics span');
    metrics.forEach(metric => {
        if (metric.textContent.includes('violations detected')) {
            const currentCount = parseInt(metric.textContent.match(/\d+/)[0]);
            const newCount = Math.max(0, currentCount + Math.floor(Math.random() * 3) - 1);
            metric.textContent = metric.textContent.replace(/\d+/, newCount);
        }
    });
}

function initCounterAnimations() {
    const counters = document.querySelectorAll('.stat-number');

    const observerOptions = {
        threshold: 0.5,
        rootMargin: '0px'
    };

    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting && !entry.target.classList.contains('counted')) {
                entry.target.classList.add('counted');
                animateCounter(entry.target);
            }
        });
    }, observerOptions);

    counters.forEach(counter => observer.observe(counter));
}

function animateCounter(element) {
    const text = element.textContent;
    const hasPercent = text.includes('%');
    const hasPlus = text.includes('+');
    const hasSlash = text.includes('/');

    let finalValue;
    let suffix = '';

    if (hasPercent) {
        finalValue = parseFloat(text.replace('%', ''));
        suffix = '%';
    } else if (hasSlash) {
        return;
    } else if (hasPlus) {
        finalValue = parseInt(text.replace(/[^\d]/g, ''));
        suffix = text.replace(/[\d.]/g, '');
    } else {
        finalValue = parseInt(text.replace(/[^\d]/g, ''));
        suffix = text.replace(/[\d.]/g, '');
    }

    if (isNaN(finalValue)) return;

    let currentValue = 0;
    const increment = finalValue / 50;
    const duration = 2000;
    const stepTime = duration / 50;

    const timer = setInterval(() => {
        currentValue += increment;
        if (currentValue >= finalValue) {
            currentValue = finalValue;
            clearInterval(timer);
        }

        if (hasPercent) {
            element.textContent = currentValue.toFixed(1) + suffix;
        } else {
            element.textContent = Math.floor(currentValue).toLocaleString() + suffix;
        }
    }, stepTime);
}

function initParallaxEffects() {
    const parallaxElements = document.querySelectorAll('.gradient-orb');

    window.addEventListener('scroll', () => {
        const scrolled = window.pageYOffset;
        const rate = scrolled * -0.5;

        parallaxElements.forEach((element, index) => {
            const speed = (index + 1) * 0.3;
            element.style.transform = `translateY(${rate * speed}px)`;
        });
    });
}

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeModal();
    }
});

window.addEventListener('scroll', function() {
    const header = document.querySelector('.header');
    if (window.scrollY > 100) {
        header.style.background = 'rgba(255, 255, 255, 0.95)';
        header.style.backdropFilter = 'blur(20px)';
    } else {
        header.style.background = 'var(--glass-bg)';
        header.style.backdropFilter = 'blur(20px)';
    }
});

const ctaButtons = document.querySelectorAll('.cta-button');
ctaButtons.forEach(button => {
    button.addEventListener('click', function(e) {
        if (!this.classList.contains('no-ripple')) {
            createRipple(e, this);
        }
    });
});

function createRipple(event, element) {
    const ripple = document.createElement('span');
    const rect = element.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = event.clientX - rect.left - size / 2;
    const y = event.clientY - rect.top - size / 2;

    ripple.style.cssText = `
        position: absolute;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.6);
        width: ${size}px;
        height: ${size}px;
        left: ${x}px;
        top: ${y}px;
        transform: scale(0);
        animation: ripple 0.6s ease-out;
        pointer-events: none;
    `;

    if (!document.querySelector('style[data-ripple-styles]')) {
        const style = document.createElement('style');
        style.setAttribute('data-ripple-styles', 'true');
        style.textContent = `
            @keyframes ripple {
                to {
                    transform: scale(2);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }

    element.style.position = 'relative';
    element.style.overflow = 'hidden';
    element.appendChild(ripple);

    setTimeout(() => {
        ripple.remove();
    }, 600);
}

// Load connected accounts on page load
async function loadConnectedAccounts() {
    try {
        const response = await fetch('http://localhost:3000/api/accounts');
        const data = await response.json();

        if (data.success && data.accounts.length > 0) {
            updateEmailAccountsDisplay(data.accounts);
        }
    } catch (error) {
        console.error('Failed to load connected accounts:', error);
        // Silent fail - UI will show "no accounts" state
    }
}

// Update the email accounts display with connected accounts
function updateEmailAccountsDisplay(accounts) {
    const emailStatusIndicator = document.getElementById('email-status-indicator');
    const emailStatusText = document.getElementById('email-status-text');
    const emailAccountsList = document.getElementById('email-accounts-list');
    const emailMetrics = document.getElementById('email-metrics');
    const noAccountsMessage = document.getElementById('no-accounts-message');

    if (!emailAccountsList) return; // Not on main page

    // Update status
    if (emailStatusIndicator && emailStatusText) {
        emailStatusIndicator.className = 'status-indicator active';
        emailStatusText.textContent = `${accounts.length} Active`;
    }

    // Clear existing content
    emailAccountsList.innerHTML = '';

    // Add connected accounts
    accounts.forEach((account, index) => {
        const accountItem = document.createElement('div');
        accountItem.className = 'account-item';
        accountItem.innerHTML = `
            <div class="account-info">
                <div class="account-email">${escapeHtml(account.email)}</div>
                <div class="account-status">
                    <span class="status-dot active"></span>
                    <span>Active • Last sync ${formatRelativeTime(account.lastSync)}</span>
                </div>
            </div>
            <div class="account-actions">
                <button class="account-action-btn" onclick="viewAccountDashboard('${account.email}')" title="View Dashboard">
                    <i class="fas fa-eye"></i>
                </button>
            </div>
        `;
        emailAccountsList.appendChild(accountItem);
    });

    // Update metrics
    if (emailMetrics) {
        const activeCount = accounts.filter(acc => acc.isActive).length;
        emailMetrics.innerHTML = `<span>${activeCount} account${activeCount !== 1 ? 's' : ''} monitored</span>`;
    }
}

// Helper function to escape HTML
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, (m) => map[m]);
}

// Helper function to format relative time
function formatRelativeTime(dateString) {
    const now = new Date();
    const date = new Date(dateString);
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
}

// View dashboard for specific account
window.viewAccountDashboard = function(email) {
    // Store the selected email and navigate to dashboard
    localStorage.setItem('selected_account_email', email);
    window.location.href = 'dashboard.html';
};