const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8557858552:AAFkjy5dRa-EePWF4bHrxL2y1_B6gdcq12Y';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '8863246341';

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    // Serve index.html explicitly on root or any GET request for main page
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
        const filePath = path.resolve(__dirname, 'index.html');
        
        fs.readFile(filePath, 'utf8', (err, content) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Server Error: Unable to read index.html file.');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(content);
            }
        });
        return;
    }

    // Payment Checkout Endpoint
    if (req.method === 'POST' && req.url === '/api/checkout') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const { name, telegram, reference, amount } = JSON.parse(body || '{}');

                if (!name || !telegram || !reference) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: 'All fields required.' }));
                }

                const textMessage = 
`🚨 *NEW PAYMENT VERIFICATION* 🚨\n\n` +
`👤 *Name:* ${name}\n` +
`📱 *Telegram:* ${telegram}\n` +
`💳 *Reference:* \`${reference}\`\n` +
`💰 *Selected Tier:* ${amount || 'Not Specified'}\n\n` +
`⏳ *Status:* Pending Admin Approval`;

                const postData = JSON.stringify({
                    chat_id: TELEGRAM_CHAT_ID,
                    text: textMessage,
                    parse_mode: 'Markdown'
                });

                const options = {
                    hostname: 'api.telegram.org',
                    path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData)
                    }
                };

                const telegramReq = https.request(options, (telegramRes) => {
                    let telegramData = '';
                    telegramRes.on('data', chunk => { telegramData += chunk; });
                    telegramRes.on('end', () => {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, message: 'Verification submitted.' }));
                    });
                });

                telegramReq.on('error', (e) => {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Telegram error.' }));
                });

                telegramReq.write(postData);
                telegramReq.end();

            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Server error.' }));
            }
        });
        return;
    }

    // Default 404 handler for missing routes
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
