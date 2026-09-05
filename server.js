const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// Enable CORS for frontend website communication
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

const BOT_TOKEN = '8557858552:AAFkjy5dRa-EePWF4bHrxL2y1_B6gdcq12Y';
const ADMIN_CHAT_ID = '8863246341';

// UPDATE YOUR DAILY SPORTYBET BOOKING CODES HERE
const VIP_BOOKING_CODE = "BC_DAILY_998"; 
const ROLLOVER_BOOKING_CODE = "BC_ROLLOVER_331";

// 1. Endpoint triggered when customer submits email on website
app.post('/api/checkout', async (req, res) => {
    const { email, plan, price } = req.body;

    const messageText = `🚨 *NEW PAYMENT CLAIM*\n\n📌 *Plan:* ${plan} (${price})\n📧 *Customer Email:* \`${email}\`\n\nCheck Moniepoint app. Once confirmed, tap below:`;

    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: ADMIN_CHAT_ID,
            text: messageText,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { 
                            text: "✅ CONFIRM & RELEASE CODE", 
                            callback_data: `confirm_${plan.replace(/\s+/g, '-')}_${email}` 
                        }
                    ]
                ]
            }
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error sending alert:', error.response?.data || error.message);
        res.status(500).json({ error: "Failed to alert admin" });
    }
});

// 2. Telegram Webhook Endpoint (Listens for your button taps inside Telegram)
app.post('/telegram-webhook', async (req, res) => {
    const body = req.body;

    if (body.callback_query) {
        const query = body.callback_query;
        const buttonData = query.data; 

        if (buttonData.startsWith('confirm_')) {
            const parts = buttonData.split('_');
            const rawPlan = parts[1].replace(/-/g, ' ');
            const customerEmail = parts[2];

            // Select appropriate booking code
            let activeCode = rawPlan.includes('Rollover') ? ROLLOVER_BOOKING_CODE : VIP_BOOKING_CODE;

            // Edit Admin Message to show confirmed status
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
                chat_id: ADMIN_CHAT_ID,
                message_id: query.message.message_id,
                text: `✅ *PAYMENT CONFIRMED*\n\n📌 *Plan:* ${rawPlan}\n📧 *Customer:* \`${customerEmail}\`\n🎟 *Code Released:* \`${activeCode}\``,
                parse_mode: 'Markdown'
            });

            // Pop-up response in Telegram app
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                callback_query_id: query.id,
                text: `Confirmed! Booking Code: ${activeCode}`,
                show_alert: true
            });
        }
    }

    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Apex Odds Server running on port ${PORT}`));