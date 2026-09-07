const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serves your index.html if placed in public folder

// ================= CONFIGURATION =================
const TELEGRAM_BOT_TOKEN = 'YOUR_TELEGRAM_BOT_TOKEN_HERE'; // Replace with your Bot Father token
const ADMIN_CHAT_ID = 'YOUR_TELEGRAM_ADMIN_CHAT_ID_HERE';    // Replace with your personal Telegram ID
const PORT = process.env.PORT || 3000;

// Temporary in-memory store for pending verifications
const pendingOrders = {};

// 1. FRONTEND FORM SUBMISSION ENDPOINT
app.post('/api/checkout', async (req, res) => {
    const { name, telegram, reference, amount } = req.body;

    if (!name || !telegram || !reference || !amount) {
        return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }

    const orderId = 'ORD_' + Date.now();

    // Store order details
    pendingOrders[orderId] = {
        orderId,
        name,
        telegram,
        reference,
        amount,
        status: 'PENDING'
    };

    // Message sent to Admin (You) on Telegram
    const adminMessage = `🚨 *NEW PAYMENT VERIFICATION* 🚨\n\n` +
        `👤 *Name:* ${name}\n` +
        `📱 *Telegram:* ${telegram}\n` +
        `💰 *Plan/Amount:* ${amount}\n` +
        `🧾 *Ref/TxID:* \`${reference}\`\n` +
        `🆔 *Order ID:* \`${orderId}\``;

    // Inline buttons for Admin approval
    const keyboard = {
        inline_keyboard: [
            [
                { text: '✅ Approve & Send Code', callback_data: `approve_${orderId}` },
                { text: '❌ Reject Payment', callback_data: `reject_${orderId}` }
            ]
        ]
    };

    try {
        // Send notification to Admin Telegram
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: ADMIN_CHAT_ID,
            text: adminMessage,
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });

        return res.status(200).json({ success: true, message: 'Verification details submitted successfully!' });
    } catch (error) {
        console.error('Error sending Telegram alert:', error.response?.data || error.message);
        return res.status(500).json({ success: false, message: 'Server failed to alert admin.' });
    }
});

// 2. TELEGRAM WEBHOOK (Handles Admin Clicking Approve/Reject)
app.post('/telegram-webhook', async (req, res) => {
    const update = req.body;

    if (update.callback_query) {
        const query = update.callback_query;
        const data = query.data; // e.g. "approve_ORD_12345"
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;

        const [action, orderId] = data.split('_');
        const order = pendingOrders[orderId];

        if (!order) {
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                callback_query_id: query.id,
                text: 'Order not found or already processed.',
                show_alert: true
            });
            return res.sendStatus(200);
        }

        if (action === 'approve') {
            order.status = 'APPROVED';

            // Send notification to Admin that it's approved
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
                chat_id: chatId,
                message_id: messageId,
                text: query.message.text + `\n\n✅ *STATUS: APPROVED & PROCESSED*`,
                parse_mode: 'Markdown'
            });

            // Prompt Admin to reply with the Booking Code or Invite Link
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                chat_id: chatId,
                text: `✅ Order *${orderId}* approved!\nCustomer Telegram: ${order.telegram}\n\nTo send the code to customer, reply in this chat or use your channel delivery bot.`,
                parse_mode: 'Markdown'
            });

        } else if (action === 'reject') {
            order.status = 'REJECTED';

            await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
                chat_id: chatId,
                message_id: messageId,
                text: query.message.text + `\n\n❌ *STATUS: REJECTED*`,
                parse_mode: 'Markdown'
            });
        }
    }

    res.sendStatus(200);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
