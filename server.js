const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();

// Enable CORS and JSON body parsing
app.use(cors());
app.use(express.json());

// CONFIGURATION (Set these in Render Environment Variables for security)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN_HERE';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || 'YOUR_TELEGRAM_ADMIN_CHAT_ID_HERE';

// Port bind for Render
const PORT = process.env.PORT || 3000;

// Temporary in-memory order store
const pendingOrders = {};

// Health Check Route (Required for Render to mark build as Live)
app.get('/', (req, res) => {
    res.status(200).send('Apex Daily Odds Server is Live and Running!');
});

// 1. FRONTEND SUBMISSION ENDPOINT
app.post('/api/checkout', async (req, res) => {
    try {
        const { name, telegram, reference, amount } = req.body;

        if (!name || !telegram || !reference || !amount) {
            return res.status(400).json({ success: false, message: 'All fields are required.' });
        }

        const orderId = 'ORD_' + Date.now();

        pendingOrders[orderId] = { orderId, name, telegram, reference, amount, status: 'PENDING' };

        const adminMessage = 
            `🚨 *NEW PAYMENT VERIFICATION* 🚨\n\n` +
            `👤 *Name:* ${name}\n` +
            `📱 *Telegram:* ${telegram}\n` +
            `💰 *Plan:* ${amount}\n` +
            `🧾 *Ref/TxID:* \`${reference}\`\n` +
            `🆔 *Order ID:* \`${orderId}\``;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '✅ Approve', callback_data: `approve_${orderId}` },
                    { text: '❌ Reject', callback_data: `reject_${orderId}` }
                ]
            ]
        };

        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: ADMIN_CHAT_ID,
            text: adminMessage,
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });

        return res.status(200).json({ success: true, message: 'Verification sent successfully!' });
    } catch (error) {
        console.error('Error in /api/checkout:', error.response?.data || error.message);
        return res.status(500).json({ success: false, message: 'Failed to notify admin via Telegram.' });
    }
});

// 2. TELEGRAM BOT WEBHOOK (Handles Admin Buttons)
app.post('/telegram-webhook', async (req, res) => {
    try {
        const update = req.body;

        if (update && update.callback_query) {
            const query = update.callback_query;
            const data = query.data;
            const chatId = query.message.chat.id;
            const messageId = query.message.message_id;

            const [action, orderId] = data.split('_');
            const order = pendingOrders[orderId];

            if (action === 'approve') {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
                    chat_id: chatId,
                    message_id: messageId,
                    text: query.message.text + `\n\n✅ *STATUS: APPROVED*`,
                    parse_mode: 'Markdown'
                });
            } else if (action === 'reject') {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
                    chat_id: chatId,
                    message_id: messageId,
                    text: query.message.text + `\n\n❌ *STATUS: REJECTED*`,
                    parse_mode: 'Markdown'
                });
            }

            await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                callback_query_id: query.id,
                text: `Order ${action}d.`
            });
        }
    } catch (err) {
        console.error('Webhook error:', err.message);
    }
    
    res.sendStatus(200);
});

// Bind to 0.0.0.0 for Render compatibility
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
});
