require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');

const app = express();

// Security and Middleware Setup
app.use(helmet({
    contentSecurityPolicy: false // Allows inline scripts for simple web setups
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8557858552:AAFkjy5dRa-EePWF4bHrxL2y1_B6gdcq12Y';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '8863246341';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Serve the frontend page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Endpoint to receive payment notification from frontend
app.post('/api/checkout', async (req, res) => {
    try {
        const { name, telegram, reference, amount } = req.body;

        const text = `🚨 *NEW PAYMENT CLAIM* 🚨\n\n` +
                     `👤 *Name:* ${name || 'N/A'}\n` +
                     `📱 *Contact:* ${telegram || 'N/A'}\n` +
                     `💰 *Amount:* ₦${amount || '0'}\n` +
                     `🧾 *Ref:* \`${reference || 'N/A'}\``;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: "✅ Release Access Code", callback_data: `release_${telegram}` }
                ]
            ]
        };

        const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: ADMIN_CHAT_ID,
                text: text,
                parse_mode: 'Markdown',
                reply_markup: keyboard
            })
        });

        const data = await response.json();

        if (data.ok) {
            return res.status(200).json({ success: true, message: 'Notification sent to admin' });
        } else {
            console.error('Telegram API error:', data);
            return res.status(500).json({ success: false, message: 'Failed to notify admin' });
        }
    } catch (error) {
        console.error('Checkout error:', error);
        return res.status(500).json({ success: false, message: 'Server processing error' });
    }
});

// Telegram Webhook Handler for Inline Buttons & Free Tips Trigger
app.post('/telegram-webhook', async (req, res) => {
    res.sendStatus(200);

    const update = req.body;
    if (!update) return;

    try {
        // Handle Inline Keyboards (Admin Callbacks)
        if (update.callback_query) {
            const callbackId = update.callback_query.id;
            const callbackData = update.callback_query.data || '';

            if (callbackData.startsWith('release_')) {
                const userContact = callbackData.replace('release_', '');

                await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        callback_query_id: callbackId,
                        text: "Code dispatch confirmation recorded!",
                        show_alert: true
                    })
                });

                await fetch(`${TELEGRAM_API}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: ADMIN_CHAT_ID,
                        text: `✅ Action complete for ${userContact}. Send the ticket access code directly to them now.`
                    })
                });
            }
            return;
        }

        // Handle User Messages (e.g., Free Tips Trigger)
        if (update.message && update.message.text) {
            const chatId = update.message.chat.id;
            const messageText = update.message.text.trim();

            if (messageText.startsWith('/start get_free_ticket')) {
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
                    "👉 Unlock VIP access: https://apex-daily-odds-server.onrender.com";

                await fetch(`${TELEGRAM_API}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: freeTipsMessage
                    })
                });
            }
        }
    } catch (err) {
        console.error("Webhook Error:", err);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
