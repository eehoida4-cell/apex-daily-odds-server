const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname)));

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8557858552:AAFkjy5dRa-EePWF4bHrxL2y1_B6gdcq12Y';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '8863246341';
const BOT_USERNAME = 'ApexTicketMaster_bot';

// Bank Account Details
const BANK_DETAILS = {
    bankName: process.env.BANK_NAME || "PalmPay",
    accountNumber: process.env.ACCOUNT_NUMBER || "9066989021",
    accountName: process.env.ACCOUNT_NAME || "Blessings Eboh"
};

// In-memory mappings for active prompts and pending codes
const pendingPromptToOrder = {}; // Maps admin prompt messageId -> order info
const pendingCodesByUsername = {}; // Maps lowercase username -> { bookingCode, plan }

// Helper function for delivery messages
function buildDeliveryMessage(planName, bookingCode) {
    const cleanPlan = (planName || '').toLowerCase();

    if (cleanPlan.includes('rollover')) {
        return `🔥 *ROLLOVER PAYMENT VERIFIED!*\n\n` +
               `Here is your **Apex Daily Odds Rollover** Booking Code: \`${bookingCode}\`\n\n` +
               `Stick to the strategy, manage your stake, and let's build the streak! 🚀`;
    } else if (cleanPlan.includes('combo')) {
        return `💥 *COMBO PACK PAYMENT VERIFIED!*\n\n` +
               `Here is your **Apex Daily Odds Combo** Booking Code: \`${bookingCode}\`\n\n` +
               `Your multi-ticket combinations are locked and loaded. Best of luck today! 🏆`;
    } else {
        return `🎉 *PAYMENT VERIFIED & APPROVED!*\n\n` +
               `Here is your VIP Booking Code: \`${bookingCode}\`\n\n` +
               `Welcome to *Apex Daily Odds VIP*! 🚀`;
    }
}

// Helper to send Telegram requests safely
async function sendTelegram(endpoint, payload) {
    try {
        const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return await res.json();
    } catch (err) {
        console.error(`Telegram API Error (${endpoint}):`, err);
        return { ok: false };
    }
}

// 1. CHECKOUT ENDPOINT
app.post('/api/checkout', async (req, res) => {
    const { name, telegram, reference, amount, customerChatId } = req.body;
    const formattedUsername = telegram ? telegram.trim().replace('@', '').toLowerCase() : 'user';
    const plan = amount || 'VIP';
    const targetChat = customerChatId || '';

    // Encode essential metadata directly into the callback_data so it survives server restarts
    // Payload format: app:username:plan:customerChatId
    const approveData = `app:${formattedUsername}:${plan}:${targetChat}`.slice(0, 64);
    const rejectData = `rej:${formattedUsername}`.slice(0, 64);

    const messageText = `⚡ *NEW PAYMENT SUBMISSION* ⚡\n\n` +
        `👤 *Name:* ${name}\n` +
        `📱 *Telegram:* @${formattedUsername}\n` +
        `💳 *Plan:* ${plan}\n` +
        `🧾 *Ref:* \`${reference}\`\n\n` +
        `🏦 *Account:* ${BANK_DETAILS.bankName} - ${BANK_DETAILS.accountNumber} (${BANK_DETAILS.accountName})\n\n` +
        `👇 *Verify transaction in your bank app, then select an action below:*`;

    const data = await sendTelegram('sendMessage', {
        chat_id: ADMIN_CHAT_ID,
        text: messageText,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '✅ Approve Payment', callback_data: approveData },
                    { text: '❌ Reject Payment', callback_data: rejectData }
                ]
            ]
        }
    });

    if (data.ok) {
        res.status(200).json({ success: true, message: 'Submitted successfully!' });
    } else {
        res.status(500).json({ success: false, message: 'Failed to notify admin.' });
    }
});

// 2. TELEGRAM WEBHOOK ENDPOINT
const handleWebhook = async (req, res) => {
    res.sendStatus(200); // Always respond 200 OK immediately to Telegram
    const update = req.body;
    if (!update) return;

    // A. Handle Admin Inline Buttons (Approve / Reject)
    if (update.callback_query) {
        const callback = update.callback_query;
        const actionData = callback.data || '';

        await sendTelegram('answerCallbackQuery', {
            callback_query_id: callback.id,
            text: actionData.startsWith('app:') ? 'Payment Approved!' : 'Payment Rejected!'
        });

        if (actionData.startsWith('app:')) {
            // Parse callback metadata
            const parts = actionData.split(':');
            const username = parts[1] || 'customer';
            const plan = parts[2] || 'VIP';
            const customerTarget = parts[3] || null;

            const promptRes = await sendTelegram('sendMessage', {
                chat_id: ADMIN_CHAT_ID,
                reply_to_message_id: callback.message.message_id,
                text: `✅ *PAYMENT APPROVED (${plan})!*\n\n👉 *Reply directly to THIS message with the Booking Code* for @${username}.`,
                parse_mode: 'Markdown'
            });

            if (promptRes.ok) {
                // Link prompt message ID to this order
                pendingPromptToOrder[promptRes.result.message_id] = {
                    username: username,
                    plan: plan,
                    customerTarget: customerTarget
                };
            }
        } else if (actionData.startsWith('rej:')) {
            await sendTelegram('sendMessage', {
                chat_id: ADMIN_CHAT_ID,
                reply_to_message_id: callback.message.message_id,
                text: `❌ *PAYMENT REJECTED!* Transaction cancelled.`,
                parse_mode: 'Markdown'
            });
        }
        return;
    }

    // B. Handle Admin Replying directly to the Bot with the Booking Code
    if (update.message && update.message.text && update.message.reply_to_message && update.message.chat.id.toString() === ADMIN_CHAT_ID.toString()) {
        const repliedMessageId = update.message.reply_to_message.message_id;
        const order = pendingPromptToOrder[repliedMessageId];

        if (order) {
            const codeTypedByAdmin = update.message.text.trim();
            const username = order.username;
            const plan = order.plan || 'VIP';

            // Store code in memory for user pickup
            pendingCodesByUsername[username] = { bookingCode: codeTypedByAdmin, plan: plan };

            // Clean up stored code after 24 hours
            setTimeout(() => {
                if (pendingCodesByUsername[username]) {
                    delete pendingCodesByUsername[username];
                }
            }, 24 * 60 * 60 * 1000);

            let directSent = false;

            // Attempt direct delivery if target chat ID was stored
            if (order.customerTarget) {
                const deliveryText = buildDeliveryMessage(plan, codeTypedByAdmin);
                const sendRes = await sendTelegram('sendMessage', {
                    chat_id: order.customerTarget,
                    text: deliveryText,
                    parse_mode: 'Markdown'
                });
                if (sendRes.ok) {
                    directSent = true;
                    delete pendingCodesByUsername[username];
                }
            }

            if (directSent) {
                await sendTelegram('sendMessage', {
                    chat_id: ADMIN_CHAT_ID,
                    text: `🚀 *DIRECTLY DELIVERED!* (${plan}) Code \`${codeTypedByAdmin}\` sent to @${username}.`,
                    parse_mode: 'Markdown'
                });
            } else {
                await sendTelegram('sendMessage', {
                    chat_id: ADMIN_CHAT_ID,
                    text: `💾 *CODE STORED FOR @${username}!* (${plan})\n\nWhen @${username} messages @${BOT_USERNAME}, the bot will automatically send them their booking code: \`${codeTypedByAdmin}\`.`,
                    parse_mode: 'Markdown'
                });
            }

            delete pendingPromptToOrder[repliedMessageId];
            return;
        }
    }

    // C. Handle Incoming Direct Messages from Customers to the Bot
    if (update.message && update.message.text && update.message.chat.id.toString() !== ADMIN_CHAT_ID.toString()) {
        const chatId = update.message.chat.id;
        const userUsername = (update.message.from.username || '').toLowerCase();

        if (userUsername && pendingCodesByUsername[userUsername]) {
            const { bookingCode, plan } = pendingCodesByUsername[userUsername];
            const deliveryText = buildDeliveryMessage(plan, bookingCode);

            await sendTelegram('sendMessage', {
                chat_id: chatId,
                text: deliveryText,
                parse_mode: 'Markdown'
            });

            await sendTelegram('sendMessage', {
                chat_id: ADMIN_CHAT_ID,
                text: `🚀 *DELIVERED!* Code \`${bookingCode}\` claimed by @${userUsername}.`,
                parse_mode: 'Markdown'
            });

            delete pendingCodesByUsername[userUsername];
        } else {
            await sendTelegram('sendMessage', {
                chat_id: chatId,
                text: `⏳ *Apex Daily Odds Verification*\n\nYour request is being processed. As soon as your payment is approved by admin, your booking code will be sent right here!`,
                parse_mode: 'Markdown'
            });
        }
    }
};

app.post('/telegram-webhook', handleWebhook);
app.post('/api/telegram-webhook', handleWebhook);

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));s
