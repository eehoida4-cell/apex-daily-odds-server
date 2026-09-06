const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// 1. CONFIGURATION
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8557858552:AAFkjy5dRa-EePWF4bHrxL2y1_B6gdcq12Y';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '8863246341';
const BOT_USERNAME = '@ApexTicketMaster_bot';

// In-memory store to map Telegram message IDs to customer chat IDs
const activeOrders = {};

// 2. CHECKOUT ENDPOINT (Web Form -> Admin Telegram Alert)
app.post('/api/checkout', async (req, res) => {
    // Front-end passes customerChatId or telegram numeric ID
    const { name, telegram, reference, amount, customerChatId } = req.body;

    const messageText = `⚡ *NEW PAYMENT SUBMISSION* ⚡\n\n` +
        `👤 *Name:* ${name}\n` +
        `📱 *Telegram:* ${telegram}\n` +
        `💳 *Plan:* ${amount}\n` +
        `🧾 *Ref:* \`${reference}\`\n\n` +
        `👉 *To send code:* Reply directly to this message with the booking code!`;

    const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

    try {
        const response = await fetch(telegramApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: ADMIN_CHAT_ID,
                text: messageText,
                parse_mode: 'Markdown'
            })
        });

        const data = await response.json();

        if (data.ok) {
            const sentMessageId = data.result.message_id;
            
            // Store customer info using their chat ID or username fallback
            activeOrders[sentMessageId] = {
                customerTarget: customerChatId || telegram.replace('@', '').trim(),
                customerTelegram: telegram,
                plan: amount
            };
            console.log(`[ORDER CREATED] Message ID #${sentMessageId} linked to ${telegram}`);
        } else {
            console.error('[TELEGRAM API REJECTED]', data);
        }

        res.status(200).json({ success: true, message: 'Submitted successfully!' });
    } catch (err) {
        console.error('[SERVER ERROR]', err);
        res.status(500).json({ success: false, message: 'Failed to notify admin.' });
    }
});

// 3. TELEGRAM WEBHOOK (Admin Reply -> Directly DM Booking Code to Customer)
app.post('/api/telegram-webhook', async (req, res) => {
    const update = req.body;

    if (update.message && update.message.reply_to_message) {
        const replyToId = update.message.reply_to_message.message_id;
        const codeTypedByAdmin = update.message.text.trim();

        const order = activeOrders[replyToId];

        if (order) {
            const target = order.customerTarget;

            try {
                // A. Direct Message the Booking Code to the Customer's DM
                const customerMsgResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: target,
                        text: `🎉 *PAYMENT VERIFIED!*\n\nHere is your Booking Code: \`${codeTypedByAdmin}\`\n\nWelcome to *Apex Daily Odds VIP*!`,
                        parse_mode: 'Markdown'
                    })
                });

                const customerMsgData = await customerMsgResponse.json();

                // B. Notify Admin whether DM delivery succeeded
                if (customerMsgData.ok) {
                    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: ADMIN_CHAT_ID,
                            reply_to_message_id: update.message.message_id,
                            text: `✅ *Code Delivered!* Sent \`${codeTypedByAdmin}\` directly to customer DM (${order.customerTelegram}).`,
                            parse_mode: 'Markdown'
                        })
                    });
                } else {
                    // Fallback alert if user hasn't clicked /start on @ApexTicketMaster_bot
                    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: ADMIN_CHAT_ID,
                            reply_to_message_id: update.message.message_id,
                            text: `⚠️ *DM Failed!* Customer (${order.customerTelegram}) must tap *Start* on ${BOT_USERNAME} first.\n\nCode to share manually: \`${codeTypedByAdmin}\``,
                            parse_mode: 'Markdown'
                        })
                    });
                }

                delete activeOrders[replyToId];
            } catch (err) {
                console.error('[WEBHOOK ERROR]', err);
            }
        }
    }

    res.sendStatus(200);
});

// 4. SPA / STATIC CATCH-ALL ROUTE
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 5. SERVER INITIALIZATION
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Apex Daily Odds Server (${BOT_USERNAME}) running on port ${PORT}`));
