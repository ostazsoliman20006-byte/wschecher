const { Telegraf, Markup } = require('telegraf');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const pino = require('pino');
const express = require('express');

// إعداد سرفر ويب بسيط لمنع منصة Render من إغلاق البوت
const app = express();
app.get('/', (req, res) => res.send('WS Checker is Running!'));
app.listen(process.env.PORT || 3000, () => console.log('Web server ready.'));

// توكن البوت يتم سحبه من متغيرات البيئة بأمان
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error("❌ Error: BOT_TOKEN variable is missing!");
    process.exit(1);
}
const bot = new Telegraf(BOT_TOKEN);

let sock;
const userSessions = new Map();

// دالة الاتصال بالواتساب المعدلة لاصطياد الـ QR يدوياً
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // هنا الحل: طباعة الـ QR يدوياً فور توليده من المكتبة
        if (qr) {
            console.log('📌 تفضل رمز الـ QR الجديد، امسحه الآن برقمك:');
            qrcode.generate(qr, { small: true });
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🔄 Connection closed. Reconnecting...', shouldReconnect);
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Connected Successfully!');
        }
    });
}

// رسالة الترحيب عند بدء استخدام البوت
bot.start((ctx) => ctx.reply('👋 مرحباً بك في بوت فحص أرقام الواتساب.\n\n📥 قم بإرسال ملف نصي صيغته (.txt) يحتوي على الأرقام ليبدأ الفحص فوراً.'));

// استقبال ومعالجة الملفات النصية
bot.on('document', async (ctx) => {
    const doc = ctx.message.document;
    
    if (!doc.file_name.endsWith('.txt')) {
        return ctx.reply('❌ الرجاء إرسال ملف بصيغة .txt فقط.');
    }

    const waitingMsg = await ctx.reply('⏳ جاري تحميل الملف وبدء الفحص، يرجى الانتظار...');

    try {
        const fileLink = await ctx.telegram.getFileLink(doc.file_id);
        const response = await axios.get(fileLink.href);
        const text = response.data;
        
        const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
        
        let registered = [];
        let unregistered = [];
        let failed = 0;

        for (let num of lines) {
            let cleanNum = num.replace(/\D/g, ''); 
            if (!cleanNum) continue;

            try {
                const [result] = await sock.onWhatsApp(cleanNum);
                if (result && result.exists) {
                    registered.push(num);
                } else {
                    unregistered.push(num);
                }
            } catch (err) {
                failed++;
            }
        }

        userSessions.set(ctx.from.id, { registered, unregistered, failed, total: lines.length });

        const textResponse = `✅ *Check Complete!*\n\n📊 *Total:* ${lines.length}\n✅ *Registered:* ${registered.length}\n❌ *Unregistered:* ${unregistered.length}\n⚠️ *Failed:* ${failed}\n\nChoose an option below:`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('Registered', 'view_reg'), Markup.button.callback('Unregistered', 'view_unreg')],
            [Markup.button.callback('Failed', 'view_failed'), Markup.button.callback('TXT', 'get_txt')],
            [Markup.button.callback('CSV', 'get_csv'), Markup.button.callback('Menu', 'view_menu')]
        ]);

        await ctx.telegram.deleteMessage(ctx.chat.id, waitingMsg.message_id);
        await ctx.replyWithMarkdown(textResponse, keyboard);

    } catch (error) {
        console.error(error);
        ctx.reply('❌ حدث خطأ أثناء معالجة الملف. تأكد من ربط حساب الواتساب الخاص بالسيرفر أولاً.');
    }
});

// التحكم بالأزرار التفاعلية
bot.action('view_reg', async (ctx) => {
    const session = userSessions.get(ctx.from.id);
    if (!session || session.registered.length === 0) return ctx.answerCbQuery('لا توجد أرقام مسجلة.');
    
    const list = session.registered.slice(0, 40).join('\n'); 
    await ctx.reply(`✅ *Registered (${session.registered.length}):*\n\n${list}${session.registered.length > 40 ? '\n...' : ''}`);
    ctx.answerCbQuery();
});

bot.action('view_unreg', async (ctx) => {
    const session = userSessions.get(ctx.from.id);
    if (!session || session.unregistered.length === 0) return ctx.answerCbQuery('لا توجد أرقام غير مسجلة.');
    
    const list = session.unregistered.slice(0, 40).join('\n');
    await ctx.reply(`❌ *Unregistered (${session.unregistered.length}):*\n\n${list}${session.unregistered.length > 40 ? '\n...' : ''}`);
    ctx.answerCbQuery();
});

bot.action('view_failed', async (ctx) => {
    const session = userSessions.get(ctx.from.id);
    if (!session) return ctx.answerCbQuery();
    await ctx.reply(`⚠️ عدد العمليات الفاشلة: ${session.failed}`);
    ctx.answerCbQuery();
});

bot.action('get_txt', async (ctx) => {
    const session = userSessions.get(ctx.from.id);
    if (!session || session.registered.length === 0) return ctx.answerCbQuery('لا توجد بيانات لتصديرها.');
    
    const buffer = Buffer.from(session.registered.join('\n'), 'utf-8');
    await ctx.replyWithDocument({ source: buffer, filename: 'registered.txt' });
    ctx.answerCbQuery();
});

bot.action('get_csv', async (ctx) => {
    const session = userSessions.get(ctx.from.id);
    if (!session) return ctx.answerCbQuery();
    
    let csvContent = 'Number,Status\n';
    session.registered.forEach(n => csvContent += `${n},Registered\n`);
    session.unregistered.forEach(n => csvContent += `${n},Unregistered\n`);
    
    const buffer = Buffer.from(csvContent, 'utf-8');
    await ctx.replyWithDocument({ source: buffer, filename: 'results.csv' });
    ctx.answerCbQuery();
});

bot.action('view_menu', (ctx) => {
    ctx.reply('📋 القائمة الرئيسية: أرسل ملف .txt جديد لبدء الفحص.');
    ctx.answerCbQuery();
});

// تشغيل الخدمات والاتصال
connectToWhatsApp().then(() => {
    bot.launch();
    console.log('🤖 Telegram Bot is running...');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
