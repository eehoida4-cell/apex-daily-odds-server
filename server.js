const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const FormData = require('form-data');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Ensure 'uploads' directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure Multer Storage for Uploaded Receipts
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname) || '.png';
        cb(null, `receipt-${uniqueSuffix}${ext}`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

const BOT_TOKEN = '8557858552:AAFkjy5dRa-EePWF4bHrxL2y1_B6gdcq12Y';
const ADMIN_CHAT_ID = '8863246341';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Account Details
const BANK_DETAILS = {
    bankName: "PalmPay",
    accountNumber: "9066989021",
    accountName: "Blessings Eboh"
};

// Helper function to escape Markdown special characters for Telegram
const escapeMarkdown = (text = '') => {
    return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
};

// Serve the frontend page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Endpoint to receive payment notification and uploaded receipt file from frontend
app.post('/api/checkout', upload.single('paymentProof'), async (req, res) => {
    const { name, telegram, reference, amount } = req.body;

    let cleanTelegram = telegram ? String(telegram).trim().replace(/^@/, '') : '';
    const userLink = cleanTelegram ? `https://t.me/${cleanTelegram}` : null;

    const safeName = escapeMarkdown(name || 'N/A');
    const safeContact = cleanTelegram ? `@${cleanTelegram}` : 'N/A';
    const safeRef = String(reference || 'N/A').replace(/`/g, '');
    const safeAmount = escapeMarkdown(amount || '0');

    const text = `🚨 *NEW PAYMENT CLAIM* 🚨\n\n` +
                 `👤 *Name:* ${safeName}\n` +
                 `📱 *Contact:* ${safeContact}\n` +
                 `💰 *Amount / Plan:* ₦${safeAmount}\n` +
                 `🧾 *Ref:* \`${safeRef}\` \n\n` +
                 `🏦 *Account Details:* ${BANK_DETAILS.bankName} | ${BANK_DETAILS.accountNumber} (${BANK_DETAILS.accountName})`;

    // Build inline keyboard with direct chat link button + confirm button
    const inlineButtons = [];
    
    if (userLink) {
        inlineButtons.push({ text: "💬 Message Customer on Telegram", url: userLink });
    }
    
    const keyboard = {
        inline_keyboard: [
            inlineButtons,
            [
                { text: "✅ Confirm Payment Received", callback_data: `release_${cleanTelegram}` }
            ]
        ]
    };

    try {
        // Check if user uploaded a screenshot receipt file
        if (req.file) {
            const formData = new FormData();
            formData.append('chat_id', ADMIN_CHAT_ID);
            formData.append('caption', text);
            formData.append('parse_mode', 'Markdown');
            formData.append('reply_markup', JSON.stringify(keyboard));
            formData.append('photo', fs.createReadStream(req.file.path));

            await axios.post(`${TELEGRAM_API}/sendPhoto`, formData, {
                headers: formData.getHeaders()
            });
        } else {
            // Send regular text message if no file was uploaded
            await axios.post(`${TELEGRAM_API}/sendMessage`, {
                chat_id: ADMIN_CHAT_ID,
                text: text,
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        }

        res.status(200).json({ success: true, message: 'Notification sent to admin' });
    } catch (error) {
        console.error('Telegram API error:', error.response ? error.response.data : error.message);
        res.status(500).json({ success: false, message: 'Failed to notify admin' });
    }
});

// Telegram Webhook Handler (Handles Inline Buttons & Timed Free Tips Messages)
app.post('/telegram-webhook', async (req, res) => {
    // Immediately send 200 OK to Telegram so it doesn't retry requests
    res.sendStatus(200);

    const { callback_query, message } = req.body;

    try {
        // 1. Handle Admin Inline Buttons
        if (callback_query) {
            const callbackId = callback_query.id;
            const data = callback_query.data;

            if (data && data.startsWith('release_')) {
                const userContact = data.replace('release_', '');

                await axios.post(`${TELEGRAM_API}/answerCallbackQuery`, {
                    callback_query_id: callbackId,
                    text: "Payment Confirmed! Message the user directly with their VIP/Rollover code.",
                    show_alert: true
                });

                await axios.post(`${TELEGRAM_API}/sendMessage`, {
                    chat_id: ADMIN_CHAT_ID,
                    text: `✅ *Payment Verified for @${userContact}*\n\nTap "Message Customer on Telegram" above or message @${userContact} directly to deliver their VIP or Rollover code.`,
                    parse_mode: 'Markdown'
                });
            }
        }

        // 2. Handle User Messages (Free Tips Requests with 3:00 PM WAT Cutoff)
        if (message && message.text) {
            const chatId = message.chat.id;
            const userText = message.text.trim();

            if (userText.includes('get_free_ticket') || userText === '/free' || userText === '/start' || userText === '/tips') {
                
                // Get current West Africa Time (WAT - UTC+1) hour using Intl API
                const currentWatHour = parseInt(
                    new Intl.DateTimeFormat('en-US', {
                        timeZone: 'Africa/Lagos',
                        hour: 'numeric',
                        hour12: false
                    }).format(new Date()),
                    10
                );

                // If it is 3:00 PM WAT (15:00) or later, lock free tips
                if (currentWatHour >= 15) {
                    const lockedMessage = 
                        "🔒 *TODAY'S FREE TIPS ARE LOCKED*\n\n" +
                        "Free tips locked at 3:00 PM because early matches have kicked off.\n\n" +
                        "⚡ *Want immediate access to late matches & VIP accumulators?*\n" +
                        "Join our VIP or Rollover plan on our website to receive live updates and ticket codes!";

                    await axios.post(`${TELEGRAM_API}/sendMessage`, {
                        chat_id: chatId,
                        text: lockedMessage,
                        parse_mode: 'Markdown'
                    });
                } else {
                    // Before 3:00 PM WAT — Deliver full free tips schedule
                    const freeTipsMessage = 
                        "🏆 APEX PREDICTIONS FREE TIPS (MIDWEEK) 🏆\n\n" +
                        "📅 TUESDAY 15.09.2026\n" +
                        "• Liverpool (vs Bournemouth) — Over 0.5 [2UP]\n" +
                        "• Real Madrid (vs Inter Milan) — Over 1.5 [2UP]\n" +
                        "• Barcelona (vs Feyenoord) — Over 1.5 [2UP]\n" +
                        "• Manchester City (vs FC Porto) — Over 1.5 [2UP]\n" +
                        "• Ludogorets (vs Septemvri) — Over 1.5 [2UP]\n" +
                        "• Gaziantep (vs Fenerbahce) — Over 0.5 [Away/Draw]\n" +
                        "• Super Nova (vs Riga FC) — Over 0.5 [Away (2UP)]\n" +
                        "• Al Ahly SC (vs Abo Qair Semads) — Over 0.5 [Home (2UP)]\n" +
                        "• Ajax (vs Willem II) — Over 1.5 [Home (2UP)]\n" +
                        "• Villarreal (vs Dortmund) — Over 0.5 [Away/Draw]\n\n" +
                        "📅 WEDNESDAY 16.09.2026\n" +
                        "• AC Milan (vs Benfica) — Over 0.5 [Away/Draw]\n" +
                        "• Bayer Leverkusen (vs NK Celje) — Over 1.5 [Home (2UP)]\n" +
                        "• Olympiacos (vs Jagiellonia) — Over 0.5 [Home/Draw]\n" +
                        "• Lyon (vs RSC Anderlecht) — Over 0.5 [Home (2UP)]\n" +
                        "• AZ Alkmaar (vs Sunderland) — Over 0.5 [Home (2UP)]\n" +
                        "• Benfica (vs AC Milan) — Over 0.5 [Away/Draw]\n" +
                        "• Torino vs Roma — Home/Draw\n" +
                        "• Braga vs Estoril — Home/Draw\n" +
                        "• Como vs Parma — Home (2UP)\n" +
                        "• FK Auda vs Ogre Utd — Home/Draw\n\n" +
                        "📅 THURSDAY 17.09.2026\n" +
                        "• Manchester United (vs Sabah FK) — Over 0.5 [Away/Draw]\n" +
                        "• Juventus (vs NEC Nijmegen) — Over 1.5 [Home (2UP)]\n" +
                        "• Celtic (vs Ferencváros) — Over 0.5 [Away/Draw]\n" +
                        "• Crystal Palace (vs Lech Poznań) — Over 0.5 [Away/Draw]\n" +
                        "• Aston Villa (vs Club Brugge) — Over 0.5 [Home (2UP)]\n" +
                        "• Beşiktaş (vs Marseille) — Over 0.5 [Away/Draw]\n" +
                        "• Real Sociedad (vs Bournemouth) — Over 0.5 [Away/Draw]\n" +
                        "• Marseille (vs Beşiktaş) — Over 0.5 [Home (2UP)]\n" +
                        "• AEK Athens vs Panserraikos — Home (2UP)\n\n" +
                        "──────────────────────────────\n" +
                        "👑 VIP & ROLLOVER ACCUMULATORS ARE ACTIVE!\n" +
                        "👉 Unlock VIP access on our website.";

                    await axios.post(`${TELEGRAM_API}/sendMessage`, {
                        chat_id: chatId,
                        text: freeTipsMessage
                    });
                }
            }
        }
    } catch (err) {
        console.error("Webhook processing error:", err.response ? err.response.data : err.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
