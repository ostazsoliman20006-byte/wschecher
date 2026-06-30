const { Telegraf, Markup } = require('telegraf');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const axios = require('axios');
const pino = require('pino');
const express = require('express');
const fs = require('fs');

const app = express();
app.get('/', (req, res) => res.send('WS Checker Multi-Account is Running!'));
app.listen(process.env.PORT || 3000, () => console.log('Web server ready.'));

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error("❌ Error: BOT_TOKEN variable is missing!");
    process.exit(1);
}
const bot = new Telegraf(BOT_TOKEN);

const userSockets = new Map();
const userStates = new Map();
const userSessions = new Map();

async function initWhatsApp(userId, phoneNumber = null, ctx = null) {
    const authFolder = `auth_user_${userId}`;
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    userSockets.set(userId, sock);
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) initWhatsApp(userId, null, ctx);
        } else if (connection === 'open') {
            if (ctx) ctx.reply('✅ تم ربط حساب الواتساب الخاص بك بنجاح!');
        }
    });

    if (phoneNumber) {
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                let formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                if (ctx) {
                    await ctx.reply(`🔑 *Your Pairing Code:*\n\n\`${formattedCode}\``, { parse_mode: 'Markdown' });
                    await ctx.reply('ℹ️ افتح الواتساب في هاتفك ⬅️ الأجهزة المرتبطة ⬅️ ربط جهاز ⬅️ "الربط برقم الهاتف" وأدخل الكود.');
                }
            } catch (err) {
                if (ctx) ctx.reply('❌ فشل توليد الكود. تأكد من الرقم وحاول مجدداً.');
            }
        }, 3000);
    }
}

// دالة موحدة لعرض إدارة الحساب
async function showAccountManager(ctx, isCommand = false) {
    const userId = ctx.from.id;
    const isConnected = userSockets.has(userId) && userSockets.get(userId)?.ws?.readyState === 1;
    const message = isConnected ? '⚙️ *إعدادات الحساب:*\n\nحسابك متصل وجاهز للاستخدام.' : '⚙️ *إعدادات الحساب:*\n\nلم تقم بربط حساب واتساب بعد.';
    
    const keyboard = isConnected 
        ? Markup.inlineKeyboard([[Markup.button.callback('❌ Logout Account', 'logout_wa')], [Markup.button.callback('⬅️ Back', 'back_menu')]])
        : Markup.inlineKeyboard([[Markup.button.callback('📱 Link via Pair Code', 'request_code')], [Markup.button.callback('⬅️ Back', 'back_menu')]]);

    if (isCommand) {
        await ctx.replyWithMarkdown(message, keyboard);
    } else {
        await ctx.editMessageText(message, { parse_mode: 'Markdown', ...keyboard }).catch(() => {});
    }
}

// إضافة دعم الأمر /account مباشرة
bot.command('account', (ctx) => showAccountManager(ctx, true));
bot.action('manage_account', (ctx) => showAccountManager(ctx, false));

bot.start((ctx) => {
    if (fs.existsSync(`auth_user_${ctx.from.id}`)) initWhatsApp(ctx.from.id);
    const welcomeText = `👋 *WA Checker Bot*\n\nCheck WhatsApp numbers using your own accounts.\n\nYour accounts distribute checks automatically for speed & safety.`;
    ctx.replyWithMarkdown(welcomeText, Markup.inlineKeyboard([
        [Markup.button.callback('📱 Account', 'manage_account')],
        [Markup.button.callback('ℹ️ Help', 'view_help')]
    ]));
});

// باقي الكود (استقبال الكود، إرسال الملفات، إلخ...)
bot.action('request_code', (ctx) => {
    userStates.set(ctx.from.id, 'WAITING_PHONE_NUMBER');
    ctx.editMessageText('📱 *Pair Code Login*\n\nSend your phone number with country code:\n\nExample: `249966904352`', { parse_mode: 'Markdown' });
});

bot.on('text', async (ctx, next) => {
    if (userStates.get(ctx.from.id) === 'WAITING_PHONE_NUMBER') {
        let phone = ctx.message.text.replace(/\D/g, '');
        userStates.delete(ctx.from.id);
        await ctx.reply('⏳ جاري الاتصال... انتظر لحظة.');
        await initWhatsApp(ctx.from.id, phone, ctx);
    } else {
        return next();
    }
});

// [هنا ضع باقي كود معالجة الملفات والنتائج الذي أرسلته لك في الرد السابق]
// (لقد اختصرت الكود ليركز على حل مشكلة الـ /account)

bot.action('back_menu', (ctx) => {
    ctx.deleteMessage().catch(() => {});
    bot.start(ctx);
});

bot.action('view_help', (ctx) => {
    ctx.reply('ℹ️ للبدء: اربط حسابك عبر /account، ثم أرسل ملف .txt.');
    ctx.answerCbQuery();
});

bot.launch();
