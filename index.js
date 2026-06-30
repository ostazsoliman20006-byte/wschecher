const { Telegraf, Markup } = require('telegraf');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const fs = require('fs');

const app = express();
app.get('/', (req, res) => res.send('WS Checker is Running!'));
app.listen(process.env.PORT || 3000);

const bot = new Telegraf(process.env.BOT_TOKEN);
const userSockets = new Map();

async function initWhatsApp(userId, ctx = null) {
    const authFolder = `auth_user_${userId}`;
    
    // تنظيف أي جلسة سابقة
    if (userSockets.has(userId)) {
        try { userSockets.get(userId).end(); } catch (e) {}
        userSockets.delete(userId);
    }

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'debug' }), // تفعيل الـ logs لرؤية سبب المشكلة في Render
        browser: Browsers.macOS('Desktop'),
        printQRInTerminal: false
    });

    userSockets.set(userId, sock);
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        console.log("Connection Update State:", connection, "QR present:", !!qr);

        if (qr) {
            const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
            if (ctx) await ctx.replyWithPhoto(qrImageUrl, { caption: 'قم بمسح هذا الكود عبر واتساب:' });
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                initWhatsApp(userId, ctx);
            } else {
                userSockets.delete(userId);
            }
        } else if (connection === 'open') {
            if (ctx) ctx.reply('✅ تم الربط بنجاح!');
        }
    });
}

bot.start((ctx) => ctx.reply('مرحباً! استخدم /account للبدء.'));

bot.command('account', async (ctx) => {
    ctx.reply('⏳ جاري تهيئة الاتصال، انتظر ظهور كود الـ QR...');
    await initWhatsApp(ctx.from.id, ctx);
});

bot.launch();
