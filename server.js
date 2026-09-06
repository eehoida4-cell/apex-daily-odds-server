const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Replace with your actual Telegram Bot Token and your personal Admin Chat ID
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || 'YOUR_ADMIN_CHAT_ID_HERE';

// Memory store to link Telegram message IDs to customer handles
const activeOrders = {};

// Handle Checkout Form Submission from Website
app.post('/api/checkout', async (req, res) => {
    const { name, telegram, reference, amount } = req.body;

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
            // Save the message ID so we know which customer you are replying to later
            const sentMessageId = data.result.message_id;
            activeOrders[sentMessageId] = {
                customerTelegram: telegram.replace('@', '').trim(),
                plan: amount
            };
        }

        res.status(200).json({ success: true, message: 'Submitted successfully!' });
    } catch (err) {
        console.error('Telegram Error:', err);
        res.status(500).json({ success: false, message: 'Failed to notify admin.' });
    }
});

// Telegram Webhook to catch your replies with booking codes
app.post('/api/telegram-webhook', async (req, res) => {
    const update = req.body;

    // Check if the update is a message reply from you (the Admin)
    if (update.message && update.message.reply_to_message) {
        const replyToId = update.message.reply_to_message.message_id;
        const codeTypedByAdmin = update.message.text.trim();

        // Check if this reply matches an active customer order
        const order = activeOrders[replyToId];

        if (order) {
            const customerChatId = order.customerTelegram;

            try {
                // Send the booking code to the customer's Telegram DM
                await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: `@${customerChatId}`,
                        text: `🎉 *PAYMENT VERIFIED!*\n\nHere is your Booking Code: \`${codeTypedByAdmin}\`\n\nWelcome to *Apex Daily Odds VIP*!`,
                        parse_mode: 'Markdown'
                    })
                });

                // Confirm to Admin that code was sent
                await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: ADMIN_CHAT_ID,
                        reply_to_message_id: update.message.message_id,
                        text: `✅ Code \`${codeTypedByAdmin}\` sent successfully to @${customerChatId}!`,
                        parse_mode: 'Markdown'
                    })
                });

                delete activeOrders[replyToId];
            } catch (err) {
                console.error('Error forwarding code:', err);
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
