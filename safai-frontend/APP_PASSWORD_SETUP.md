# SafAI - Gmail App Password Setup

## 🔐 **App Password Authentication Method**

I've implemented Gmail monitoring using App Passwords and IMAP instead of OAuth. This approach is simpler to set up but has some limitations.

## 📋 **How to Get Your Gmail App Password**

### **Step 1: Enable 2-Step Verification**

1. Go to [Google Account Security](https://myaccount.google.com/security)
2. Under "Signing in to Google", click **2-Step Verification**
3. Follow the setup process if not already enabled
4. You'll need your phone for verification

### **Step 2: Generate App Password**

1. Go back to [Google Account Security](https://myaccount.google.com/security)
2. Under "Signing in to Google", click **App passwords**
3. Click **Select app** dropdown and choose **Mail**
4. Click **Select device** and choose **Other (Custom name)**
5. Type: `SafAI Gmail Monitor`
6. Click **GENERATE**
7. **Copy the 16-character password** (e.g., `abcd efgh ijkl mnop`)
8. Click **DONE**

## 🚀 **How to Use the System**

### **Setup Instructions:**

1. **Start MongoDB:**
   ```bash
   # macOS with Homebrew
   brew services start mongodb-community

   # Or with Docker
   docker run --name safai-mongo -d -p 27017:27017 mongo:latest
   ```

2. **Start Backend Server:**
   ```bash
   cd backend
   npm install
   node imap-server.js
   # Server starts on http://localhost:3000
   ```

3. **Serve Frontend:**
   ```bash
   # Option 1: Python
   python -m http.server 8080

   # Option 2: Node.js http-server
   npx http-server -p 8080
   ```

4. **Open Application:**
   - Navigate to: http://localhost:8080
   - Click "Add Email Account"

### **Using the App Password Form:**

1. **Enter Gmail Address:** your.email@gmail.com
2. **Enter App Password:** The 16-character password from Google (without spaces)
3. **Click "Connect to Gmail"**
4. **System will:**
   - Test IMAP connection to Gmail
   - Save encrypted credentials
   - Show connection success with message counts

## 🔍 **What the System Does**

### **Real Gmail Monitoring:**
- ✅ **Connects to real Gmail via IMAP**
- ✅ **Monitors unread emails every 30 seconds**
- ✅ **Analyzes content for violations using AI**
- ✅ **Stores violations in MongoDB**
- ✅ **Sends real-time WebSocket notifications**

### **AI Analysis Features:**
- **Harassment Detection:** Bullying, intimidation, threats
- **Discrimination Detection:** Racist, sexist, prejudiced language
- **Inappropriate Content:** Profanity, vulgar language
- **Threat Detection:** Violence, harm, dangerous language

### **Enterprise Features:**
- **Encrypted Storage:** App passwords encrypted with AES-256
- **JWT Authentication:** Secure session management
- **Rate Limiting:** Protection against abuse
- **WebSocket Alerts:** Real-time violation notifications
- **Audit Trails:** Complete logging of all violations

## 📊 **Testing the System**

### **1. Setup Test Scenario:**
- Use your Gmail account for monitoring
- Send yourself test emails with trigger words
- Monitor the system for violation detection

### **2. Trigger Words to Test:**
```
Subject: Test harassment detection
Body: "You are stupid and should quit your job"

Subject: Test threat detection
Body: "I will harm you if you don't listen"

Subject: Test discrimination
Body: "You people don't belong here"
```

### **3. Expected Behavior:**
- Backend logs will show violation detection
- WebSocket notifications sent to frontend
- Violations stored in MongoDB
- Real-time alerts in the UI

## 🛠 **Backend API Endpoints**

### **POST /api/gmail/connect**
Test Gmail IMAP connection with credentials

### **POST /api/monitoring/start**
Start real-time email monitoring

### **GET /api/violations**
Retrieve detected violations

### **GET /api/health**
System health and monitoring status

## 🔐 **Security Features**

### **What's Secure:**
- ✅ **App passwords encrypted with AES-256**
- ✅ **JWT token authentication**
- ✅ **Rate limiting and CORS protection**
- ✅ **Secure IMAP connections (TLS)**
- ✅ **Minimal data storage (violation metadata only)**

### **Limitations:**
- ⚠️ **IMAP polling (not real-time webhooks)**
- ⚠️ **App passwords being phased out by Google**
- ⚠️ **No Gmail API advanced features**
- ⚠️ **30-second minimum check interval**

## 🚨 **Troubleshooting**

### **"Invalid credentials" error:**
- Double-check your Gmail address
- Verify the 16-character app password (no spaces)
- Ensure 2-Step Verification is enabled
- Try generating a new app password

### **"Connection timeout" error:**
- Check your internet connection
- Verify firewall isn't blocking port 993
- Try again in a few minutes

### **"App passwords not available" error:**
- Enable 2-Step Verification first
- App passwords only work with personal Google accounts
- Corporate accounts may have app passwords disabled

## 💡 **Quick Test**

1. **Start the system** (backend + frontend)
2. **Connect your Gmail** with app password
3. **Go through the 4-step setup**
4. **Send yourself a test email** with: "You are stupid"
5. **Check the browser console** for violation detection logs
6. **Monitor the backend logs** for processing messages

---

**✅ You now have a working Gmail monitoring system with App Password authentication!**

The system will continuously monitor your Gmail inbox and detect violations using AI analysis, providing real-time alerts and storing compliance data securely.