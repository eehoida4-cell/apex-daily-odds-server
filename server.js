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
                reference: reference,
                name: name
            };
        }

        res.status(200).json({ success: true, message: 'Submitted successfully!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Failed to notify admin.' });
    }
});

app.post('/api/telegram-webhook', async (req, res) => {
    const update = req.body;

    if (update.callback_query) {
        const callback = update.callback_query;
        const messageId = callback.message.message_id;
        const action = callback.data;
        const order = activeOrders[messageId];

        if (action.startsWith('approve_')) {
            // Store state linked to this specific message ID
            pendingApprovalState[ADMIN_CHAT_ID] = { messageId, order };

            // Send clear prompt message directly to Admin
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: ADMIN_CHAT_ID,
                    reply_to_message_id: messageId,
                    text: `✅ *Payment Approved!*\n\n👉 *REPLY DIRECTLY TO THIS MESSAGE WITH THE BOOKING CODE* to send it to ${order ? order.customerTelegram : 'the customer'}.`,
                    parse_mode: 'Markdown'
                })
            });
        } else if (action.startsWith('reject_')) {
            if (order) delete activeOrders[messageId];
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: ADMIN_CHAT_ID,
                    reply_to_message_id: messageId,
                    text: `❌ *Payment Rejected!* Transaction declined.`,
                    parse_mode: 'Markdown'
                })
            });
        }

        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: callback.id })
        });
    }

    if (update.message && update.message.text) {
        const adminState = pendingApprovalState[ADMIN_CHAT_ID];

        if (adminState && update.message.reply_to_message) {
            const codeTypedByAdmin = update.message.text.trim();
            const order = adminState.order;

            try {
                const target = order ? order.customerTarget : ADMIN_CHAT_ID;
                const handle = order ? order.customerTelegram : 'Customer';

                const customerRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: target,
                        text: `🎉 *PAYMENT VERIFIED & APPROVED!*\n\nHere is your Booking Code: \`${codeTypedByAdmin}\`\n\nWelcome to *Apex Daily Odds VIP*!`,
                        parse_mode: 'Markdown'
                    })
                });

                const customerData = await customerRes.json();

                if (customerData.ok) {
                    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: ADMIN_CHAT_ID,
                            text: `🚀 *Delivered!* Code \`${codeTypedByAdmin}\` sent to ${handle}.`,
                            parse_mode: 'Markdown'
                        })
                    });
                } else {
                    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: ADMIN_CHAT_ID,
                            text: `⚠️ *DM Failed:* Customer ${handle} must press *Start* on ${BOT_USERNAME} first.\n\nCode to share manually: \`${codeTypedByAdmin}\``,
                            parse_mode: 'Markdown'
                        })
                    });
                }

                delete activeOrders[adminState.messageId];
                delete pendingApprovalState[ADMIN_CHAT_ID];
            } catch (err) {
                console.error(err);
            }
        }
    }

    res.sendStatus(200);
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
