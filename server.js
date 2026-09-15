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

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8557858552:AAFkjy5dRa-EePWF4bHrxL2y1_B6gdcq12Y';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '8863246341';
const BOT_USERNAME = process.env.BOT_USERNAME || 'ApexTicketMaster_bot';

// Bank Details
const BANK_DETAILS = {
    bankName: process.env.BANK_NAME || "PalmPay",
    accountNumber: process.env.ACCOUNT_NUMBER || "9066989021",
    accountName: process.env.ACCOUNT_NAME || "Blessings Eboh"
};

// Global Memory Store for Pending Orders and Codes
const pendingPromptToOrder = {};
const pendingCodesByUsername = {};

// Delivery Helper Message Generator
function buildDeliveryMessage(planName, bookingCode) {
    const cleanPlan = String(planName || '').toLowerCase();

    if (cleanPlan.includes('rollover')) {
        return "🔥 ROLLOVER PAYMENT VERIFIED!\n\n" +
               "Here is your Apex Daily Odds Rollover Access Code: " + bookingCode + "\n\n" +
               "Stick to the strategy, manage your stake, and let's build the streak! 🚀";
    } else if (cleanPlan.includes('combo')) {
        return "💥 COMBO PACK PAYMENT VERIFIED!\n\n" +
               "Here is your Apex Daily Odds Combo Access Code: " + bookingCode + "\n\n" +
               "Your multi-ticket combinations are locked and loaded. Best of luck today! 🏆";
    } else {
        return "🎉 PAYMENT VERIFIED & APPROVED!\n\n" +
               "Here is your VIP Access Code: " + bookingCode + "\n\n" +
               "Welcome to Apex Daily Odds VIP! 🚀";
    }
}

// Telegram API Helper
async function sendTelegram(endpoint, payload) {
    try {
        const response = await fetch("https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/" + endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const resJson = await response.json();
        if (!resJson.ok) {
            console.error(`Telegram API Error on [${endpoint}]:`, resJson);
        }
        return resJson;
    } catch (err) {
        console.error("Telegram Network Error:", err);
        return { ok: false };
    }
}

// Health Verification Routes for Webhooks
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/telegram-webhook', (req, res) => {
    res.status(200).send('Telegram Webhook Route is Active!');
});

// 1. CHECKOUT ROUTE
app.post('/api/checkout', async (req, res) => {
    try {
        const { name, telegram, reference, amount, customerChatId } = req.body;
        
        let rawTelegram = telegram ? String(telegram).trim().replace('@', '').toLowerCase() : '';
        const formattedUsername = rawTelegram.length > 0 ? rawTelegram : 'NO_USERNAME_PROVIDED';

        const plan = amount || 'VIP';
        const targetChat = customerChatId || '';

        const approveData = ("app:" + formattedUsername + ":" + plan + ":" + targetChat).slice(0, 64);
        const rejectData = ("rej:" + formattedUsername).slice(0, 64);

        const messageText = "⚡ NEW PAYMENT SUBMISSION ⚡\n\n" +
            "👤 Name: " + (name || 'N/A') + "\n" +
            "📱 Telegram: @" + formattedUsername + "\n" +
            "💳 Plan: " + plan + "\n" +
            "🧾 Ref: " + (reference || 'N/A') + "\n\n" +
            "🏦 Account: " + BANK_DETAILS.bankName + " - " + BANK_DETAILS.accountNumber + " (" + BANK_DETAILS.accountName + ")\n\n" +
            "👇 Verify transaction in your bank app, then select an action below:";

        const data = await sendTelegram('sendMessage', {
            chat_id: String(ADMIN_CHAT_ID).trim(),
            text: messageText,
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ Approve Payment', callback_data: approveData },
                        { text: '❌ Reject Payment', callback_data: rejectData }
                    ]
                ]
            }
        });

        if (data && data.ok) {
            return res.status(200).json({ success: true, message: 'Submitted successfully!' });
        } else {
            return res.status(500).json({ success: false, message: 'Failed to notify admin on Telegram.' });
        }
    } catch (error) {
        console.error("Checkout Handler Error:", error);
        return res.status(500).json({ success: false, message: 'Server processing error.' });
    }
});

// 2. WEBHOOK HANDLER
app.post('/telegram-webhook', async (req, res) => {
    res.sendStatus(200);

    const update = req.body;
    if (!update) return;

    try {
        // A. Handle Inline Keyboard Callbacks from Admin
        if (update.callback_query) {
            const callback = update.callback_query;
            const actionData = callback.data || '';

            await sendTelegram('answerCallbackQuery', {
                callback_query_id: callback.id,
                text: actionData.startsWith('app:') ? 'Payment Approved!' : 'Payment Rejected!'
            });

            if (actionData.startsWith('app:')) {
                const parts = actionData.split(':');
                const username = parts[1] || 'customer';
                const plan = parts[2] || 'VIP';
                const customerTarget = parts[3] || null;

                const promptRes = await sendTelegram('sendMessage', {
                    chat_id: String(ADMIN_CHAT_ID).trim(),
                    text: "✅ PAYMENT APPROVED (" + plan + ")!\n\n👉 Reply directly to THIS message with the Access Code for @" + username + "."
                });

                if (promptRes && promptRes.ok) {
                    pendingPromptToOrder[promptRes.result.message_id] = {
                        username: username,
                        plan: plan,
                        customerTarget: customerTarget
                    };
                }
            } else if (actionData.startsWith('rej:')) {
                await sendTelegram('sendMessage', {
                    chat_id: String(ADMIN_CHAT_ID).trim(),
                    text: "❌ PAYMENT REJECTED! Transaction cancelled."
                });
            }
            return;
        }

        // B. Handle Admin Reply with Booking Code
        if (update.message && update.message.text && update.message.reply_to_message && String(update.message.chat.id) === String(ADMIN_CHAT_ID)) {
            const repliedMessageId = update.message.reply_to_message.message_id;
            const order = pendingPromptToOrder[repliedMessageId];

            if (order) {
                const codeTypedByAdmin = update.message.text.trim();
                const username = order.username;
                const plan = order.plan || 'VIP';

                pendingCodesByUsername[username] = { bookingCode: codeTypedByAdmin, plan: plan };

                setTimeout(() => {
                    if (pendingCodesByUsername[username]) {
                        delete pendingCodesByUsername[username];
                    }
                }, 24 * 60 * 60 * 1000);

                let directSent = false;

                if (order.customerTarget) {
                    const deliveryText = buildDeliveryMessage(plan, codeTypedByAdmin);
                    const sendRes = await sendTelegram('sendMessage', {
                        chat_id: order.customerTarget,
                        text: deliveryText
                    });
                    if (sendRes && sendRes.ok) {
                        directSent = true;
                        delete pendingCodesByUsername[username];
                    }
                }

                if (directSent) {
                    await sendTelegram('sendMessage', {
                        chat_id: String(ADMIN_CHAT_ID).trim(),
                        text: "🚀 DIRECTLY DELIVERED! (" + plan + ") Code " + codeTypedByAdmin + " sent to @" + username + "."
                    });
                } else {
                    await sendTelegram('sendMessage', {
                        chat_id: String(ADMIN_CHAT_ID).trim(),
                        text: "💾 CODE STORED FOR @" + username + "! (" + plan + ")\n\nWhen @" + username + " messages @" + BOT_USERNAME + ", the bot will automatically send them their access code: " + codeTypedByAdmin + "."
                    });
                }

                delete pendingPromptToOrder[repliedMessageId];
                return;
            }
        }

        // C. Handle Direct Customer Messages & Free Tips Request
        if (update.message && update.message.text && String(update.message.chat.id) !== String(ADMIN_CHAT_ID)) {
            const chatId = update.message.chat.id;
            const messageText = update.message.text.trim().toLowerCase();
            const userUsername = update.message.from && update.message.from.username ? update.message.from.username.toLowerCase() : '';

            // 1. Free Tips Trigger
            if (messageText.includes('get_free_ticket') || messageText === '/free' || messageText === '/tips') {
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

                await sendTelegram('sendMessage', {
                    chat_id: chatId,
                    text: freeTipsMessage
                });
                return;
            }

            // 2. Pending Paid Booking Code Check
            if (userUsername && pendingCodesByUsername[userUsername]) {
                const { bookingCode, plan } = pendingCodesByUsername[userUsername];
                const deliveryText = buildDeliveryMessage(plan, bookingCode);

                await sendTelegram('sendMessage', {
                    chat_id: chatId,
                    text: deliveryText
                });

                await sendTelegram('sendMessage', {
                    chat_id: String(ADMIN_CHAT_ID).trim(),
                    text: "🚀 DELIVERED! Code " + bookingCode + " claimed by @" + userUsername + "."
                });

                delete pendingCodesByUsername[userUsername];
            } else {
                // 3. Fallback Welcome Message
                await sendTelegram('sendMessage', {
                    chat_id: chatId,
                    text: "👋 Welcome to Apex Daily Odds Bot!\n\n" +
                          "• For Midweek Free Tips, send: /free\n" +
                          "• To unlock VIP / Rollover tickets, make a submission on our website:\n" +
                          "https://apex-daily-odds-server.onrender.com"
                });
            }
        }
    } catch (err) {
        console.error("Webhook Internal Processing Error:", err);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
