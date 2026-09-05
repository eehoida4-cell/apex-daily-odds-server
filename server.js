const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const BOT_TOKEN = '8557858552:AAFkjy5dRa-EePWF4bHrxL2y1_B6gdcq12Y';
const ADMIN_CHAT_ID = '8863246341';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Serve the frontend page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Endpoint to receive payment notification from frontend
app.post('/api/checkout', async (req, res) => {
    const { name, telegram, reference, amount } = req.body;

    const text = `🚨 *NEW PAYMENT CLAIM* 🚨\n\n` +
                 `👤 *Name:* ${name}\n` +
                 `📱 *Contact:* ${telegram}\n` +
                 `💰 *Amount:* ₦${amount}\n` +
                 `🧾 *Ref:* \`${reference}\``;

    const keyboard = {
        inline_keyboard: [
            [
                { text: "✅ Release Booking Code", callback_data: `release_${telegram}` }
            ]
        ]
    };

    try {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: ADMIN_CHAT_ID,
            text: text,
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
        res.status(200).json({ success: true, message: 'Notification sent to admin' });
    } catch (error) {
        console.error('Telegram API error:', error.response ? error.response.data : error.message);
        res.status(500).json({ success: false, message: 'Failed to notify admin' });
    }
});

// Telegram Webhook Handler for Inline Buttons
app.post('/telegram-webhook', async (req, res) => {
    const { callback_query } = req.body;

    if (callback_query) {
        const callbackId = callback_query.id;
        const data = callback_query.data;

        if (data.startsWith('release_')) {
            const userContact = data.replace('release_', '');

            await axios.post(`${TELEGRAM_API}/answerCallbackQuery`, {
                callback_query_id: callbackId,
                text: "Code dispatch confirmation recorded!",
                show_alert: true
            });

            await axios.post(`${TELEGRAM_API}/sendMessage`, {
                chat_id: ADMIN_CHAT_ID,
                text: `✅ Action complete for ${userContact}. Send the ticket booking code directly to them now.`
            });
        }
    }

    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});