const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// Telegram Credentials
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8557858552:AAFkjy5dRa-EePWF4bHrxL2y1_B6gdcq12Y';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '8863246341';

const server = http.createServer((req, res) => {
    // Enable CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    // Serve index.html at root
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
        const filePath = path.join(__dirname, 'index.html');
        fs.readFile(filePath, (err, content) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('index.html not found');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
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

    // Serve static files if requested
    const staticFilePath = path.join(__dirname, req.url);
    fs.readFile(staticFilePath, (err, content) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
        } else {
            res.writeHead(200);
            res.end(content);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
