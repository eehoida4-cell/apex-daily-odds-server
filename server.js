const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Telegram Credentials
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8557858552:AAFkjy5dRa-EePWF4bHrxL2y1_B6gdcq12Y';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '8863246341';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.')); 

// Verification Endpoint
app.post('/api/checkout', async (req, res) => {
    try {
        const { name, telegram, reference, amount } = req.body;

        if (!name || !telegram || !reference) {
            return res.status(400).json({ 
                success: false, 
                message: 'All fields are required.' 
            });
        }

        // Format message for Telegram Admin
        const textMessage = 
`🚨 *NEW PAYMENT VERIFICATION* 🚨\n\n` +
`👤 *Name:* ${name}\n` +
`📱 *Telegram:* ${telegram}\n` +
`💳 *Reference:* \`${reference}\`\n` +
`💰 *Selected Tier:* ${amount || 'Not Specified'}\n\n` +
`⏳ *Status:* Pending Admin Approval`;

        const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        
        const telegramResponse = await fetch(telegramUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: textMessage,
                parse_mode: 'Markdown'
            })
        });

        const telegramResult = await telegramResponse.json();

        if (!telegramResult.ok) {
            console.error('Telegram API Error:', telegramResult);
            return res.status(500).json({ 
                success: false, 
                message: 'Failed to notify admin via Telegram.' 
            });
        }

        return res.status(200).json({ 
            success: true, 
            message: 'Verification submitted successfully.' 
        });

    } catch (error) {
        console.error('Server Processing Error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Internal server error processing verification.' 
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
