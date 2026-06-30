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

async function initWhatsApp(userId, phoneNumber, ctx) {
    const authFolder = `auth_user_${userId}`;
    
    // تنظيف الجلسة السابقة لضمان اتصال نظيف
    if (userSockets.has(userId)) {
        try { userSockets.get(userId).end(); } catch (e) {}
        userSockets.delete(userId);
    }
    if (fs.existsSync(authFolder)) {
        fs.rmSync(authFolder, { recursive: true, force: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    // استخدام إعداد متصفح يخدع واتساب بأنه متصفح كروم حقيقي على ويندوز
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['Chrome', 'Windows', '10.0.0'] 
    });

    userSockets.set(userId, sock);
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) initWhatsApp(userId, phoneNumber, ctx);
        } else if (connection === 'open') {
            await ctx.reply('✅ تم الربط بنجاح! حسابك جاهز.');
        }
    });

    // الانتظار قليلاً قبل طلب الكود لضمان استقرار السوكيت
    setTimeout(async () => {
        try {
            const code = await sock.requestPairingCode(phoneNumber);
            await ctx.reply(`🔑 كود الربط الخاص بك:\n\`${code}\``, { parse_mode: 'Markdown' });
        } catch (err) {
            await ctx.reply('❌ فشل توليد الكود. تأكد من الرقم (بدون +) وأعد المحاولة.');
        }
    }, 5000);
}

bot.command('account', (ctx) => {
    ctx.reply('يرجى إرسال رقم هاتفك مع رمز الدولة (بدون +)، مثلاً: 249966904352');
});

bot.on('text', (ctx) => {
    const phone = ctx.message.text.replace(/\D/g, '');
    if (phone.length > 8) {
        ctx.reply('⏳ جاري طلب الكود، انتظر قليلاً...');
        initWhatsApp(ctx.from.id, phone, ctx);
    }
});

bot.launch();
