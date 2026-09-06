const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// 1. CONFIGURATION
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8557858552:AAFkjy5dRa-EePWF4bHrxL2y1_B6gdcq12Y';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '8863246341';
const BOT_USERNAME = '@ApexTicketMaster_bot';

// Memory store for pending orders & approval states
const activeOrders = {};
const pendingApprovalState = {};

// 2. CHECKOUT ENDPOINT (Web Form -> Admin Alert with Approval Buttons)
app.post('/api/checkout', async (req, res) => {
    const { name, telegram, reference, amount, customerChatId } = req.body;

    const messageText = `⚡ *NEW PAYMENT SUBMISSION* ⚡\n\n` +
        `👤 *Name:* ${name}\n` +
        `📱 *Telegram:* ${telegram}\n` +
        `💳 *Plan:* ${amount}\n` +
        `🧾 *Ref:* \`${reference}\`\n\n` +
        `👇 *Review payment and select an action below:*`;

    const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

    try {
        const response = await fetch(telegramApiUrl, {
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
            console.log(`[ORDER CREATED] Message ID #${sentMessageId} saved.`);
        } else {
            console.error('[TELEGRAM REJECTED]', data);
        }

        res.status(200).json({ success: true, message: 'Submitted successfully!' });
    } catch (err) {
        console.error('[SERVER ERROR]', err);
        res.status(500).json({ success: false, message: 'Failed to notify admin.' });
    }
});

// 3. TELEGRAM WEBHOOK (Approve/Reject Buttons & Code Delivery)
app.post('/api/telegram-webhook', async (req, res) => {
    const update = req.body;

    // A. Process Inline Button Click (Approve vs Reject)
    if (update.callback_query) {
        const callback = update.callback_query;
        const messageId = callback.message.message_id;
        const action = callback.data;
        const order = activeOrders[messageId];

        if (action.startsWith('approve_') && order) {
            pendingApprovalState[ADMIN_CHAT_ID] = { messageId, order };

            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: ADMIN_CHAT_ID,
                    text: `✅ *Payment Approved!*\n\nReply directly to this message with the *Booking Code* to send it to ${order.customerTelegram}.`,
                    parse_mode: 'Markdown'
                })
            });
        } else if (action.startsWith('reject_') && order) {
            delete activeOrders[messageId];
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: ADMIN_CHAT_ID,
                    text: `❌ *Payment Rejected!* Transaction \`${order.reference}\` declined.`,
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

    // B. Handle Admin Reply with Code
    if (update.message && update.message.text) {
        const adminState = pendingApprovalState[ADMIN_CHAT_ID];

        if (adminState && update.message.reply_to_message) {
            const codeTypedByAdmin = update.message.text.trim();
            const order = adminState.order;

            try {
                // Dispatch code to customer chat target
                const customerRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: order.customerTarget,
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
                            text: `🚀 *Delivered!* Code \`${codeTypedByAdmin}\` sent to ${order.customerTelegram}.`,
                            parse_mode: 'Markdown'
                        })
                    });
                } else {
                    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: ADMIN_CHAT_ID,
                            text: `⚠️ *DM Failed:* Customer ${order.customerTelegram} must press *Start* on ${BOT_USERNAME} first.\n\nSend code manually: \`${codeTypedByAdmin}\``,
                            parse_mode: 'Markdown'
                        })
                    });
                }

                delete activeOrders[adminState.messageId];
                delete pendingApprovalState[ADMIN_CHAT_ID];
            } catch (err) {
                console.error('[DELIVERY ERROR]', err);
            }
        }
    }

    res.sendStatus(200);
});

// 4. SPA CATCH-ALL
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 5. SERVER INIT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
