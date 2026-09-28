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

// Clean Telegram HTML Special Characters safely
const cleanText = (text = '') => {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
};

// Serve the frontend page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Endpoint to receive payment notification and uploaded receipt file from frontend
app.post('/api/checkout', upload.single('paymentProof'), async (req, res) => {
    try {
        const { name, telegram, whatsapp, snapchat, reference, amount } = req.body;

        // 1. Clean Telegram handle
        let cleanTelegram = telegram ? String(telegram).trim().replace(/^@/, '') : '';

        // 2. Format WhatsApp handle (Automatically converts Nigerian local numbers to 234)
        let cleanWhatsApp = whatsapp ? String(whatsapp).trim().replace(/[^0-9]/g, '') : '';
        if (cleanWhatsApp.startsWith('0') && cleanWhatsApp.length === 11) {
            cleanWhatsApp = '234' + cleanWhatsApp.substring(1);
        }

        // 3. Clean Snapchat handle
        let cleanSnapchat = snapchat ? String(snapchat).trim().replace(/^@/, '') : '';

        // Validate URLs for buttons
        const userTgLink = cleanTelegram.length > 0 ? `https://t.me/${cleanTelegram}` : null;
        const userWaLink = cleanWhatsApp.length > 6 ? `https://wa.me/${cleanWhatsApp}` : null;
        const userSnapLink = cleanSnapchat.length > 0 ? `https://snapchat.com/add/${cleanSnapchat}` : null;

        const safeName = cleanText(name || 'N/A');
        const safeRef = cleanText(reference || 'N/A');
        const safeAmount = cleanText(amount || '0');

        // Formatted Telegram HTML Message
        const captionText = 
            `🚨 <b>NEW PAYMENT CLAIM</b> 🚨\n\n` +
            `👤 <b>Name:</b> ${safeName}\n` +
            `📱 <b>Telegram:</b> ${cleanTelegram ? '@' + cleanText(cleanTelegram) : 'N/A'}\n` +
            `🟢 <b>WhatsApp:</b> ${cleanWhatsApp ? '+' + cleanText(cleanWhatsApp) : 'N/A'}\n` +
            `👻 <b>Snapchat:</b> ${cleanSnapchat ? cleanText(cleanSnapchat) : 'N/A'}\n` +
            `💰 <b>Amount / Plan:</b> ₦${safeAmount}\n` +
            `🧾 <b>Ref:</b> <code>${safeRef}</code>\n\n` +
            `🏦 <b>Account Details:</b> ${BANK_DETAILS.bankName} | ${BANK_DETAILS.accountNumber} (${BANK_DETAILS.accountName})`;

        // Dynamically build inline action buttons
        const inlineButtons = [];
        if (userTgLink) inlineButtons.push({ text: "💬 Telegram", url: userTgLink });
        if (userWaLink) inlineButtons.push({ text: "🟢 WhatsApp", url: userWaLink });
        if (userSnapLink) inlineButtons.push({ text: "👻 Snapchat", url: userSnapLink });

        const primaryContact = (cleanTelegram || cleanWhatsApp || cleanSnapchat || 'Customer').substring(0, 20);

        const keyboardRows = [];
        if (inlineButtons.length > 0) {
            keyboardRows.push(inlineButtons);
        }
        keyboardRows.push([
            { text: "✅ Confirm Payment Received", callback_data: `release_${primaryContact}` }
        ]);

        const keyboard = { inline_keyboard: keyboardRows };

        // Send to Telegram (With or Without Image File)
        if (req.file) {
            const formData = new FormData();
            formData.append('chat_id', ADMIN_CHAT_ID);
            formData.append('caption', captionText);
            formData.append('parse_mode', 'HTML');
            formData.append('reply_markup', JSON.stringify(keyboard));
            formData.append('photo', fs.createReadStream(req.file.path));

            await axios.post(`${TELEGRAM_API}/sendPhoto`, formData, {
                headers: formData.getHeaders(),
                maxBodyLength: Infinity,
                maxContentLength: Infinity
            });

            // Clean up temporary local file after upload
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('Failed to delete temporary file:', err);
            });
        } else {
            await axios.post(`${TELEGRAM_API}/sendMessage`, {
                chat_id: ADMIN_CHAT_ID,
                text: captionText,
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        }

        return res.status(200).json({ success: true, message: 'Notification sent to admin' });
    } catch (error) {
        console.error('Telegram API Error Details:', error.response ? error.response.data : error.message);

        // Delete uploaded receipt file on server error
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        return res.status(500).json({ success: false, message: 'Failed to notify admin' });
    }
});

// Telegram Webhook Handler (Handles Inline Buttons & Timed Free Tips Messages)
app.post('/telegram-webhook', async (req, res) => {
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
                    text: "Payment Confirmed! Tap one of the contact buttons above to deliver the VIP code.",
                    show_alert: true
                });

                await axios.post(`${TELEGRAM_API}/sendMessage`, {
                    chat_id: ADMIN_CHAT_ID,
                    text: `✅ <b>Payment Verified for ${cleanText(userContact)}</b>\n\nTap on the Telegram, WhatsApp, or Snapchat button above to send their ticket directly.`,
                    parse_mode: 'HTML'
                });
            }
        }

        // 2. Handle User Messages (Free Tips Requests with 3:00 PM WAT Cutoff)
        if (message && message.text) {
            const chatId = message.chat.id;
            const userText = message.text.trim();

            if (userText.includes('get_free_ticket') || userText === '/free' || userText === '/start' || userText === '/tips') {

                const currentWatHour = parseInt(
                    new Intl.DateTimeFormat('en-US', {
                        timeZone: 'Africa/Lagos',
                        hour: 'numeric',
                        hour12: false
                    }).format(new Date()),
                    10
                );

                if (currentWatHour >= 15) {
                    const lockedMessage = 
                        "🔒 <b>TODAY'S FREE TIPS ARE LOCKED</b>\n\n" +
                        "Free tips locked at 3:00 PM because early matches have kicked off.\n\n" +
                        "⚡ <b>Want immediate access to late matches & VIP accumulators?</b>\n" +
                        "Join our VIP or Rollover plan on our website to receive live updates and ticket codes!";

                    await axios.post(`${TELEGRAM_API}/sendMessage`, {
                        chat_id: chatId,
                        text: lockedMessage,
                        parse_mode: 'HTML'
                    });
                } else {
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
