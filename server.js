const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname)));

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8557858552:AAFkjy5dRa-EePWF4bHrxL2y1_B6gdcq12Y';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '8863246341';
const BOT_USERNAME = '@ApexTicketMaster_bot';

const activeOrders = {};
const pendingApprovalState = {};

// 1. CHECKOUT ENDPOINT
app.post('/api/checkout', async (req, res) => {
    const { name, telegram, reference, amount, customerChatId } = req.body;

    const messageText = `⚡ *NEW PAYMENT SUBMISSION* ⚡\n\n` +
        `👤 *Name:* ${name}\n` +
        `📱 *Telegram:* ${telegram}\n` +
        `💳 *Plan:* ${amount}\n` +
        `🧾 *Ref:* \`${reference}\`\n\n` +
        `👇 *Review payment and select an action below:*`;

    try {
        const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: ADMIN_CHAT_ID,
                text: messageText,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Approve Payment', callback_data: `approve_${Date.now()}` },
                            { text: '❌ Reject Payment', callback_data: `reject_${Date.now()}` }
                        ]
                    ]
                }
            })
        });

        const data = await response.json();

        if (data.ok) {
            const sentMessageId = data.result.message_id;
            activeOrders[sentMessageId] = {
                customerTarget: customerChatId || telegram.replace('@', '').trim(),
                customerTelegram: telegram,
                plan: amount,
                reference: reference
            };
        }

        res.status(200).json({ success: true, message: 'Submitted successfully!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Failed to notify admin.' });
    }
});

// 2. TELEGRAM WEBHOOK ENDPOINT
app.post('/api/telegram-webhook', async (req, res) => {
    // Respond immediately to prevent Telegram timeouts
    res.sendStatus(200);

    const update = req.body;

    // Handle Inline Keyboard Button Clicks
    if (update.callback_query) {
        const callback = update.callback_query;
        const messageId = callback.message.message_id;
        const action = callback.data;

        // Dismiss the Telegram loading icon immediately
        fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callback_query_id: callback.id,
                text: action.startsWith('approve_') ? 'Payment Approved!' : 'Payment Rejected!'
            })
        }).catch(err => console.error(err));

        if (action.startsWith('approve_')) {
            pendingApprovalState[ADMIN_CHAT_ID] = { messageId };

            // Send explicit approval confirmation and prompt
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: ADMIN_CHAT_ID,
                    reply_to_message_id: messageId,
                    text: `✅ *PAYMENT APPROVED!*\n\n👉 *Reply directly to THIS message with the Booking Code* to send it to the customer.`,
                    parse_mode: 'Markdown'
                })
            });
        } else if (action.startsWith('reject_')) {
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: ADMIN_CHAT_ID,
                    reply_to_message_id: messageId,
                    text: `❌ *PAYMENT REJECTED!* Transaction cancelled.`,
                    parse_mode: 'Markdown'
                })
            });
        }
    }

    // Handle Admin Code Reply
    if (update.message && update.message.text && update.message.reply_to_message) {
        const codeTypedByAdmin = update.message.text.trim();

        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: ADMIN_CHAT_ID,
                text: `🚀 *PROCESS COMPLETE!*\n\nBooking Code \`${codeTypedByAdmin}\` recorded.`,
                parse_mode: 'Markdown'
            })
        });

        delete pendingApprovalState[ADMIN_CHAT_ID];
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
